function normalizeForComparison(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function snippet(value, maxLength = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function formatSessionHistory(sessions = [], options = {}) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return "";
  }

  const currentTask = normalizeForComparison(options.currentTask);

  return sessions
    .filter((session) => {
      if (!currentTask) {
        return true;
      }

      return normalizeForComparison(session.user_task) !== currentTask;
    })
    .slice(0, 4)
    .map(
      (session) =>
        `- ${session.agent_name} (${session.platform}) user asked: ${snippet(session.user_task, 220)}\n  Result: ${snippet(session.response || session.status, 260)}`
    )
    .join("\n");
}

function formatContextPayload(payload, agent = null, options = {}) {
  if (!payload) {
    return "";
  }

  const sections = [];
  const project = payload.project || {};
  const context = payload.context || {};
  const decisions = payload.decisions || [];
  const todos = payload.todos || [];
  const agents = payload.agents || [];
  const memory = payload.memory || {};
  const history = payload.history || {};
  const toolRoot = options.workspacePath || project.root_path || "";
  const canonicalProjectRoot = options.canonicalProjectRoot || project.root_path || "";
  const relevantHistory =
    agent?.role === "orchestrator" ? history.orchestrator || [] : history.workers || [];
  const relevantCompactSummary =
    agent?.role === "orchestrator"
      ? memory.orchestrator_summary || ""
      : memory.worker_summary || "";

  if (toolRoot) {
    sections.push(`Active working folder for this agent:\n${toolRoot}`);
  }

  if (project.name) {
    sections.push(`Project:\n${project.name}`);
  }

  if (project.description) {
    sections.push(`Project description:\n${project.description}`);
  }

  if (canonicalProjectRoot && canonicalProjectRoot !== toolRoot) {
    sections.push(`Canonical project root folder:\n${canonicalProjectRoot}`);
  } else if (project.root_path && !toolRoot) {
    sections.push(`Project root folder:\n${project.root_path}`);
  }

  if (project.mode) {
    sections.push(`Project mode:\n${project.mode}`);
  }

  if (memory.shared_summary) {
    sections.push(`Shared compact context:\n${memory.shared_summary}`);
  }

  if (relevantCompactSummary) {
    sections.push(
      `${agent?.role === "orchestrator" ? "Orchestrator" : "Worker"} compact memory:\n${relevantCompactSummary}`
    );
  }

  if (memory.recent_changes) {
    sections.push(`Recent changes across the project:\n${memory.recent_changes}`);
  }

  if (context.architecture) {
    sections.push(`Architecture:\n${context.architecture}`);
  }

  if (context.tech_stack) {
    sections.push(`Tech stack:\n${context.tech_stack}`);
  }

  if (context.conventions) {
    sections.push(`Conventions:\n${context.conventions}`);
  }

  if (decisions.length > 0) {
    sections.push(
      `Recent decisions:\n${decisions
        .map((decision) => `- ${decision.title}: ${decision.content}`)
        .join("\n")}`
    );
  }

  if (todos.length > 0) {
    sections.push(
      `Pending TODOs:\n${todos
        .map((todo) => `- [${todo.priority}] ${todo.title}${todo.description ? `: ${todo.description}` : ""}`)
        .join("\n")}`
    );
  }

  if (agents.length > 0) {
    sections.push(
      `Agent roster:\n${agents
        .map(
          (agent) =>
            `- ${agent.name} (${agent.platform}, ${agent.role}, ${agent.status}${agent.specialty ? `, specialty: ${agent.specialty}` : ""})`
        )
        .join("\n")}`
    );
  }

  if (relevantHistory.length > 0) {
    sections.push(
      `Recent ${agent?.role === "orchestrator" ? "orchestrator" : "worker"} sessions:\n${formatSessionHistory(
        relevantHistory,
        { currentTask: options.currentTask }
      )}`
    );
  }

  if (options.branchName) {
    sections.push(`Assigned git branch:\n${options.branchName}`);
  }

  if (options.agentJournalPath) {
    sections.push(`Agent journal file:\n${options.agentJournalPath}`);
  }

  if (options.agentJournalContent?.trim()) {
    sections.push(`Previous agent journal entries:\n${options.agentJournalContent.trim()}`);
  }

  return sections.join("\n\n");
}

