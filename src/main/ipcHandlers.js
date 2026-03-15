import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { buildPrompt } from "./promptBuilder.js";
import {
  inspectAgent as inspectPlaywrightAgent,
  openAgent as openPlaywrightAgent,
  injectPrompt,
  waitForResponse
} from "./playwrightManager.js";
import {
  inspectGeminiAgent,
  openGeminiAgent,
  sendGeminiPrompt
} from "./geminiBridgeManager.js";
import { getPlatformUrl } from "./platformUrls.js";
import {
  appendAgentJournal,
  detectGitRepository,
  getAgentJournalPath,
  prepareAgentWorkspace,
  readAgentJournal
} from "./projectWorkspace.js";
import {
  completeTask,
  createTask,
  fetchAgents,
  fetchContext,
  getAppSettings,
  getServerBaseUrl,
  saveDecisions,
  updateAgentStatus,
  updateTaskStatus
} from "./serverClient.js";
import {
  executeToolRequest,
  formatRepeatedToolResultPrompt,
  formatRejectedToolPrompt,
  formatToolResultPrompt,
  parseToolRequest,
  requestToolApproval
} from "./toolBridge.js";

const MAX_IDENTICAL_TOOL_REQUESTS = 3;
const CACHEABLE_TOOL_ACTIONS = new Set([
  "list_files",
  "search_files",
  "read_file",
  "read_files",
  "batch_actions",
  "rebuild_app",
  "reload_app",
  "restart_app"
]);
const CACHE_INVALIDATING_TOOL_ACTIONS = new Set([
  "apply_patch",
  "write_file",
  "run_command",
  "rebuild_app",
  "reload_app",
  "restart_app",
  "delegate_task",
  "delegate_tasks"
]);
const agentExecutionQueues = new Map();
let restartScheduled = false;
const temporarilyUnavailableAgents = new Map();
const ORCHESTRATOR_WORKER_ONLY_ACTIONS = new Set([
  "apply_patch",
  "write_file"
]);
const ORCHESTRATOR_POST_DELEGATION_ACTIONS = new Set([
  "rebuild_app",
  "reload_app",
  "restart_app"
]);
const TEMPORARY_UNAVAILABLE_PATTERNS = [
  /out of free messages/i,
  /free messages until/i,
  /message limit/i,
  /usage limit/i,
  /quota exceeded/i,
  /rate limit exceeded/i,
  /too many messages/i,
  /try again later/i
];

function emitTaskEvent(projectId, payload) {
  if (!projectId) {
    return;
  }

  const event = {
    id: `${projectId}:${payload.taskId || payload.agentId || "event"}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    projectId,
    timestamp: new Date().toISOString(),
    ...payload
  };

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("agent-sync:task-event", event);
    }
  }
}

function truncateText(value, maxLength = 8000) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n\n... truncated ...` : text;
}

function recordFileChanges(changeMap, filesChanged = []) {
  for (const file of filesChanged) {
    const filePath = String(file?.path ?? "").trim();

    if (!filePath) {
      continue;
    }

    const existing = changeMap.get(filePath) || {
      path: filePath,
      status: String(file?.status ?? "modified"),
      addedLines: 0,
      deletedLines: 0
    };

    existing.status =
      existing.status === "added" && file?.status === "deleted"
        ? "modified"
        : existing.status === "deleted" && file?.status === "added"
          ? "modified"
          : existing.status;
    existing.addedLines += Number(file?.addedLines ?? 0) || 0;
    existing.deletedLines += Number(file?.deletedLines ?? 0) || 0;
    changeMap.set(filePath, existing);
  }
}

function formatHydraChangeSummary(changeMap) {
  const files = [...changeMap.values()];

  if (files.length === 0) {
    return "";
  }

  const totalAdded = files.reduce((sum, file) => sum + (Number(file.addedLines) || 0), 0);
  const totalDeleted = files.reduce((sum, file) => sum + (Number(file.deletedLines) || 0), 0);

  return [
    "[Hydra Change Summary]",
    `Files changed: ${files.length} | +${totalAdded} / -${totalDeleted}`,
    ...files.map(
      (file) =>
        `- ${file.path} (${file.status}, +${Number(file.addedLines) || 0} / -${Number(file.deletedLines) || 0})`
    )
  ].join("\n");
}

function appendHydraChangeSummary(response, changeMap) {
  const summary = formatHydraChangeSummary(changeMap);
  const text = String(response ?? "").trim();

  if (!summary) {
    return text;
  }

  return text ? `${text}\n\n${summary}` : summary;
}

function extractTemporaryUnavailableMessage(value) {
  const text = String(value?.message ?? value ?? "").replace(/\s+/g, " ").trim();

  if (!text) {
    return "";
  }

  const match = TEMPORARY_UNAVAILABLE_PATTERNS.find((pattern) => pattern.test(text));
  return match ? text.slice(0, 240) : "";
}

function parseTemporaryUnavailableUntil(message) {
  const text = String(message ?? "");
  const match = text.match(/\buntil\s+(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)\b/i);

  if (!match) {
    return 0;
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2] || "0", 10);
  const meridiem = match[3].replace(/\./g, "").toUpperCase();

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 1 ||
    hours > 12 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return 0;
  }

  const now = new Date();
  const target = new Date(now);
  let normalizedHours = hours % 12;

  if (meridiem === "PM") {
    normalizedHours += 12;
  }

  target.setHours(normalizedHours, minutes, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime();
}

