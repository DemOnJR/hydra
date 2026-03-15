import { callAI } from "../ai/caller.js";
import { getModelForRole } from "../ai/modelConfig.js";
import { getAiSettings } from "../db/queries.js";
import {
  appendSessionLog,
  createOrchestratorSession,
  createTodo,
  getProjectById,
  getSessionById,
  saveDecision,
  searchContext,
  setSessionDecision,
  setSessionStatus,
  updateSession,
  updateTodoStatus
} from "../db/queries.js";
import { buildOrchestratorPrompt } from "../prompts/orchestrator.js";
import { buildOrchestratorContext } from "./contextBuilder.js";
import { getGitDiff, getGitStatus, listFiles, readFile, runCommand } from "./executor.js";

const activeProjectSessions = new Map();
const activeSessionRuns = new Map();

const ORCHESTRATOR_TOOLS = [
  {
    name: "list_files",
    description: "List files from the project root or a subdirectory.",
    parameters: {
      dir: {
        type: "string",
        description: "Relative directory path. Defaults to the project root."
      }
    }
  },
  {
    name: "read_file",
    description: "Read a file from the project root.",
    parameters: {
      path: {
        type: "string",
        description: "Relative file path."
      }
    }
  },
  {
    name: "run_command",
    description: "Run a safe local diagnostic command inside the project.",
    parameters: {
      cmd: {
        type: "string",
        description: "Command to execute."
      }
    }
  },
  {
    name: "git_status",
    description: "Inspect the current git branch and changed files.",
    parameters: {}
  },
  {
    name: "get_diff",
    description: "Get a git diff against a base branch like main.",
    parameters: {
      baseBranch: {
        type: "string",
        description: "Base branch name. Defaults to main."
      }
    }
  },
  {
    name: "search_context",
    description: "Search saved project decisions.",
    parameters: {
      query: {
        type: "string",
        description: "Search query."
      }
    }
  },
  {
    name: "save_decision",
    description: "Save a new decision in the project knowledge base.",
    parameters: {
      title: { type: "string", description: "Decision title." },
      content: { type: "string", description: "Decision content." },
      category: {
        type: "string",
        description: "Decision category such as architecture or bug-fix."
      }
    }
  },
  {
    name: "add_todo",
    description: "Create a TODO item for later work.",
    parameters: {
      title: { type: "string", description: "TODO title." },
      description: { type: "string", description: "TODO description." },
      priority: { type: "string", description: "low, medium, high, or critical." }
    }
  },
  {
    name: "complete_todo",
    description: "Mark a TODO item as complete.",
    parameters: {
      todoId: { type: "string", description: "TODO id." }
    }
  },
  {
    name: "request_approval",
    description: "Pause the session and request user approval.",
    parameters: {
      summary: { type: "string", description: "What needs approval." },
      branch: { type: "string", description: "Related git branch if any." }
    }
  }
];

function logSession(sessionId, message, level = "info", data = null) {
  appendSessionLog(sessionId, message, level, data);
}

function createToolResultMessages(provider, toolResults) {
  if (provider === "anthropic") {
    return [
      {
        role: "user",
        content: toolResults.map(({ toolCall, result }) => ({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: JSON.stringify(result),
          is_error: Boolean(result?.ok === false)
        }))
      }
    ];
  }

  return toolResults.map(({ toolCall, result }) => ({
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(result)
  }));
}

async function executeToolCall(toolCall, runtime) {
  const params = toolCall.params ?? {};
  const projectId = runtime.context.project.id;
  const projectRoot = runtime.context.project.rootPath;

  switch (toolCall.name) {
    case "list_files":
      return {
        ok: true,
        output: listFiles(projectRoot, params.dir || ".", { maxDepth: 3, maxEntries: 120 })
      };

    case "read_file":
      return {
        ok: true,
        output: readFile(projectRoot, params.path)
      };

    case "run_command":
      return {
        ok: true,
        ...(await runCommand(params.cmd, projectRoot, { timeout: 120000 }))
      };

    case "git_status":
      return {
        ok: true,
        ...(await getGitStatus(projectRoot))
      };

    case "get_diff":
      return {
        ok: true,
        diff: await getGitDiff(projectRoot, params.baseBranch || "main")
      };

    case "search_context":
      return {
        ok: true,
        results: searchContext(projectId, params.query)
      };

    case "save_decision":
      return {
        ok: true,
        decision: saveDecision(projectId, {
          title: String(params.title ?? "").trim(),
          content: String(params.content ?? "").trim(),
          category: String(params.category ?? "other").trim() || "other"
        })
      };

    case "add_todo":
      return {
        ok: true,
        todo: createTodo({
          projectId,
          title: String(params.title ?? "").trim(),
          description: String(params.description ?? "").trim(),
          priority: String(params.priority ?? "medium").trim()
        })
      };

    case "complete_todo":
      return {
        ok: true,
        todo: updateTodoStatus(String(params.todoId ?? "").trim(), "complete")
      };

    case "request_approval": {
      const summary = String(params.summary ?? "Approval requested.").trim();
      const branch = String(params.branch ?? "").trim();

      updateSession(runtime.sessionId, {
        status: "waiting_approval",
        summary,
        branch,
        decision: "pending"
      });

      return {
        ok: true,
        status: "waiting_approval",
        summary,
        branch
      };
    }

    default:
      throw new Error(`Unknown orchestrator tool "${toolCall.name}".`);
  }
}

