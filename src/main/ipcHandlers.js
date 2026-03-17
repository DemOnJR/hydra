import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { buildPrompt } from "./promptBuilder.js";
import {
  inspectAgent as inspectPlaywrightAgent,
  isSessionConnected,
  openAgent as openPlaywrightAgent,
  injectPrompt,
  waitForResponse
} from "./playwrightManager.js";
import {
  inspectGeminiAgent,
  isGeminiSessionConnected,
  openGeminiAgent,
  sendGeminiPrompt
} from "./geminiBridgeManager.js";
import { getPlatformUrl } from "./platformUrls.js";
import {
  appendAgentJournal,
  detectGitRepository,
  getAgentJournalPath,
  readAgentJournal
} from "./projectWorkspace.js";
import {
  completeTask,
  createTask,
  fetchAgent,
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
import { callAI } from "../../server/ai/caller.js";

const MAX_IDENTICAL_TOOL_REQUESTS = 3;
const CACHEABLE_TOOL_ACTIONS = new Set([
  "list_files",
  "search_files",
  "read_file",
  "read_file_lines",
  "read_files",
  "batch_actions",
  "rebuild_app",
  "reload_app",
  "restart_app"
]);
const CACHE_INVALIDATING_TOOL_ACTIONS = new Set([
  "apply_patch",
  "write_file",
  "replace",
  "run_command",
  "rebuild_app",
  "reload_app",
  "restart_app",
  "delegate_task",
  "delegate_tasks"
]);
let restartScheduled = false;
const temporarilyUnavailableAgents = new Map();
const taskAiMetaByTaskId = new Map();
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

function normalizeTaskAiMeta(snapshot = {}) {
  const promptTokens = Number.isFinite(snapshot.promptTokens) ? snapshot.promptTokens : null;
  const completionTokens = Number.isFinite(snapshot.completionTokens)
    ? snapshot.completionTokens
    : null;
  const totalTokens = Number.isFinite(snapshot.totalTokens)
    ? snapshot.totalTokens
    : promptTokens != null && completionTokens != null
      ? promptTokens + completionTokens
      : null;
  const costUsd = Number.isFinite(snapshot.costUsd) ? snapshot.costUsd : null;

  return {
    provider: typeof snapshot.provider === "string" ? snapshot.provider : "",
    model: typeof snapshot.model === "string" ? snapshot.model : "",
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd
  };
}

function recordTaskAiMeta(taskId, patch = {}) {
  if (!taskId) {
    return;
  }

  const current = taskAiMetaByTaskId.get(taskId) || {
    provider: "",
    model: "",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0
  };

  const next = {
    ...current,
    provider: patch.provider || current.provider,
    model: patch.model || current.model,
    promptTokens:
      current.promptTokens + (Number.isFinite(patch.promptTokens) ? patch.promptTokens : 0),
    completionTokens:
      current.completionTokens +
      (Number.isFinite(patch.completionTokens) ? patch.completionTokens : 0),
    totalTokens:
      current.totalTokens + (Number.isFinite(patch.totalTokens) ? patch.totalTokens : 0),
    costUsd: current.costUsd + (Number.isFinite(patch.costUsd) ? patch.costUsd : 0)
  };

  taskAiMetaByTaskId.set(taskId, next);
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
      deletedLines: 0,
      diffs: []
    };

    existing.status =
      existing.status === "added" && file?.status === "deleted"
        ? "modified"
        : existing.status === "deleted" && file?.status === "added"
          ? "modified"
          : existing.status;
    existing.addedLines += Number(file?.addedLines ?? 0) || 0;
    existing.deletedLines += Number(file?.deletedLines ?? 0) || 0;
    
    if (file?.diff) {
      existing.diffs.push(file.diff);
    }
    
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

  const sections = [
    "[Hydra Change Summary]",
    `Files changed: ${files.length} | +${totalAdded} / -${totalDeleted}`
  ];

  for (const file of files) {
    sections.push(`- ${file.path} (${file.status}, +${Number(file.addedLines) || 0} / -${Number(file.deletedLines) || 0})`);
    if (file.diffs && file.diffs.length > 0) {
      sections.push("```diff");
      sections.push(file.diffs.join("\n\n"));
      sections.push("```");
    }
  }

  return sections.join("\n");
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

async function checkAgentBridgeConnection(agentId, platform) {
  if (platform === "gemini") {
    return isGeminiSessionConnected(agentId);
  }

  return isSessionConnected(agentId);
}

async function wakeUpAgent(agent) {
  console.info(`[Hydra] Attempting to wake up agent ${agent.name}...`);
  try {
    await openAgentSession(agent.id, agent.platform);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const isConnected = await checkAgentBridgeConnection(agent.id, agent.platform);
    if (isConnected) {
      console.info(`[Hydra] Agent ${agent.name} is now connected.`);
      clearAgentTemporaryUnavailability(agent.id);
      return true;
    }
    console.warn(`[Hydra] Agent ${agent.name} did not reconnect after opening browser.`);
    return false;
  } catch (error) {
    console.error(`[Hydra] Failed to wake up agent ${agent.name}:`, error.message);
    return false;
  }
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

  if (candidates.length > 0) {
    candidates.sort((left, right) => compareFallbackAgents(left, right, executionAgent.platform));
    return candidates[0] || null;
  }

  return null;
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
  if (platform === "local" || platform === "ollama" || platform === "google") {
    return { bridgeConnected: true };
  }

  const platformUrl = getPlatformUrl(platform);

  if (platform === "gemini") {
    return openGeminiAgent(agentId);
  }

  return openPlaywrightAgent(agentId, platformUrl);
}

async function inspectAgentSession(agentId, platform) {
  const platformUrl = getPlatformUrl(platform);

  let state;
  if (platform === "gemini") {
    state = await inspectGeminiAgent(agentId, platformUrl);
  } else {
    state = await inspectPlaywrightAgent(agentId, platform, platformUrl);
  }

  if (state.loggedIn) {
    try {
      const agent = await fetchAgent(agentId);
      if (agent?.status === "error") {
        await updateAgentStatus(agentId, "done");
      }
    } catch (err) {
      console.warn(`[Hydra] Could not fetch agent ${agentId} after session inspection.`, err);
    }
  }

  return state;
}

async function sendPromptAndWait(agent, prompt, timeoutMs = 240000, taskId = null, projectId = null, history = [], task = null) {
  if (agent.platform === "ollama" || agent.platform === "google" || agent.platform === "local") {
    let model = agent.specialty?.trim();
    
    if (!model) {
      if (agent.platform === "ollama") {
        model = process.env.OLLAMA_MODEL || "qwen3.5:0.8b";
      } else if (agent.platform === "local") {
        model = "local/onnx-community/Qwen3.5-0.8B-ONNX";
      } else {
        model = "gemini-1.5-pro";
      }
    } else if (agent.platform === "local" && !model.startsWith("local/")) {
      model = `local/${model}`;
    }

    console.info(`[Hydra] Routing ${agent.name} task to API caller (${agent.platform}) with model ${model}...`);
    
    // Optimization: If the user task is very short (e.g. "hi"), use a lite system prompt
    const isLite = task && task.length < 50 && !task.toLowerCase().includes("file") && !task.toLowerCase().includes("run") && history.length === 0;
    const systemPrompt = isLite 
      ? "You are a helpful AI assistant. Be concise."
      : "You are an AI agent in the Hydra ecosystem. Respond naturally to the user or use tools if requested.";

    const messages = [...history, { role: "user", content: prompt }];

    let accumulatedText = "";
    const result = await callAI({
      model,
      systemPrompt,
      messages,
      onToken: (token) => {
        accumulatedText += token;
        if (taskId && projectId) {
          emitTaskEvent(projectId, {
            taskId,
            agentId: agent.id,
            kind: "neural_streaming",
            label: agent.name,
            message: accumulatedText // This will update the UI in real-time
          });
        }
      },
      onProgress: (info) => {
        if (taskId && projectId && info.status === "progress") {
          const progress = info.progress || 0;
          const file = info.file || "weights";
          emitTaskEvent(projectId, {
            taskId,
            agentId: agent.id,
            kind: "progress",
            label: agent.name,
            message: `[Downloading ${file}: ${progress.toFixed(1)}%]`
          });
        }
      }
    });

    if (result?.usageNormalized) {
      recordTaskAiMeta(taskId, {
        provider: result.provider,
        model,
        promptTokens: result.usageNormalized.promptTokens ?? 0,
        completionTokens: result.usageNormalized.completionTokens ?? 0,
        totalTokens: result.usageNormalized.totalTokens ?? 0,
        costUsd: result.costUsd ?? 0
      });
    }

    return result.text;
  }

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
    workerContext.workspacePath
      ? `Work directly in the project root: ${workerContext.workspacePath}.`
      : "Work directly in the configured project root.",
    "At the end, summarize exact files changed, commands run, and blockers for the orchestrator.",
  ].join("\n");
}