function getAgentTemporaryUnavailability(agentId) {
  const entry = temporarilyUnavailableAgents.get(agentId);

  if (!entry) {
    return null;
  }

  if (entry.until && entry.until <= Date.now()) {
    temporarilyUnavailableAgents.delete(agentId);
    return null;
  }

  return entry;
}

function markAgentTemporarilyUnavailable(agentId, message) {
  const nextEntry = {
    message: extractTemporaryUnavailableMessage(message) || "Agent is temporarily unavailable.",
    until: parseTemporaryUnavailableUntil(message)
  };

  temporarilyUnavailableAgents.set(agentId, nextEntry);
  return nextEntry;
}

function clearAgentTemporaryUnavailability(agentId) {
  temporarilyUnavailableAgents.delete(agentId);
}

function getAvailableWorkers(contextPayload, agent) {
  return (contextPayload?.agents || []).filter(
    (candidate) => candidate.role === "worker" && candidate.id !== agent?.id
  );
}

function compareFallbackAgents(left, right, failedPlatform) {
  const leftRoleScore = left.role === "orchestrator" ? 0 : 1;
  const rightRoleScore = right.role === "orchestrator" ? 0 : 1;

  if (leftRoleScore !== rightRoleScore) {
    return leftRoleScore - rightRoleScore;
  }

  const leftBusyScore = left.status === "working" ? 1 : 0;
  const rightBusyScore = right.status === "working" ? 1 : 0;

  if (leftBusyScore !== rightBusyScore) {
    return leftBusyScore - rightBusyScore;
  }

  const leftStatusScore = left.status === "error" ? 1 : 0;
  const rightStatusScore = right.status === "error" ? 1 : 0;

  if (leftStatusScore !== rightStatusScore) {
    return leftStatusScore - rightStatusScore;
  }

  const leftPlatformScore = left.platform === failedPlatform ? 1 : 0;
  const rightPlatformScore = right.platform === failedPlatform ? 1 : 0;

  if (leftPlatformScore !== rightPlatformScore) {
    return leftPlatformScore - rightPlatformScore;
  }

  return String(left.created_at ?? "").localeCompare(String(right.created_at ?? ""));
}

async function pickFallbackExecutionAgent({
  logicalAgent,
  executionAgent,
  attemptedIds = new Set()
}) {
  const agents = await fetchAgents();

  const candidates = agents
    .filter((candidate) => candidate.id !== executionAgent.id)
    .filter((candidate) => candidate.id !== logicalAgent.id || candidate.role === "orchestrator")
    .filter((candidate) => !attemptedIds.has(candidate.id))
    .filter((candidate) => !getAgentTemporaryUnavailability(candidate.id));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => compareFallbackAgents(left, right, executionAgent.platform));
  return candidates[0] || null;
}

