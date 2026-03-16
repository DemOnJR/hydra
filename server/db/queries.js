import { v4 as uuidv4 } from "uuid";
import { formatModelSettings, toDbModelPatch } from "../ai/modelConfig.js";
import { getDb } from "./schema.js";

const PROJECT_MODES = ["manual", "semi-auto", "full-auto"];
const TODO_STATUSES = ["pending", "in_progress", "complete"];
const TODO_PRIORITIES = ["low", "medium", "high", "critical"];
const SESSION_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "complete",
  "error",
  "stopped"
];
const SESSION_DECISIONS = ["pending", "approved", "rejected"];
const AGENT_ROLES = ["orchestrator", "worker"];
const APPROVAL_MODES = ["manual", "auto"];

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(value, maxLength = 220) {
  const normalized = normalizeWhitespace(value);
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3).trimEnd()}...`
    : normalized;
}

function isoOrEmpty(value) {
  return value ? String(value) : "";
}

function normalizeProjectMode(mode) {
  const normalized = typeof mode === "string" ? mode.trim() : "";
  return PROJECT_MODES.includes(normalized) ? normalized : "manual";
}

function normalizeTodoPriority(priority) {
  const normalized = typeof priority === "string" ? priority.trim() : "";
  return TODO_PRIORITIES.includes(normalized) ? normalized : "medium";
}

function normalizeTodoStatus(status) {
  const normalized = typeof status === "string" ? status.trim() : "";

  if (!TODO_STATUSES.includes(normalized)) {
    throw new Error(`Invalid todo status "${status}".`);
  }

  return normalized;
}

function normalizeSessionStatus(status) {
  const normalized = typeof status === "string" ? status.trim() : "";

  if (!SESSION_STATUSES.includes(normalized)) {
    throw new Error(`Invalid session status "${status}".`);
  }

  return normalized;
}

function normalizeSessionDecision(decision) {
  const normalized = typeof decision === "string" ? decision.trim() : "";

  if (!SESSION_DECISIONS.includes(normalized)) {
    throw new Error(`Invalid session decision "${decision}".`);
  }

  return normalized;
}

function normalizeAgentRole(role) {
  const normalized = typeof role === "string" ? role.trim() : "";
  return AGENT_ROLES.includes(normalized) ? normalized : "worker";
}

function normalizeApprovalMode(mode) {
  const normalized = typeof mode === "string" ? mode.trim() : "";
  return APPROVAL_MODES.includes(normalized) ? normalized : "manual";
}

function getConversationChannelForRole(role) {
  return role === "orchestrator" ? "orchestrator" : "worker";
}

function upsertProjectCompaction(projectId, patch = {}) {
  const db = getDb();
  db.prepare(`
      INSERT INTO project_compactions (
        project_id,
        orchestrator_summary,
        worker_summary,
        shared_summary,
        recent_changes,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(project_id) DO UPDATE SET
        orchestrator_summary = excluded.orchestrator_summary,
        worker_summary = excluded.worker_summary,
        shared_summary = excluded.shared_summary,
        recent_changes = excluded.recent_changes,
        updated_at = datetime('now')
    `).run(
    projectId,
    String(patch.orchestrator_summary ?? ""),
    String(patch.worker_summary ?? ""),
    String(patch.shared_summary ?? ""),
    String(patch.recent_changes ?? "")
  );

  return getProjectCompaction(projectId);
}

function buildCompactionText(projectId) {
  const project = getProjectById(projectId);
  const context = getProjectContext(projectId);
  const decisions = getRecentDecisions(projectId, 8);
  const todos = getPendingTodos(projectId, 8);
  const sessions = getProjectConversationSessions(projectId, { limit: 12 });
  const orchestratorSessions = sessions.filter((session) => session.agent_role === "orchestrator");
  const workerSessions = sessions.filter((session) => session.agent_role !== "orchestrator");
  const recentChangesItems = sessions.filter((session) => session.response?.trim()).slice(0, 8);

  const sharedSections = [];

  if (project?.description?.trim()) {
    sharedSections.push(`Project direction: ${snippet(project.description, 320)}`);
  }

  if (project?.root_path?.trim()) {
    sharedSections.push(`Project root: ${project.root_path.trim()}`);
  }

  if (context.architecture?.trim()) {
    sharedSections.push(`Architecture: ${snippet(context.architecture, 320)}`);
  }

  if (context.tech_stack?.trim()) {
    sharedSections.push(`Tech stack: ${snippet(context.tech_stack, 220)}`);
  }

  if (context.conventions?.trim()) {
    sharedSections.push(`Conventions: ${snippet(context.conventions, 220)}`);
  }

  if (decisions.length > 0) {
    sharedSections.push(
      `Key decisions:\n${decisions
        .map((decision) => `- ${decision.title}: ${snippet(decision.content, 220)}`)
        .join("\n")}`
    );
  }

  if (todos.length > 0) {
    sharedSections.push(
      `Open work:\n${todos
        .map((todo) => `- [${todo.priority}] ${todo.title}${todo.description ? `: ${snippet(todo.description, 160)}` : ""}`)
        .join("\n")}`
    );
  }

  const sharedSummary = sharedSections.join("\n\n");

  const orchestratorSummary = [
    "Compressed memory for the orchestrator.",
    sharedSummary || "No shared project memory yet.",
    orchestratorSessions.length > 0
      ? `Recent orchestrator sessions:\n${orchestratorSessions
          .slice(0, 6)
          .map(
            (session) =>
              `- User asked: ${snippet(session.user_task, 180)} | ${session.agent_name} recommended: ${snippet(session.response || session.status, 220)}`
          )
          .join("\n")}`
      : "Recent orchestrator sessions:\n- none yet",
    recentChangesItems.length > 0
      ? `Recent implementation changes:\n${recentChangesItems
          .slice(0, 6)
          .map(
            (session) =>
              `- ${session.agent_name} (${session.platform}) changed: ${snippet(session.response, 220)}`
          )
          .join("\n")}`
      : "Recent implementation changes:\n- none yet"
  ]
    .filter(Boolean)
    .join("\n\n");

  const workerSummary = [
    "Compressed memory for worker agents.",
    sharedSummary || "No shared project memory yet.",
    orchestratorSessions.length > 0
      ? `Latest orchestrator guidance:\n${orchestratorSessions
          .slice(0, 4)
          .map(
            (session) =>
              `- ${session.agent_name} direction: ${snippet(session.response || session.user_task, 220)}`
          )
          .join("\n")}`
      : "Latest orchestrator guidance:\n- none yet",
    workerSessions.length > 0
      ? `Recent worker outcomes:\n${workerSessions
          .slice(0, 6)
          .map(
            (session) =>
              `- ${session.agent_name}: ${snippet(session.response || session.user_task, 220)}`
          )
          .join("\n")}`
      : "Recent worker outcomes:\n- none yet"
  ]
    .filter(Boolean)
    .join("\n\n");

  const recentChanges = recentChangesItems.length
    ? recentChangesItems
        .slice(0, 10)
        .map(
          (session) =>
            `- ${session.agent_name} (${session.agent_role}) at ${isoOrEmpty(session.completed_at || session.created_at)}: ${snippet(session.response, 260)}`
        )
        .join("\n")
    : "";

  return {
    shared_summary: sharedSummary,
    orchestrator_summary: orchestratorSummary,
    worker_summary: workerSummary,
    recent_changes: recentChanges
  };
}

export function getAllProjects() {
  return getDb()
    .prepare("SELECT * FROM projects ORDER BY is_active DESC, created_at DESC")
    .all();
}

export function getProjectById(id) {
  return getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id);
}

export function getActiveProject() {
  return getDb().prepare("SELECT * FROM projects WHERE is_active = 1 LIMIT 1").get();
}

export function createProject({ name, description = "", rootPath = "", mode = "manual" }) {
  const db = getDb();
  const id = uuidv4();
  const shouldActivate = !getActiveProject();

  db.prepare(
    `
      INSERT INTO projects (id, name, description, root_path, mode, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(id, name, description, rootPath, normalizeProjectMode(mode), shouldActivate ? 1 : 0);

  db.prepare("INSERT INTO project_context (project_id) VALUES (?)").run(id);

  return getProjectById(id);
}

export function updateProject(id, patch = {}) {
  const current = getProjectById(id);

  if (!current) {
    return null;
  }

  const nextName =
    patch.name === undefined ? current.name : String(patch.name).trim();
  const nextDescription =
    patch.description === undefined ? current.description : String(patch.description).trim();
  const nextRootPath =
    patch.rootPath === undefined && patch.root_path === undefined
      ? current.root_path
      : String(patch.rootPath ?? patch.root_path ?? "").trim();
  const nextMode = normalizeProjectMode(patch.mode ?? current.mode);

  getDb()
    .prepare(`
      UPDATE projects
      SET name = ?,
          description = ?,
          root_path = ?,
          mode = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `)
    .run(nextName, nextDescription, nextRootPath, nextMode, id);

  return getProjectById(id);
}

export function setActiveProject(id) {
  const db = getDb();
  const tx = db.transaction((projectId) => {
    db.prepare("UPDATE projects SET is_active = 0, updated_at = datetime('now')").run();
    db.prepare(
      "UPDATE projects SET is_active = 1, updated_at = datetime('now') WHERE id = ?"
    ).run(projectId);
  });

  tx(id);
  return getProjectById(id);
}

export function deleteProject(id) {
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function getProjectContext(projectId) {
  return (
    getDb()
      .prepare("SELECT * FROM project_context WHERE project_id = ?")
      .get(projectId) || {}
  );
}

export function updateProjectContext(projectId, contextPatch) {
  const { architecture, tech_stack, conventions } = contextPatch;

  getDb()
    .prepare(`
      UPDATE project_context
      SET architecture = COALESCE(?, architecture),
          tech_stack = COALESCE(?, tech_stack),
          conventions = COALESCE(?, conventions),
          updated_at = datetime('now')
      WHERE project_id = ?
    `)
    .run(architecture, tech_stack, conventions, projectId);

  refreshProjectCompaction(projectId);
  return getProjectContext(projectId);
}

export function getRecentDecisions(projectId, limit = 20) {
  return getDb()
    .prepare(`
      SELECT *
      FROM decisions
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(projectId, limit);
}

export function saveDecision(projectId, { title, content, category = "other" }) {
  const id = uuidv4();

  getDb()
    .prepare(`
      INSERT INTO decisions (id, project_id, title, content, category)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(id, projectId, title, content, category);

  refreshProjectCompaction(projectId);
  return getDb().prepare("SELECT * FROM decisions WHERE id = ?").get(id);
}

export function saveDecisions(projectId, decisions) {
  const db = getDb();
  const tx = db.transaction((items) =>
    items.map((decision) => saveDecision(projectId, decision))
  );

  return tx(decisions);
}

export function deleteDecision(id) {
  const decision = getDb().prepare("SELECT project_id FROM decisions WHERE id = ?").get(id);
  getDb().prepare("DELETE FROM decisions WHERE id = ?").run(id);

  if (decision?.project_id) {
    refreshProjectCompaction(decision.project_id);
  }
}

export function searchContext(projectId, query) {
  return getDb()
    .prepare(`
      SELECT d.*
      FROM decisions d
      JOIN decisions_fts f ON d.rowid = f.rowid
      WHERE d.project_id = ?
        AND decisions_fts MATCH ?
      ORDER BY rank
      LIMIT 10
    `)
    .all(projectId, query);
}

export function getAllAgents() {
  return getDb()
    .prepare(`
      SELECT *
      FROM agents
      ORDER BY CASE role WHEN 'orchestrator' THEN 0 ELSE 1 END, created_at ASC
    `)
    .all();
}

export function getAgentById(id) {
  return getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id);
}

export function createAgent({ name, platform, role = "worker", specialty = "" }) {
  const validPlatforms = ["chatgpt", "gemini", "claude", "ollama", "local", "other"];
  if (!validPlatforms.includes(platform)) {
    throw new Error(`Invalid platform "${platform}". Must be one of: ${validPlatforms.join(", ")}`);
  }

  const id = uuidv4();
  const partition = `legacy-agent-${id}`;
  const sessionDir = `agent-${id}`;
  const normalizedRole = normalizeAgentRole(role);
  const normalizedSpecialty = String(specialty ?? "").trim();
  getDb()
    .prepare(`
        INSERT INTO agents (id, name, platform, role, specialty, partition, session_dir)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
    .run(id, name, platform, normalizedRole, normalizedSpecialty, partition, sessionDir);

  return getAgentById(id);
}

export function updateAgentStatus(id, status) {
  getDb().prepare("UPDATE agents SET status = ? WHERE id = ?").run(status, id);
  return getAgentById(id);
}

export function updateAgentRole(id, role) {
  const normalizedRole = normalizeAgentRole(role);
  getDb().prepare("UPDATE agents SET role = ? WHERE id = ?").run(normalizedRole, id);
  return getAgentById(id);
}

export function updateAgentSpecialty(id, specialty) {
  const normalizedSpecialty = String(specialty ?? "").trim();
  getDb().prepare("UPDATE agents SET specialty = ? WHERE id = ?").run(normalizedSpecialty, id);
  return getAgentById(id);
}

export function updateAgentName(id, name) {
  const normalizedName = String(name ?? "").trim();
  if (!normalizedName) return getAgentById(id);
  getDb().prepare("UPDATE agents SET name = ? WHERE id = ?").run(normalizedName, id);
  return getAgentById(id);
}

export function deleteAgent(id) {
  getDb().prepare("DELETE FROM agents WHERE id = ?").run(id);
}

export function createConversationTurn({
  projectId,
  taskId = null,
  agentId = null,
  channel = "worker",
  speaker = "user",
  content,
  metadata = {}
}) {
  const id = uuidv4();

  getDb()
    .prepare(`
      INSERT INTO conversation_turns (
        id,
        project_id,
        task_id,
        agent_id,
        channel,
        speaker,
        content,
        metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      projectId,
      taskId,
      agentId,
      channel,
      speaker,
      String(content ?? ""),
      metadata == null ? "" : JSON.stringify(metadata)
    );

  return getDb().prepare("SELECT * FROM conversation_turns WHERE id = ?").get(id);
}

export function getProjectConversationTurns(projectId, options = {}) {
  const channel = options.channel?.trim();
  const limit = options.limit ?? 50;
  const query = `
    SELECT t.*, a.name AS agent_name, a.platform, a.role AS agent_role
    FROM conversation_turns t
    LEFT JOIN agents a ON a.id = t.agent_id
    WHERE t.project_id = ?
      ${channel ? "AND t.channel = ?" : ""}
    ORDER BY t.created_at DESC
    LIMIT ?
  `;
  const statement = getDb().prepare(query);
  return channel ? statement.all(projectId, channel, limit) : statement.all(projectId, limit);
}

export function getProjectConversationSessions(projectId, options = {}) {
  const channel = options.channel?.trim();
  const limit = options.limit ?? 25;
  const roleFilter =
    channel === "orchestrator"
      ? "AND a.role = 'orchestrator'"
      : channel === "worker"
      ? "AND a.role != 'orchestrator'"
      : "";

  return getDb()
    .prepare(`
      SELECT
        t.id AS task_id,
        t.project_id,
        t.agent_id,
        t.user_task,
        t.prompt,
        t.response,
        t.status,
        t.created_at,
        t.completed_at,
        a.name AS agent_name,
        a.platform,
        a.role AS agent_role,
        a.specialty
      FROM tasks t
      JOIN agents a ON a.id = t.agent_id
      WHERE t.project_id = ?
      ${roleFilter}
      ORDER BY t.created_at DESC
      LIMIT ?
    `)
    .all(projectId, limit);
}

export function getProjectCompaction(projectId) {
  return (
    getDb()
      .prepare("SELECT * FROM project_compactions WHERE project_id = ?")
      .get(projectId) || {
      project_id: projectId,
      orchestrator_summary: "",
      worker_summary: "",
      shared_summary: "",
      recent_changes: "",
      updated_at: ""
    }
  );
}

export function refreshProjectCompaction(projectId) {
  return upsertProjectCompaction(projectId, buildCompactionText(projectId));
}

export function createTask({ projectId = null, agentId, prompt, userTask }) {
  const id = uuidv4();

  getDb()
    .prepare(`
      INSERT INTO tasks (id, project_id, agent_id, prompt, user_task)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(id, projectId, agentId, prompt, userTask);

  const task = getTaskById(id);

  if (projectId) {
    const agent = getAgentById(agentId);
    createConversationTurn({
      projectId,
      taskId: id,
      agentId,
      channel: getConversationChannelForRole(agent?.role),
      speaker: "user",
      content: userTask,
      metadata: {
        promptLength: String(prompt ?? "").length,
        agentName: agent?.name || "",
        agentRole: agent?.role || "worker"
      }
    });
    refreshProjectCompaction(projectId);
  }

  return task;
}

export function getTaskById(id) {
  return getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id);
}

export function updateTaskStatus(id, status) {
  getDb().prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
  return getTaskById(id);
}

export function completeTask(id, response) {
  getDb()
    .prepare(`
      UPDATE tasks
      SET
        response = ?,
        status = 'complete',
        completed_at = datetime('now')
      WHERE id = ?
    `)
    .run(response, id);

  const task = getTaskById(id);

  if (task?.project_id) {
    const agent = getAgentById(task.agent_id);
    createConversationTurn({
      projectId: task.project_id,
      taskId: id,
      agentId: task.agent_id,
      channel: getConversationChannelForRole(agent?.role),
      speaker: "assistant",
      content: response,
      metadata: {
        agentName: agent?.name || "",
        agentRole: agent?.role || "worker",
        status: "complete"
      }
    });
    refreshProjectCompaction(task.project_id);
  }

  return task;
}

export function completeTaskWithMeta(id, response, meta = {}) {
  const model = typeof meta.model === "string" ? meta.model.trim() : "";
  const provider = typeof meta.provider === "string" ? meta.provider.trim() : "";
  const promptTokens = Number.isFinite(meta.promptTokens) ? meta.promptTokens : null;
  const completionTokens = Number.isFinite(meta.completionTokens) ? meta.completionTokens : null;
  const totalTokens = Number.isFinite(meta.totalTokens) ? meta.totalTokens : null;
  const costUsd = Number.isFinite(meta.costUsd) ? meta.costUsd : null;

  getDb()
    .prepare(
      `
        UPDATE tasks
        SET
          response = ?,
          status = 'complete',
          completed_at = datetime('now'),
          model = ?,
          provider = ?,
          prompt_tokens = ?,
          completion_tokens = ?,
          total_tokens = ?,
          cost_usd = ?
        WHERE id = ?
      `
    )
    .run(
      response,
      model,
      provider,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      id
    );

  const task = getTaskById(id);

  if (task?.project_id) {
    const agent = getAgentById(task.agent_id);
    createConversationTurn({
      projectId: task.project_id,
      taskId: id,
      agentId: task.agent_id,
      channel: getConversationChannelForRole(agent?.role),
      speaker: "assistant",
      content: response,
      metadata: {
        agentName: agent?.name || "",
        agentRole: agent?.role || "worker",
        status: "complete",
        model,
        provider,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd
      }
    });
    refreshProjectCompaction(task.project_id);
  }

  return task;
}

export function getRecentTasks(projectId, limit = 50) {
  const baseQuery = `
    SELECT t.*, a.name AS agent_name, a.platform
    FROM tasks t
    JOIN agents a ON a.id = t.agent_id
    ${projectId ? "WHERE t.project_id = ?" : ""}
    ORDER BY t.created_at DESC
    LIMIT ?
  `;

  const statement = getDb().prepare(baseQuery);
  return projectId ? statement.all(projectId, limit) : statement.all(limit);
}

export function clearProjectTasks(projectId) {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM tasks WHERE project_id = ?");
  return stmt.run(projectId);
}

export function getProjectTodos(projectId, options = {}) {
  const status = options.status?.trim();
  const limit = options.limit ?? 100;

  if (status && !TODO_STATUSES.includes(status)) {
    throw new Error(`Invalid todo status "${status}".`);
  }

  const query = `
    SELECT *
    FROM project_todos
    WHERE project_id = ?
      ${status ? "AND status = ?" : ""}
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END,
      created_at DESC
    LIMIT ?
  `;

  const statement = getDb().prepare(query);
  return status ? statement.all(projectId, status, limit) : statement.all(projectId, limit);
}

export function getPendingTodos(projectId, limit = 50) {
  return getDb()
    .prepare(`
      SELECT *
      FROM project_todos
      WHERE project_id = ?
        AND status != 'complete'
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        created_at DESC
      LIMIT ?
    `)
    .all(projectId, limit);
}

export function getTodoById(id) {
  return getDb().prepare("SELECT * FROM project_todos WHERE id = ?").get(id);
}

export function createTodo({ projectId, title, description = "", priority = "medium" }) {
  const id = uuidv4();

  getDb()
    .prepare(`
      INSERT INTO project_todos (id, project_id, title, description, priority)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(id, projectId, title, description, normalizeTodoPriority(priority));

  refreshProjectCompaction(projectId);
  return getTodoById(id);
}

export function updateTodoStatus(id, status) {
  const normalizedStatus = normalizeTodoStatus(status);
  const completedAt = normalizedStatus === "complete" ? "datetime('now')" : "NULL";

  getDb()
    .prepare(`
      UPDATE project_todos
      SET status = ?,
          updated_at = datetime('now'),
          completed_at = ${completedAt}
      WHERE id = ?
    `)
    .run(normalizedStatus, id);

  const todo = getTodoById(id);

  if (todo?.project_id) {
    refreshProjectCompaction(todo.project_id);
  }

  return todo;
}

export function deleteTodo(id) {
  const todo = getDb().prepare("SELECT project_id FROM project_todos WHERE id = ?").get(id);
  getDb().prepare("DELETE FROM project_todos WHERE id = ?").run(id);

  if (todo?.project_id) {
    refreshProjectCompaction(todo.project_id);
  }
}

export function createOrchestratorSession({
  projectId,
  mode,
  orchestratorModel,
  maxCycles = 8,
  dryRun = false
}) {
  const id = uuidv4();

  getDb()
    .prepare(`
      INSERT INTO orchestrator_sessions (
        id,
        project_id,
        mode,
        orchestrator_model,
        max_cycles,
        dry_run
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(id, projectId, normalizeProjectMode(mode), orchestratorModel, maxCycles, dryRun ? 1 : 0);

  return getSessionById(id);
}

export function getSessionById(id) {
  return getDb().prepare("SELECT * FROM orchestrator_sessions WHERE id = ?").get(id);
}

export function listSessions(projectId = null, limit = 25) {
  const baseQuery = `
    SELECT s.*, p.name AS project_name
    FROM orchestrator_sessions s
    JOIN projects p ON p.id = s.project_id
    ${projectId ? "WHERE s.project_id = ?" : ""}
    ORDER BY s.created_at DESC
    LIMIT ?
  `;

  const statement = getDb().prepare(baseQuery);
  return projectId ? statement.all(projectId, limit) : statement.all(limit);
}

export function updateSession(id, patch = {}) {
  const current = getSessionById(id);

  if (!current) {
    return null;
  }

  const allowed = new Map([
    ["mode", (value) => normalizeProjectMode(value)],
    ["status", (value) => normalizeSessionStatus(value)],
    ["orchestrator_model", (value) => String(value).trim()],
    ["branch", (value) => String(value ?? "").trim()],
    ["summary", (value) => String(value ?? "")],
    ["last_error", (value) => String(value ?? "")],
    ["current_cycle", (value) => Number(value ?? 0)],
    ["max_cycles", (value) => Number(value ?? current.max_cycles)],
    ["decision", (value) => normalizeSessionDecision(value)],
    ["dry_run", (value) => (value ? 1 : 0)],
    ["started_at", (value) => value],
    ["completed_at", (value) => value]
  ]);

  const assignments = [];
  const values = [];

  for (const [key, formatter] of allowed.entries()) {
    if (patch[key] === undefined) {
      continue;
    }

    assignments.push(`${key} = ?`);
    values.push(formatter(patch[key]));
  }

  if (assignments.length === 0) {
    return current;
  }

  assignments.push("updated_at = datetime('now')");

  getDb()
    .prepare(`
      UPDATE orchestrator_sessions
      SET ${assignments.join(", ")}
      WHERE id = ?
    `)
    .run(...values, id);

  return getSessionById(id);
}

export function setSessionStatus(id, status, extra = {}) {
  return updateSession(id, {
    ...extra,
    status
  });
}

export function setSessionDecision(id, decision) {
  return updateSession(id, {
    decision
  });
}

export function appendSessionLog(sessionId, message, level = "info", data = null) {
  getDb()
    .prepare(`
      INSERT INTO session_logs (session_id, level, message, data)
      VALUES (?, ?, ?, ?)
    `)
    .run(sessionId, level, message, data == null ? "" : JSON.stringify(data));
}

export function getSessionLogs(sessionId, limit = 200) {
  return getDb()
    .prepare(`
      SELECT *
      FROM session_logs
      WHERE session_id = ?
      ORDER BY id ASC
      LIMIT ?
    `)
    .all(sessionId, limit);
}

export function getAiSettings() {
  const row = getDb().prepare("SELECT * FROM ai_settings WHERE id = 'default'").get() || {};
  return formatModelSettings(row);
}

export function updateAiSettings(modelPatch) {
  const patch = toDbModelPatch(modelPatch);

  if (Object.keys(patch).length === 0) {
    return getAiSettings();
  }

  const db = getDb();
  const current = getDb().prepare("SELECT * FROM ai_settings WHERE id = 'default'").get() || {};
  const next = {
    ...current,
    ...patch
  };

  db.prepare(`
      UPDATE ai_settings
      SET orchestrator_model = ?,
          builder_model = ?,
          reviewer_model = ?,
          tester_model = ?,
          updated_at = datetime('now')
      WHERE id = 'default'
    `).run(
    next.orchestrator_model,
    next.builder_model,
    next.reviewer_model,
    next.tester_model
  );

  return getAiSettings();
}

export function getAppSettings() {
  const row =
    getDb().prepare("SELECT * FROM app_settings WHERE id = 'default'").get() || {};

  return {
    approval_mode: normalizeApprovalMode(row.approval_mode)
  };
}

export function updateAppSettings(patch = {}) {
  const approvalMode = normalizeApprovalMode(patch.approval_mode);

  getDb()
    .prepare(`
      UPDATE app_settings
      SET approval_mode = ?,
          updated_at = datetime('now')
      WHERE id = 'default'
    `)
    .run(approvalMode);

  return getAppSettings();
}