function buildToolBridgeSection(project = {}, agent = null, options = {}) {
  const approvalMode = options.approvalMode || "manual";
  const projectRoot = options.workspacePath || project.root_path || "(not set)";
  const workers = Array.isArray(options.availableWorkers) ? options.availableWorkers : [];
  const workerList = workers.length
    ? workers.map((worker) => `${worker.name} (${worker.platform})`).join(", ")
    : "none";

  return [
    "[HYDRA BRIDGE]",
    "You do have access to the user's PC through Hydra.",
    `Active tool root folder: ${projectRoot}`,
    `Approval mode: ${approvalMode}`,
    "When you need local access, do not say you lack access.",
    "Instead, respond with exactly one fenced code block in this format:",
    "```hydra",
    JSON.stringify(
      {
        action: "read_file",
        path: "src/index.js",
        reason: "Need to inspect the current implementation before editing."
      },
      null,
      2
    ),
    "```",
    "Supported actions:",
    '- {"action":"list_files","dir":"src","reason":"..."}',
    '- {"action":"search_files","dir":"src","pattern":"TaskBroadcast","reason":"Locate the most relevant file by text or symbol before reading it."}',
    '- {"action":"read_file","path":"src/index.js","reason":"..."}',
    '- {"action":"read_files","paths":["src/App.jsx","src/styles.css"],"reason":"Read multiple relevant files together before editing."}',
    '- {"action":"batch_actions","actions":[{"action":"search_files","dir":"src/renderer","pattern":"TaskBroadcast"},{"action":"read_files","paths":["src/renderer/components/TaskBroadcast.jsx","src/renderer/styles.css"]}],"reason":"Bundle read-only discovery to reduce round trips."}',
    '- {"action":"apply_patch","patch":"diff --git a/src/index.js b/src/index.js\\n--- a/src/index.js\\n+++ b/src/index.js\\n@@ ...","reason":"Apply a targeted unified diff instead of rewriting the whole file."}',
    '- {"action":"write_file","path":"src/index.js","content":"full file content","reason":"..."}',
    '- {"action":"run_command","cmd":"npm test","reason":"..."}',
    '- {"action":"rebuild_app","reason":"Rebuild the Electron renderer after code changes."}',
    '- {"action":"reload_app","reason":"Reload the visible Electron window after a successful rebuild."}',
    '- {"action":"restart_app","reason":"Restart the Electron app as a final step only when reload_app is not enough."}',
    agent?.role === "orchestrator"
      ? '- {"action":"delegate_task","agent":"Worker name","task":"Implement X, then summarize exact changes.","reason":"Split the work."}'
      : null,
    agent?.role === "orchestrator"
      ? '- {"action":"delegate_tasks","assignments":[{"agent":"Worker A","task":"..."},{"agent":"Worker B","task":"..."}],"reason":"Parallelize independent tasks."}'
      : null,
    "Request one action at a time.",
    "When you need to locate a component, UI string, CSS class, or symbol, prefer search_files over repeated list_files calls.",
    "When you already know several relevant files, use read_files instead of separate read_file calls.",
    "If the next steps are read-only discovery, you may bundle them with batch_actions instead of doing one round trip per search/read.",
    "Use batch_actions only for read-only discovery. Keep writes, commands, rebuilds, reloads, restarts, and delegation as separate actions.",
    "For targeted edits to existing files, prefer apply_patch with a unified diff instead of rewriting the entire file.",
    "Use write_file mainly for creating brand-new files or replacing most of a file on purpose.",
    "Prefer rebuild_app plus reload_app during normal iteration. Use restart_app only as the last step because Hydra does not resume the same task after a full relaunch.",
    agent?.role === "orchestrator"
      ? `Available workers for delegation: ${workerList}`
      : "If you are a worker, stay within your isolated workspace and summarize your changes for the orchestrator.",
    agent?.role === "orchestrator"
      ? "When delegating, prefer the worker whose specialty best matches the task, for example design/UI work to a worker labeled design."
      : null,
    agent?.role === "orchestrator" && workers.length > 0
      ? "You are the coordinator, not the primary implementer. For any request that changes code, UI, styles, files, app behavior, tests, or docs, do minimal read-only discovery first and then delegate the implementation to one or more workers."
      : null,
    agent?.role === "orchestrator" && workers.length > 0
      ? "Do not use write_file yourself for product changes while workers are available. Your job is to plan, delegate, review worker output, optionally validate, and summarize."
      : null,
    agent?.role === "orchestrator" && workers.length > 0
      ? "Only skip delegation for pure conversation, routing, or read-only analysis where no file changes are needed."
      : null,
    agent?.role === "orchestrator" && workers.length > 0
      ? "Preferred flow: 1) inspect with search_files/read_files, 2) delegate_task or delegate_tasks, 3) review results, 4) run validation if useful, 5) answer the user."
      : null,
    "If you need clarification from the user, ask in plain text and then stop.",
    "Do not rely on provider-native widgets, questionnaires, clickable cards, or forms because Hydra cannot continue from those interactions.",
    "When offering explicit choices, append a [HYDRA_REPLY_OPTIONS] block so Hydra can render the choices inside its own chat UI.",
    "Use this exact format for each follow-up question that has choices:",
    "[HYDRA_REPLY_OPTIONS]",
    "question: Which option should I use?",
    "mode: single",
    "- First option",
    "- Second option",
    "[/HYDRA_REPLY_OPTIONS]",
    "If the user can choose multiple items, use mode: multi.",
    "If you need more than one follow-up question, emit one [HYDRA_REPLY_OPTIONS] block per question.",
    "Hydra automatically keeps a markdown worklog per agent after each completed task.",
    "After Hydra sends back [HYDRA_TOOL_RESULT], continue from that result.",
    "[END HYDRA BRIDGE]"
  ].filter(Boolean).join("\n");
}

export function buildPrompt(contextPayload, task, agent = null, options = {}) {
  const availableWorkers = (contextPayload?.agents || []).filter(
    (candidate) => candidate.role === "worker" && candidate.id !== agent?.id
  );
  const formattedContext = formatContextPayload(contextPayload, agent, options);
  const roleLine = agent?.role
    ? `[AGENT ROLE]\nYou are acting as the ${agent.role} agent${agent.name ? ` named "${agent.name}"` : ""}.\n[END AGENT ROLE]\n\n`
    : "";
  const toolBridge = `${buildToolBridgeSection(contextPayload?.project || {}, agent, {
    ...options,
    availableWorkers
  })}\n\n`;

  const currentTaskSection = [
    "[CURRENT USER REQUEST]",
    "Treat previous sessions only as memory. Do not answer an older request when it resembles the current one.",
    task,
    "[END CURRENT USER REQUEST]"
  ].join("\n");

  if (!formattedContext) {
    return `${roleLine}${toolBridge}${currentTaskSection}`.trim();
  }

  return `${roleLine}${toolBridge}[PROJECT CONTEXT]\n${formattedContext}\n[END PROJECT CONTEXT]\n\n${currentTaskSection}`;
}