function formatDelegationRequiredPrompt(request, workers) {
  const workerList = workers.map((worker) => worker.name).join(", ");

  return [
    "[HYDRA_TOOL_RESULT]",
    `The requested action "${request.action}" was blocked by orchestration policy.`,
    "As the orchestrator, you must delegate implementation work to an available worker before changing files or restarting the app yourself.",
    `Available workers: ${workerList || "none"}`,
    "Use read-only discovery if needed, then respond with exactly one ```hydra``` JSON block using delegate_task or delegate_tasks.",
    "After the worker returns, you may review, validate, rebuild, reload, and summarize."
  ].join("\n");
}

function enqueueAgentTask(agentId, runner) {
  const previous = agentExecutionQueues.get(agentId) || Promise.resolve();
  const next = previous.catch(() => {}).then(runner);
  const tracked = next.finally(() => {
    if (agentExecutionQueues.get(agentId) === tracked) {
      agentExecutionQueues.delete(agentId);
    }
  });

  agentExecutionQueues.set(agentId, tracked);
  return tracked;
}

function isCacheableToolAction(action) {
  return CACHEABLE_TOOL_ACTIONS.has(String(action ?? "").trim());
}

function shouldInvalidateToolCache(action) {
  return CACHE_INVALIDATING_TOOL_ACTIONS.has(String(action ?? "").trim());
}

function scheduleAppRestart() {
  if (restartScheduled) {
    return;
  }

  restartScheduled = true;

  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 1000);
}

async function openAgentSession(agentId, platform) {
  const platformUrl = getPlatformUrl(platform);

  if (platform === "gemini") {
    return openGeminiAgent(agentId, platformUrl);
  }

  return openPlaywrightAgent(agentId, platformUrl);
}

async function inspectAgentSession(agentId, platform) {
  const platformUrl = getPlatformUrl(platform);

  if (platform === "gemini") {
    return inspectGeminiAgent(agentId, platformUrl);
  }

  return inspectPlaywrightAgent(agentId, platform, platformUrl);
}

async function sendPromptAndWait(agent, prompt, timeoutMs = 240000) {
  if (agent.platform === "gemini") {
    return sendGeminiPrompt(agent.id, prompt, timeoutMs);
  }

  const injectResult = await injectPrompt(agent.id, agent.platform, prompt);
  return waitForResponse(agent.id, agent.platform, timeoutMs, injectResult || {});
}

async function prepareExecutionContext(agent, contextPayload) {
  const canonicalProjectRoot = contextPayload?.project?.root_path?.trim() || "";

  if (!canonicalProjectRoot) {
    return {
      canonicalProjectRoot: "",
      workspacePath: "",
      branchName: "",
      isGitRepo: false,
      journalPath: "",
      journalContent: ""
    };
  }

  if (agent.role === "worker") {
    return prepareAgentWorkspace(canonicalProjectRoot, agent);
  }

  const gitInfo = await detectGitRepository(canonicalProjectRoot);

  return {
    canonicalProjectRoot,
    workspacePath: canonicalProjectRoot,
    branchName: "",
    isGitRepo: gitInfo.isGitRepo,
    journalPath: getAgentJournalPath(canonicalProjectRoot, agent),
    journalContent: readAgentJournal(canonicalProjectRoot, agent)
  };
}

function buildDelegatedTask(task, parentAgent, workerContext) {
  return [
    task.trim(),
    "",
    `Delegated subtask from orchestrator "${parentAgent.name}".`,
    "Complete only this subtask and do not re-scope the project.",
    workerContext.branchName
      ? `Use only your assigned branch/workspace: ${workerContext.branchName}.`
      : "Use only your assigned workspace for edits.",
    "At the end, summarize exact files changed, commands run, and blockers for the orchestrator.",
  ].join("\n");
}

function matchAgentFromRequest(request, agents) {
  const byId = request.agentId?.trim();
  const byName = request.agent?.trim().toLowerCase();

  return (
    agents.find((agent) => byId && agent.id === byId) ||
    agents.find((agent) => byName && agent.name.trim().toLowerCase() === byName) ||
    null
  );
}