function matchAgentFromRequest(request, agents) {
  const byId = request.agentId?.trim();
  const byName = request.agent?.trim().toLowerCase();

  if (!byId && !byName) {
    return null;
  }

  const exactMatch = agents.find((agent) => {
    if (byId && agent.id === byId) {
      return true;
    }
    if (byName && agent.name.trim().toLowerCase() === byName) {
      return true;
    }
    return false;
  });

  if (exactMatch) {
    return exactMatch;
  }

  if (byName) {
    const partialMatch = agents.find((agent) => {
      const agentName = agent.name.trim().toLowerCase();
      return agentName.includes(byName) || byName.includes(agentName);
    });
    return partialMatch || null;
  }

  return null;
}

async function continueWithToolBridge({
  agent,
  executionAgent = agent,
  projectId,
  taskId,
  contextPayload,
  executionContext,
  initialPrompt,
  task
}) {
  let latestResponse = "";
  let executedSteps = 0;
  let lastRequestSignature = "";
  let repeatedRequestCount = 0;
  let pendingRestart = false;
  let nextPrompt = initialPrompt;
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

  const history = [];
  let currentPrompt = nextPrompt;

  while (true) {
    latestResponse = await sendPromptAndWait(executionAgent, currentPrompt, 240000, taskId, projectId, history, task);
    
    // Add current turn to history
    history.push({ role: "user", content: currentPrompt });
    history.push({ role: "assistant", content: latestResponse });

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
      currentPrompt = formatRepeatedToolResultPrompt(
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

      // Note: All agents operate directly in the canonical project root.
      // Delegation remains available, but edits are not blocked when workers exist.

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
        if (projectId && agent.role === "orchestrator") {
          emitTaskEvent(projectId, {
            taskId: taskId,
            agentId: agent.id,
            kind: "tool_start",
            label: agent.name,
            action: request.action,
            message: request.reason || request.action
          });
        }
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
        if (projectId && agent.role === "orchestrator") {
          emitTaskEvent(projectId, {
            taskId: taskId,
            agentId: agent.id,
            kind: "tool_done",
            label: agent.name,
            action: request.action,
            message: request.reason || request.action
          });
        }

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
      if (projectId && agent.role === "orchestrator") {
        emitTaskEvent(projectId, {
          taskId: taskId,
          agentId: agent.id,
          kind: "tool_error",
          label: agent.name,
          action: request.action,
          message: error.message
        });
      }
      followUpPrompt = formatToolResultPrompt(request, {
        ok: false,
        action: request.action,
        error: error.message
      });
    }

    currentPrompt = followUpPrompt;
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

  const taskId = taskRecord.id;

  if (projectId && agent.role === "orchestrator") {
    emitTaskEvent(projectId, {
      taskId: taskId,
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
          taskId: taskId,
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

    const isAgentConnected = await checkAgentBridgeConnection(activeExecutionAgent.id, activeExecutionAgent.platform);
    if (!isAgentConnected) {
      console.info(`[Hydra] Agent ${activeExecutionAgent.name} appears offline before task execution. Attempting to wake up...`);
      emitTaskEvent(projectId, {
        taskId: taskId,
        agentId: agent.id,
        kind: "system",
        label: "Hydra",
        message: `${activeExecutionAgent.name} appears offline. Attempting to wake up...`
      });
      const wokeUp = await wakeUpAgent(activeExecutionAgent);
      if (!wokeUp) {
        markAgentTemporarilyUnavailable(activeExecutionAgent.id, "Agent was offline and wake-up failed.");
        const fallbackAgent = await pickFallbackExecutionAgent({
          logicalAgent: agent,
          executionAgent: activeExecutionAgent,
          attemptedIds: new Set([...attemptedIds, activeExecutionAgent.id])
        });
        if (fallbackAgent) {
          emitTaskEvent(projectId, {
            taskId: taskId,
            agentId: agent.id,
            kind: "system",
            label: "Hydra",
            message: `${activeExecutionAgent.name} failed to reconnect. Switching to ${fallbackAgent.name}.`
          });
          return runWithExecutionAgent(fallbackAgent, new Set([...attemptedIds, activeExecutionAgent.id]));
        }
        throw new Error(`${activeExecutionAgent.name} is offline and could not be woken up. No fallback available.`);
      }
      emitTaskEvent(projectId, {
        taskId: taskId,
        agentId: agent.id,
        kind: "system",
        label: "Hydra",
        message: `${activeExecutionAgent.name} is now connected!`
      });
    }

    try {
      await openAgentSession(activeExecutionAgent.id, activeExecutionAgent.platform);

      const bridgeResult = await continueWithToolBridge({
        agent,
        executionAgent: activeExecutionAgent,
        projectId,
        taskId: taskId,
        contextPayload,
        executionContext,
        initialPrompt: buildExecutionPrompt(activeExecutionAgent),
        task
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

        const fallbackAgent = await pickFallbackExecutionAgent({
          logicalAgent: agent,
          executionAgent: activeExecutionAgent,
          attemptedIds: nextAttemptedIds
        });

        if (fallbackAgent) {
          if (projectId) {
            emitTaskEvent(projectId, {
              taskId: taskId,
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
    await updateTaskStatus(taskId, "sent");
    await updateTaskStatus(taskId, "working");

    if (projectId && agent.role === "orchestrator") {
      emitTaskEvent(projectId, {
        taskId: taskId,
        agentId: agent.id,
        kind: "system",
        label: agent.name,
        message: "Reading the request and planning the next steps."
      });
    }

    const { bridgeResult, executionAgent: finalExecutionAgent } =
      await runWithExecutionAgent(executionAgent);

    const aiMeta = taskAiMetaByTaskId.get(taskId) || null;
    taskAiMetaByTaskId.delete(taskId);
    await completeTask(taskId, bridgeResult.response, aiMeta ? normalizeTaskAiMeta(aiMeta) : null);

    if (!getAgentTemporaryUnavailability(agent.id)) {
      await updateAgentStatus(agent.id, "done");
    }

    if (finalExecutionAgent.id !== agent.id) {
      await updateAgentStatus(finalExecutionAgent.id, "done");
    }

    if (projectId && agent.role === "orchestrator") {
      emitTaskEvent(projectId, {
        taskId: taskId,
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
      taskId: taskId,
      response: bridgeResult.response,
      workspacePath: executionContext.workspacePath,
      branchName: executionContext.branchName,
      journalPath: executionContext.journalPath
    };
  } catch (error) {
    taskAiMetaByTaskId.delete(taskId);
    await updateTaskStatus(taskId, "error");
    await updateAgentStatus(agent.id, "error");

    if (latestExecutionAgent.id !== agent.id) {
      await updateAgentStatus(latestExecutionAgent.id, "error");
    }

    if (projectId && agent.role === "orchestrator") {
      const isBrowserClosed = error?.message?.startsWith("BROWSER_CLOSED:");
      emitTaskEvent(projectId, {
        taskId: taskId,
        agentId: agent.id,
        kind: "error",
        label: agent.name,
        message: isBrowserClosed
          ? "Agent browser was closed. Please reopen the browser session and retry."
          : error.message
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
  return executeAgentTask(input);
}

export function registerIpcHandlers() {
  ipcMain.removeHandler("agent-sync:get-config");
  ipcMain.removeHandler("agent-sync:get-agent-journal");
  ipcMain.removeHandler("agent-sync:open-agent");
  ipcMain.removeHandler("agent-sync:inspect-agent");
  ipcMain.removeHandler("agent-sync:send-task-to-agent");
  ipcMain.removeHandler("agent-sync:save-decisions");
  ipcMain.removeHandler("agent-sync:select-folder");

  ipcMain.handle("agent-sync:get-config", async () => ({
    serverUrl: getServerBaseUrl()
  }));

  ipcMain.handle("agent-sync:get-agent-journal", async (_event, payload) => {
    const projectRoot = String(payload?.projectRoot ?? "").trim();
    const agent = payload?.agent ?? {};
    const agentId = String(agent.id ?? payload?.agentId ?? "").trim();

    if (!projectRoot) {
      throw new Error("projectRoot is required.");
    }

    if (!agentId) {
      throw new Error("agent.id is required.");
    }

    const normalizedAgent = {
      id: agentId,
      name: String(agent.name ?? "").trim() || agentId,
      session_dir: String(agent.session_dir ?? agent.sessionDir ?? "").trim()
    };

    return {
      ok: true,
      journalPath: getAgentJournalPath(projectRoot, normalizedAgent),
      content: readAgentJournal(projectRoot, normalizedAgent)
    };
  });

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