async function runSession(sessionId) {
  const session = getSessionById(sessionId);

  if (!session) {
    throw new Error("Session not found.");
  }

  const context = await buildOrchestratorContext(session.project_id);
  const prompt = buildOrchestratorPrompt(context);

  setSessionStatus(sessionId, "running", {
    started_at: new Date().toISOString(),
    current_cycle: 0,
    last_error: ""
  });

  logSession(sessionId, "Session started.", "info", {
    projectId: session.project_id,
    model: session.orchestrator_model,
    dryRun: Boolean(session.dry_run)
  });

  if (session.dry_run) {
    const summary = `Dry run complete. Context prepared for ${context.project.name} on branch ${context.gitLog.branch}.`;
    updateSession(sessionId, {
      status: "complete",
      summary,
      completed_at: new Date().toISOString(),
      current_cycle: 1
    });
    logSession(sessionId, "Dry run completed.", "info", {
      branch: context.gitLog.branch,
      promptChars: prompt.length
    });
    return getSessionById(sessionId);
  }

  const runtime = {
    sessionId,
    context
  };

  const messages = [
    {
      role: "user",
      content:
        "Analyze the current project state. Use tools when needed. When you are done, provide a concise operational summary."
    }
  ];

  for (let cycle = 1; cycle <= session.max_cycles; cycle += 1) {
    updateSession(sessionId, {
      current_cycle: cycle
    });

    logSession(sessionId, `Cycle ${cycle}/${session.max_cycles}`, "info");

    const response = await callAI({
      model: session.orchestrator_model,
      systemPrompt: prompt,
      messages,
      tools: ORCHESTRATOR_TOOLS
    });

    if (response.text) {
      logSession(sessionId, `Assistant: ${response.text.slice(0, 500)}`, "info");
    }

    messages.push(response.assistantMessage);

    if (!response.toolCalls.length) {
      const summary = response.text || "Session completed without further actions.";
      updateSession(sessionId, {
        status: "complete",
        summary,
        completed_at: new Date().toISOString()
      });
      logSession(sessionId, "Session completed.", "info");
      return getSessionById(sessionId);
    }

    const toolResults = [];
    let approvalRequested = false;

    for (const toolCall of response.toolCalls) {
      try {
        const result = await executeToolCall(toolCall, runtime);
        toolResults.push({ toolCall, result });
        logSession(sessionId, `Tool ${toolCall.name} executed.`, "info", {
          tool: toolCall.name
        });

        if (toolCall.name === "request_approval") {
          approvalRequested = true;
        }
      } catch (error) {
        const result = {
          ok: false,
          error: error.message
        };
        toolResults.push({ toolCall, result });
        logSession(sessionId, `Tool ${toolCall.name} failed: ${error.message}`, "error");
      }
    }

    if (approvalRequested) {
      logSession(sessionId, "Session paused for approval.", "warning");
      return getSessionById(sessionId);
    }

    messages.push(...createToolResultMessages(response.provider, toolResults));
  }

  updateSession(sessionId, {
    status: "stopped",
    summary: "Session stopped after reaching the max cycle limit.",
    completed_at: new Date().toISOString()
  });
  logSession(sessionId, "Max cycle limit reached.", "warning");
  return getSessionById(sessionId);
}

export async function startOrchestratorSession(projectId, options = {}) {
  const project = getProjectById(projectId);

  if (!project) {
    throw new Error("Project not found.");
  }

  if (activeProjectSessions.has(projectId)) {
    const existingSessionId = activeProjectSessions.get(projectId);
    return getSessionById(existingSessionId);
  }

  const settings = getAiSettings();
  const maxCycles = Number.parseInt(String(options.maxCycles ?? "8"), 10);
  const session = createOrchestratorSession({
    projectId,
    mode: project.mode || "manual",
    orchestratorModel: getModelForRole("orchestrator", settings),
    maxCycles:
      Number.isNaN(maxCycles) || maxCycles < 1 ? 8 : Math.min(maxCycles, 20),
    dryRun: Boolean(options.dryRun)
  });

  activeProjectSessions.set(projectId, session.id);

  const runPromise = runSession(session.id)
    .catch((error) => {
      updateSession(session.id, {
        status: "error",
        last_error: error.message,
        summary: error.message,
        completed_at: new Date().toISOString()
      });
      logSession(session.id, `Session failed: ${error.message}`, "error");
    })
    .finally(() => {
      activeProjectSessions.delete(projectId);
      activeSessionRuns.delete(session.id);
    });

  activeSessionRuns.set(session.id, runPromise);
  return session;
}

export async function setOrchestratorDecision(sessionId, decision) {
  const session = getSessionById(sessionId);

  if (!session) {
    throw new Error("Session not found.");
  }

  const updated = setSessionDecision(sessionId, decision);
  logSession(sessionId, `Decision updated to ${decision}.`, "info");
  return updated;
}

export async function shutdownSessions() {
  await Promise.allSettled([...activeSessionRuns.values()]);
}