async function continueWithToolBridge({
  agent,
  executionAgent = agent,
  projectId,
  taskId,
  contextPayload,
  executionContext,
  initialPrompt
}) {
  let latestResponse = "";
  let executedSteps = 0;
  let lastRequestSignature = "";
  let repeatedRequestCount = 0;
  let pendingRestart = false;
  let nextPrompt = initialPrompt;
  let hasDelegatedImplementation = false;
  const cachedResultsBySignature = new Map();
  const accumulatedFileChanges = new Map();

  async function handleDelegatedTask(request) {
    if (!request.task?.trim()) {
      throw new Error("delegate_task requires a non-empty task.");
    }

    const agents = await fetchAgents();
    const target = matchAgentFromRequest(request, agents);

    if (!target) {
      throw new Error(`Worker agent not found for delegation: ${request.agent || request.agentId || "unknown"}`);
    }

    if (target.role !== "worker") {
      throw new Error(`Agent "${target.name}" is not a worker.`);
    }

    const targetExecutionContext = await prepareExecutionContext(target, contextPayload);
    emitTaskEvent(projectId, {
      taskId,
      agentId: agent.id,
      kind: "system",
      label: "Hydra",
      message: `Delegating work to ${target.name}.`
    });

    const workerResult = await runAgentTask({
      agent: target,
      projectId,
      task: buildDelegatedTask(request.task || "", agent, targetExecutionContext),
      parentAgent: agent
    });

    hasDelegatedImplementation = true;

    emitTaskEvent(projectId, {
      taskId,
      agentId: agent.id,
      kind: "system",
      label: "Hydra",
      message: `${target.name} finished the delegated task.`
    });

    return {
      ok: true,
      action: request.action,
      delegatedTo: {
        id: target.id,
        name: target.name,
        platform: target.platform
      },
      workerTaskId: workerResult.taskId,
      workspacePath: workerResult.workspacePath,
      branchName: workerResult.branchName,
      journalPath: workerResult.journalPath,
      response: truncateText(workerResult.response, 12000)
    };
  }

  async function handleDelegatedTasks(request) {
    const assignments = Array.isArray(request.assignments) ? request.assignments : [];

    if (assignments.length === 0) {
      throw new Error("delegate_tasks requires at least one assignment.");
    }

    const seenAgents = new Set();
    for (const assignment of assignments) {
      const key = assignment.agentId || assignment.agent?.toLowerCase();
      if (!key) {
        throw new Error("Each delegated assignment must include agent or agentId.");
      }

      if (seenAgents.has(key)) {
        throw new Error("delegate_tasks cannot assign multiple parallel tasks to the same agent.");
      }

      seenAgents.add(key);
    }

    const results = await Promise.all(
      assignments.map((assignment) =>
        handleDelegatedTask({
          action: "delegate_task",
          agent: assignment.agent,
          agentId: assignment.agentId,
          task: assignment.task,
          reason: request.reason
        })
      )
    );

    return {
      ok: true,
      action: request.action,
      results
    };
  }

  while (true) {
    latestResponse = await sendPromptAndWait(executionAgent, nextPrompt);

    const request = parseToolRequest(latestResponse);

    if (!request) {
      if (executedSteps > 0) {
        console.info(
          `[Hydra bridge] ${agent.name} completed after ${executedSteps} tool step(s).`
        );
      }

      return {
        response: appendHydraChangeSummary(latestResponse, accumulatedFileChanges),
        pendingRestart
      };
    }

    executedSteps += 1;
    const requestSignature = JSON.stringify(request);

    if (requestSignature === lastRequestSignature) {
      repeatedRequestCount += 1;
    } else {
      repeatedRequestCount = 1;
      lastRequestSignature = requestSignature;
    }

    if (repeatedRequestCount > MAX_IDENTICAL_TOOL_REQUESTS) {
      console.warn(
        `[Hydra bridge] ${agent.name} via ${executionAgent.name} repeated the same tool request ${repeatedRequestCount} times. Stopping to avoid an infinite loop.`
      );

      return {
        response: appendHydraChangeSummary(
          [
            latestResponse,
            "",
            `[Hydra] Tool bridge stopped because the same action was requested repeatedly (${request.action}).`,
            "[Hydra] The agent appears to be stuck in a loop. Rephrase the task or intervene manually."
          ].join("\n"),
          accumulatedFileChanges
        ),
        pendingRestart
      };
    }

    if (
      repeatedRequestCount >= 2 &&
      isCacheableToolAction(request.action) &&
      cachedResultsBySignature.has(requestSignature)
    ) {
      console.warn(
        `[Hydra bridge] ${agent.name} via ${executionAgent.name} repeated ${request.action}. Reusing cached result instead of executing again.`
      );
      nextPrompt = formatRepeatedToolResultPrompt(
        request,
        cachedResultsBySignature.get(requestSignature),
        repeatedRequestCount
      );
      continue;
    }

    console.info(
      `[Hydra bridge] Step ${executedSteps} for ${agent.name} via ${executionAgent.name}: ${request.action}`
    );

    let followUpPrompt = "";

    try {
      if (!executionContext.workspacePath) {
        throw new Error(
          "Project root folder is not configured. Set the root path in the project settings first."
        );
      }

      const availableWorkers = getAvailableWorkers(contextPayload, agent);
      const delegationRequired =
        agent.role === "orchestrator" &&
        availableWorkers.length > 0 &&
        (
          ORCHESTRATOR_WORKER_ONLY_ACTIONS.has(request.action) ||
          (
            !hasDelegatedImplementation &&
            ORCHESTRATOR_POST_DELEGATION_ACTIONS.has(request.action)
          )
        );

      if (delegationRequired) {
        emitTaskEvent(projectId, {
          taskId,
          agentId: agent.id,
          kind: "system",
          label: "Hydra",
          message: `Direct ${request.action} blocked. ${availableWorkers[0].name} or another worker must be assigned first.`
        });
        nextPrompt = formatDelegationRequiredPrompt(request, availableWorkers);
        continue;
      }

      const settings = await getAppSettings();
      const approved = await requestToolApproval({
        agent,
        request,
        projectRoot: executionContext.workspacePath,
        approvalMode: settings.approval_mode
      });

      if (!approved) {
        followUpPrompt = formatRejectedToolPrompt(request);
      } else {
        const result = await executeToolRequest(executionContext.workspacePath, request, {
          delegateTask: handleDelegatedTask,
          delegateTasks: handleDelegatedTasks,
          rebuildApp: () =>
            executeToolRequest(executionContext.workspacePath, {
              action: "run_command",
              cmd: "npm run build:renderer",
              reason: request.reason
            }),
          scheduleRestart: () => {
            pendingRestart = true;
            return Promise.resolve({
              ok: true,
              action: request.action,
              scheduled: true,
              message: "Hydra will restart the Electron app after this task finishes."
            });
          }
        });

        console.info(
          `[Hydra bridge] ${agent.name} via ${executionAgent.name} executed ${request.action} successfully.`
        );

        if (Array.isArray(result?.filesChanged) && result.filesChanged.length > 0) {
          recordFileChanges(accumulatedFileChanges, result.filesChanged);
        }

        if (shouldInvalidateToolCache(request.action)) {
          cachedResultsBySignature.clear();
        }

        if (isCacheableToolAction(request.action)) {
          cachedResultsBySignature.set(requestSignature, result);
        }

        followUpPrompt = formatToolResultPrompt(request, result);
      }
    } catch (error) {
      console.error(
        `[Hydra bridge] ${agent.name} via ${executionAgent.name} failed ${request.action}: ${error.message}`
      );
      followUpPrompt = formatToolResultPrompt(request, {
        ok: false,
        action: request.action,
        error: error.message
      });
    }

    nextPrompt = followUpPrompt;
  }
}

