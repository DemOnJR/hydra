import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/schema.js";
import { REVIEW_ISSUE_TYPES, TASK_STATES, TASK_TRANSITIONS } from "./constants.js";

function nowIso() {
  return new Date().toISOString();
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function mapLegacyStatusToState(status) {
  switch (String(status || "").trim()) {
    case "working":
    case "sent":
      return TASK_STATES.IN_PROGRESS;
    case "complete":
      return TASK_STATES.COMPLETE;
    case "error":
      return TASK_STATES.BLOCKED;
    default:
      return TASK_STATES.TODO;
  }
}

function mapStateToLegacyStatus(state, previousStatus = "pending") {
  switch (state) {
    case TASK_STATES.TODO:
      return "pending";
    case TASK_STATES.IN_PROGRESS:
      return "working";
    case TASK_STATES.IN_REVIEW:
      return "working";
    case TASK_STATES.COMPLETE:
      return "complete";
    case TASK_STATES.BLOCKED:
      return previousStatus === "complete" ? "complete" : "error";
    default:
      return previousStatus || "pending";
  }
}

function normalizeTaskState(state) {
  const normalized = String(state || "").trim();
  if (!Object.values(TASK_STATES).includes(normalized)) {
    throw new Error(`Invalid task state "${state}".`);
  }

  return normalized;
}

function taskHasRequiredEvidence(db, taskId) {
  const count = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM tool_receipts
        WHERE task_id = ?
      `
    )
    .get(taskId)?.count;

  return Number(count || 0) > 0;
}

function taskHasPassingVerification(db, taskId) {
  const row = db
    .prepare(
      `
        SELECT verification_status
        FROM tasks
        WHERE id = ?
      `
    )
    .get(taskId);

  return row?.verification_status === "passed";
}

export function getTaskLifecycle(taskId) {
  const db = getDb();
  const task = db
    .prepare(
      `
        SELECT *
        FROM tasks
        WHERE id = ?
      `
    )
    .get(taskId);

  if (!task) {
    return null;
  }

  const currentState =
    task.workflow_state && Object.values(TASK_STATES).includes(task.workflow_state)
      ? task.workflow_state
      : mapLegacyStatusToState(task.status);

  const transitions = db
    .prepare(
      `
        SELECT *
        FROM task_transitions
        WHERE task_id = ?
        ORDER BY id ASC
      `
    )
    .all(taskId);

  const assignment = db
    .prepare(
      `
        SELECT *
        FROM task_assignments
        WHERE task_id = ?
          AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
      `
    )
    .get(taskId);

  return {
    task,
    currentState,
    transitions,
    assignment
  };
}

export function attachTaskArtifact({
  taskId,
  projectId = null,
  artifactType,
  title = "",
  filePath = "",
  content = null,
  receiptId = null,
  correlationId = ""
}) {
  const db = getDb();
  const id = uuidv4();

  db.prepare(
    `
      INSERT INTO task_artifacts (
        id,
        task_id,
        project_id,
        artifact_type,
        title,
        file_path,
        content_json,
        receipt_id,
        correlation_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    taskId,
    projectId,
    String(artifactType || "generic").trim() || "generic",
    String(title || ""),
    String(filePath || ""),
    content == null ? "" : JSON.stringify(content),
    receiptId,
    String(correlationId || "")
  );

  return db.prepare("SELECT * FROM task_artifacts WHERE id = ?").get(id);
}

export function listTaskArtifacts(taskId, limit = 200) {
  return getDb()
    .prepare(
      `
        SELECT *
        FROM task_artifacts
        WHERE task_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `
    )
    .all(taskId, Math.max(1, Math.min(1000, Number(limit) || 200)));
}

export function markTaskVerification(taskId, status, details = null) {
  const normalized = String(status || "").trim();
  if (!["pending", "passed", "failed", "skipped"].includes(normalized)) {
    throw new Error(`Invalid verification status "${status}".`);
  }

  const db = getDb();
  db.prepare(
    `
      UPDATE tasks
      SET verification_status = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(normalized, taskId);

  if (details != null) {
    attachTaskArtifact({
      taskId,
      projectId: db.prepare("SELECT project_id FROM tasks WHERE id = ?").get(taskId)?.project_id || null,
      artifactType: "verification",
      title: `Verification ${normalized}`,
      content: details,
      correlationId: "verification"
    });
  }

  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
}

export function transitionTaskState({
  taskId,
  toState,
  actorType = "system",
  actorId = "",
  reason = "",
  correlationId = "",
  bypassGuards = false
}) {
  const db = getDb();
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);

  if (!task) {
    throw new Error("Task not found.");
  }

  const targetState = normalizeTaskState(toState);
  const fromState =
    task.workflow_state && Object.values(TASK_STATES).includes(task.workflow_state)
      ? task.workflow_state
      : mapLegacyStatusToState(task.status);

  if (fromState === targetState) {
    return {
      ...task,
      workflow_state: fromState
    };
  }

  if (!bypassGuards) {
    const allowedTargets = TASK_TRANSITIONS[fromState] || new Set();
    if (!allowedTargets.has(targetState)) {
      throw new Error(`Invalid transition ${fromState} -> ${targetState}.`);
    }

    if (targetState === TASK_STATES.IN_REVIEW) {
      const requiredEvidence = parseBoolean(task.required_evidence, true);
      if (requiredEvidence && !taskHasRequiredEvidence(db, taskId)) {
        throw new Error("Cannot move task to in_review without evidence receipts.");
      }
    }

    if (targetState === TASK_STATES.COMPLETE) {
      const requiredEvidence = parseBoolean(task.required_evidence, true);
      if (requiredEvidence && !taskHasRequiredEvidence(db, taskId)) {
        throw new Error("Cannot complete task without evidence receipts.");
      }

      const requiredVerification = parseBoolean(task.required_verification, false);
      if (requiredVerification && !taskHasPassingVerification(db, taskId)) {
        throw new Error("Cannot complete task until verification checks pass.");
      }
    }
  }

  const nextLegacyStatus = mapStateToLegacyStatus(targetState, task.status);
  const completeAt = targetState === TASK_STATES.COMPLETE ? nowIso() : null;

  db.prepare(
    `
      UPDATE tasks
      SET workflow_state = ?,
          status = ?,
          state_reason = ?,
          completed_at = CASE WHEN ? IS NOT NULL THEN ? ELSE completed_at END,
          updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(targetState, nextLegacyStatus, String(reason || ""), completeAt, completeAt, taskId);

  db.prepare(
    `
      INSERT INTO task_transitions (
        task_id,
        from_state,
        to_state,
        actor_type,
        actor_id,
        reason,
        correlation_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    taskId,
    fromState,
    targetState,
    String(actorType || "system"),
    String(actorId || ""),
    String(reason || ""),
    String(correlationId || "")
  );

  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
}

export function addTaskDependency(taskId, dependsOnTaskId) {
  const db = getDb();
  if (taskId === dependsOnTaskId) {
    throw new Error("A task cannot depend on itself.");
  }

  db.prepare(
    `
      INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id)
      VALUES (?, ?)
    `
  ).run(taskId, dependsOnTaskId);

  return listTaskDependencies(taskId);
}

export function listTaskDependencies(taskId) {
  return getDb()
    .prepare(
      `
        SELECT d.*, t.workflow_state AS depends_on_state, t.status AS depends_on_status
        FROM task_dependencies d
        LEFT JOIN tasks t ON t.id = d.depends_on_task_id
        WHERE d.task_id = ?
        ORDER BY d.created_at ASC
      `
    )
    .all(taskId);
}

export function isTaskRunnable(taskId) {
  const db = getDb();
  const pendingDeps = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM task_dependencies d
        JOIN tasks t ON t.id = d.depends_on_task_id
        WHERE d.task_id = ?
          AND COALESCE(NULLIF(t.workflow_state, ''), 'todo') != 'complete'
      `
    )
    .get(taskId)?.count;

  return Number(pendingDeps || 0) === 0;
}

export function listRunnableTasks(projectId = null, limit = 100) {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const tasks = db
    .prepare(
      `
        SELECT t.*
        FROM tasks t
        WHERE COALESCE(NULLIF(t.workflow_state, ''), 'todo') = 'todo'
          ${projectId ? "AND t.project_id = ?" : ""}
        ORDER BY t.priority ASC, t.created_at ASC
        LIMIT ?
      `
    )
    .all(...(projectId ? [projectId, safeLimit] : [safeLimit]));

  return tasks.filter((task) => isTaskRunnable(task.id));
}

export function getActiveTaskLease(taskId) {
  return getDb()
    .prepare(
      `
        SELECT *
        FROM task_assignments
        WHERE task_id = ?
          AND status = 'active'
          AND datetime(lease_expires_at) > datetime('now')
        ORDER BY created_at DESC
        LIMIT 1
      `
    )
    .get(taskId);
}

export function grantTaskLease({
  taskId,
  projectId = null,
  agentId,
  leaseMs = 45000,
  correlationId = ""
}) {
  const db = getDb();
  const current = getActiveTaskLease(taskId);
  if (current) {
    throw new Error(`Task ${taskId} already has an active lease.`);
  }

  const id = uuidv4();
  const leaseId = uuidv4();
  const expiresAt = new Date(Date.now() + Math.max(5000, Number(leaseMs) || 45000)).toISOString();

  db.prepare(
    `
      INSERT INTO task_assignments (
        id,
        task_id,
        project_id,
        agent_id,
        lease_id,
        lease_expires_at,
        heartbeat_at,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `
  ).run(id, taskId, projectId, agentId, leaseId, expiresAt, nowIso());

  transitionTaskState({
    taskId,
    toState: TASK_STATES.IN_PROGRESS,
    actorType: "scheduler",
    actorId: agentId,
    reason: "Lease granted",
    correlationId,
    bypassGuards: true
  });

  return db.prepare("SELECT * FROM task_assignments WHERE id = ?").get(id);
}

export function renewTaskLease({ assignmentId, leaseId, leaseMs = 45000 }) {
  const db = getDb();
  const assignment = db
    .prepare(
      `
        SELECT *
        FROM task_assignments
        WHERE id = ?
      `
    )
    .get(assignmentId);

  if (!assignment) {
    throw new Error("Task assignment not found.");
  }

  if (assignment.status !== "active") {
    throw new Error("Task assignment is not active.");
  }

  if (leaseId && assignment.lease_id !== leaseId) {
    throw new Error("Lease id mismatch.");
  }

  const expiresAt = new Date(Date.now() + Math.max(5000, Number(leaseMs) || 45000)).toISOString();

  db.prepare(
    `
      UPDATE task_assignments
      SET lease_expires_at = ?,
          heartbeat_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(expiresAt, nowIso(), assignmentId);

  return db.prepare("SELECT * FROM task_assignments WHERE id = ?").get(assignmentId);
}

export function releaseTaskLease(assignmentId, status = "released") {
  const normalizedStatus = ["released", "expired", "revoked"].includes(status)
    ? status
    : "released";
  const db = getDb();
  const assignment = db.prepare("SELECT * FROM task_assignments WHERE id = ?").get(assignmentId);

  if (!assignment) {
    return null;
  }

  db.prepare(
    `
      UPDATE task_assignments
      SET status = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(normalizedStatus, assignmentId);

  return db.prepare("SELECT * FROM task_assignments WHERE id = ?").get(assignmentId);
}

export function revokeStaleTaskLeases() {
  const db = getDb();
  const stale = db
    .prepare(
      `
        SELECT *
        FROM task_assignments
        WHERE status = 'active'
          AND datetime(lease_expires_at) <= datetime('now')
      `
    )
    .all();

  for (const assignment of stale) {
    releaseTaskLease(assignment.id, "expired");
    transitionTaskState({
      taskId: assignment.task_id,
      toState: TASK_STATES.TODO,
      actorType: "scheduler",
      actorId: assignment.agent_id,
      reason: "Lease expired and was revoked",
      correlationId: assignment.lease_id,
      bypassGuards: true
    });
  }

  return stale.length;
}

export function createReviewIssue({
  taskId,
  projectId,
  issueType,
  title,
  details = "",
  artifactId = null
}) {
  const normalizedType = String(issueType || "").trim();
  if (!REVIEW_ISSUE_TYPES.has(normalizedType)) {
    throw new Error(`Invalid review issue type "${issueType}".`);
  }

  const id = uuidv4();
  const db = getDb();
  db.prepare(
    `
      INSERT INTO review_issues (
        id,
        task_id,
        project_id,
        issue_type,
        title,
        details,
        artifact_id,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
    `
  ).run(
    id,
    taskId,
    projectId,
    normalizedType,
    String(title || "").trim(),
    String(details || ""),
    artifactId
  );

  return db.prepare("SELECT * FROM review_issues WHERE id = ?").get(id);
}

export function listTaskTimeline(taskId) {
  const db = getDb();
  const transitions = db
    .prepare(
      `
        SELECT
          'transition' AS event_type,
          id,
          from_state,
          to_state,
          actor_type,
          actor_id,
          reason,
          correlation_id,
          created_at
        FROM task_transitions
        WHERE task_id = ?
      `
    )
    .all(taskId);

  const toolCalls = db
    .prepare(
      `
        SELECT
          'tool_call' AS event_type,
          id,
          action,
          status,
          correlation_id,
          created_at,
          updated_at
        FROM tool_calls
        WHERE task_id = ?
      `
    )
    .all(taskId);

  const receipts = db
    .prepare(
      `
        SELECT
          'receipt' AS event_type,
          r.id,
          c.action,
          r.ok,
          r.side_effect,
          r.created_at
        FROM tool_receipts r
        LEFT JOIN tool_calls c ON c.id = r.tool_call_id
        WHERE r.task_id = ?
      `
    )
    .all(taskId);

  return [...transitions, ...toolCalls, ...receipts].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}