async function executeAgentTask({
  agent,
  projectId,
  task,
  parentAgent = null,
  executionAgent = agent
}) {
  const contextPayload = projectId ? await fetchContext(projectId) : null;
  const appSettings = await getAppSettings();
  const executionContext = await prepareExecutionContext(agent, contextPayload);

  function buildExecutionPrompt(activeExecutionAgent) {
    const promptAgent =
      activeExecutionAgent.id === agent.id
        ? agent
        : {
            ...agent,
            id: activeExecutionAgent.id
          };

    return buildPrompt(
      contextPayload,
      task,
      {
        id: promptAgent.id,
        name: promptAgent.name,
        role: promptAgent.role
      },
      {
        approvalMode: appSettings.approval_mode,
        workspacePath: executionContext.workspacePath,
        canonicalProjectRoot: executionContext.canonicalProjectRoot,
        branchName: executionContext.branchName,
        agentJournalPath: executionContext.journalPath,
        agentJournalContent: truncateText(executionContext.journalContent, 5000)
      }
    );
  }

  const initialPrompt = buildExecutionPrompt(executionAgent);
  const taskRecord = await createTask({
    projectId,
    agentId: agent.id,
    prompt: initialPrompt,
    userTask: task
  });

  if (projectId && agent.role === "orchestrator") {
    emitTaskEvent(projectId, {
      taskId: taskRecord.id,
      agentId: agent.id,
      kind: "user",
      label: "You",
      message: task
    });
  }

  let latestExecutionAgent = executionAgent;

  async function runWithExecutionAgent(activeExecutionAgent, attemptedIds = new Set()) {
    latestExecutionAgent = activeExecutionAgent;
    const knownUnavailable = getAgentTemporaryUnavailability(activeExecutionAgent.id);

    if (knownUnavailable && agent.role === "orchestrator") {
      const nextAttemptedIds = new Set([...attemptedIds, activeExecutionAgent.id]);
      const fallbackAgent = await pickFallbackExecutionAgent({
        logicalAgent: agent,
        executionAgent: activeExecutionAgent,
        attemptedIds: nextAttemptedIds
      });

      if (!fallbackAgent) {
        throw new Error(knownUnavailable.message);
      }

      if (projectId) {
        emitTaskEvent(projectId, {
          taskId: taskRecord.id,
          agentId: agent.id,
          kind: "system",
          label: "Hydra",
          message: `${activeExecutionAgent.name} is temporarily unavailable. Switching this task to ${fallbackAgent.name}.`
        });
      }

      return runWithExecutionAgent(fallbackAgent, nextAttemptedIds);
    }

    if (activeExecutionAgent.id === agent.id) {
      await updateAgentStatus(agent.id, "working");
    } else {
      if (!getAgentTemporaryUnavailability(agent.id)) {
        await updateAgentStatus(agent.id, "working");
      }
      await updateAgentStatus(activeExecutionAgent.id, "working");
    }

    try {
      await openAgentSession(activeExecutionAgent.id, activeExecutionAgent.platform);

      const bridgeResult = await continueWithToolBridge({
        agent,
        executionAgent: activeExecutionAgent,
        projectId,
        taskId: taskRecord.id,
        contextPayload,
        executionContext,
        initialPrompt: buildExecutionPrompt(activeExecutionAgent)
      });

      const temporaryUnavailableMessage = extractTemporaryUnavailableMessage(bridgeResult.response);

      if (temporaryUnavailableMessage) {
        throw new Error(temporaryUnavailableMessage);
      }

      clearAgentTemporaryUnavailability(activeExecutionAgent.id);
      return {
        bridgeResult,
        executionAgent: activeExecutionAgent
      };
    } catch (error) {
      const temporaryUnavailableMessage = extractTemporaryUnavailableMessage(error);

      if (temporaryUnavailableMessage && agent.role === "orchestrator") {
        const nextAttemptedIds = new Set([...attemptedIds, activeExecutionAgent.id]);
        const unavailableEntry = markAgentTemporarilyUnavailable(
          activeExecutionAgent.id,
          temporaryUnavailableMessage
        );

        await updateAgentStatus(activeExecutionAgent.id, "error");

        const fallbackAgent = await pickFallbackExecutionAgent({
          logicalAgent: agent,
          executionAgent: activeExecutionAgent,
          attemptedIds: nextAttemptedIds
        });

        if (fallbackAgent) {
          if (projectId) {
            emitTaskEvent(projectId, {
              taskId: taskRecord.id,
              agentId: agent.id,
              kind: "system",
              label: "Hydra",
              message: `${activeExecutionAgent.name} hit a message limit. Switching this task to ${fallbackAgent.name}.`
            });
          }

          return runWithExecutionAgent(fallbackAgent, nextAttemptedIds);
        }

        throw new Error(
          `${unavailableEntry.message} No backup orchestrator or worker is currently available.`
        );
      }

      throw error;
    }
  }

  try {
    await updateTaskStatus(taskRecord.id, "sent");
    await updateTaskStatus(taskRecord.id, "working");

    if (projectId && agent.role === "orchestrator") {
      emitTaskEvent(projectId, {
        taskId: taskRecord.id,
        agentId: agent.id,
        kind: "system",
        label: agent.name,
        message: "Reading the request and planning the next steps."
      });
    }

    const { bridgeResult, executionAgent: finalExecutionAgent } =
      await runWithExecutionAgent(executionAgent);

    await completeTask(taskRecord.id, bridgeResult.response);

    if (!getAgentTemporaryUnavailability(agent.id)) {
      await updateAgentStatus(agent.id, "done");
    }

    if (finalExecutionAgent.id !== agent.id) {
      await updateAgentStatus(finalExecutionAgent.id, "done");
    }

    if (projectId && agent.role === "orchestrator") {
      emitTaskEvent(projectId, {
        taskId: taskRecord.id,
        agentId: agent.id,
        kind: "assistant",
        label: agent.name,
        message:
          finalExecutionAgent.id === agent.id
            ? bridgeResult.response
            : [
                `[Fallback: ${finalExecutionAgent.name}]`,
                bridgeResult.response
              ].join("\n\n")
      });
    }

    if (executionContext.canonicalProjectRoot) {
      const notes = [
        parentAgent ? `Delegated by ${parentAgent.name}` : "",
        finalExecutionAgent.id !== agent.id
          ? `Executed through fallback agent ${finalExecutionAgent.name} (${finalExecutionAgent.platform}).`
          : ""
      ]
        .filter(Boolean)
        .join("\n");

      appendAgentJournal(executionContext.canonicalProjectRoot, agent, {
        task,
        status: "complete",
        workspacePath: executionContext.workspacePath,
        branchName: executionContext.branchName,
        summary: truncateText(bridgeResult.response),
        notes
      });
    }

    if (bridgeResult.pendingRestart) {
      scheduleAppRestart();
    }

    return {
      success: true,
      taskId: taskRecord.id,
      response: bridgeResult.response,
      workspacePath: executionContext.workspacePath,
      branchName: executionContext.branchName,
      journalPath: executionContext.journalPath
    };
  } catch (error) {
    await updateTaskStatus(taskRecord.id, "error");
    await updateAgentStatus(agent.id, "error");

    if (latestExecutionAgent.id !== agent.id) {
      await updateAgentStatus(latestExecutionAgent.id, "error");
    }

    if (projectId && agent.role === "orchestrator") {
      emitTaskEvent(projectId, {
        taskId: taskRecord.id,
        agentId: agent.id,
        kind: "error",
        label: agent.name,
        message: error.message
      });
    }

    if (executionContext.canonicalProjectRoot) {
      appendAgentJournal(executionContext.canonicalProjectRoot, agent, {
        task,
        status: "error",
        workspacePath: executionContext.workspacePath,
        branchName: executionContext.branchName,
        summary: error.message,
        notes: parentAgent ? `Delegated by ${parentAgent.name}` : ""
      });
    }

    throw error;
  }
}

export function runAgentTask(input) {
  return enqueueAgentTask(input.agent.id, () => executeAgentTask(input));
}

export function registerIpcHandlers() {
  ipcMain.removeHandler("agent-sync:get-config");
  ipcMain.removeHandler("agent-sync:open-agent");
  ipcMain.removeHandler("agent-sync:inspect-agent");
  ipcMain.removeHandler("agent-sync:send-task-to-agent");
  ipcMain.removeHandler("agent-sync:save-decisions");
  ipcMain.removeHandler("agent-sync:select-folder");

  ipcMain.handle("agent-sync:get-config", async () => ({
    serverUrl: getServerBaseUrl()
  }));

  ipcMain.handle("agent-sync:select-folder", async (event) => {
    const win = event.sender.getOwnerBrowserWindow?.() ?? null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle("agent-sync:open-agent", async (_event, payload) => {
    const { agentId, platform } = payload;
    return openAgentSession(agentId, platform);
  });

  ipcMain.handle("agent-sync:inspect-agent", async (_event, payload) => {
    const { agentId, platform } = payload;
    return inspectAgentSession(agentId, platform);
  });

  ipcMain.handle("agent-sync:send-task-to-agent", async (_event, payload) => {
    const { agentId, name, role, platform, projectId, task } = payload;
    return runAgentTask({
      agent: {
        id: agentId,
        name,
        role,
        platform
      },
      projectId,
      task
    });
  });

  ipcMain.handle("agent-sync:save-decisions", async (_event, payload) => {
    const { projectId, decisions } = payload;
    return saveDecisions(projectId, decisions);
  });
}
