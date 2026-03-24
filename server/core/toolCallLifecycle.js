import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/schema.js";
import {
  TOOL_CALL_STATES,
  isReadOnlyToolAction
} from "./constants.js";
import { attachTaskArtifact } from "./taskLifecycle.js";
import { describeTool } from "./toolRegistryService.js";
import { redactProjectSecrets } from "./secretsVault.js";

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function resolveTaskContext(db, taskId) {
  const normalized = String(taskId || "").trim();
  if (!normalized) {
    return null;
  }

  return (
    db
      .prepare(
        `
          SELECT id, project_id, agent_id
          FROM tasks
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(normalized) || null
  );
}

function resolveProjectId(db, projectId) {
  const normalized = String(projectId || "").trim();
  if (!normalized) {
    return null;
  }

  const row = db
    .prepare(
      `
        SELECT id
        FROM projects
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(normalized);

  return row ? normalized : null;
}

function resolveAgentId(db, agentId) {
  const normalized = String(agentId || "").trim();
  if (!normalized) {
    return null;
  }

  const row = db
    .prepare(
      `
        SELECT id
        FROM agents
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(normalized);

  return row ? normalized : null;
}

export function normalizeToolRequestEnvelope(payload = {}, defaults = {}) {
  const raw = payload && typeof payload === "object" ? payload : {};
  const isEnvelope = String(raw.type || "").trim() === "tool_request";

  const action = String(raw.action || "").trim();
  const args = raw.args && typeof raw.args === "object" && !Array.isArray(raw.args)
    ? raw.args
    : {};

  const mergedArgs = {
    ...args,
    ...(raw.path !== undefined ? { path: raw.path } : {}),
    ...(raw.dir !== undefined ? { dir: raw.dir } : {}),
    ...(raw.pattern !== undefined ? { pattern: raw.pattern } : {}),
    ...(raw.paths !== undefined ? { paths: raw.paths } : {}),
    ...(raw.startLine !== undefined ? { startLine: raw.startLine } : {}),
    ...(raw.endLine !== undefined ? { endLine: raw.endLine } : {}),
    ...(raw.oldString !== undefined ? { oldString: raw.oldString } : {}),
    ...(raw.newString !== undefined ? { newString: raw.newString } : {}),
    ...(raw.content !== undefined ? { content: raw.content } : {}),
    ...(raw.patch !== undefined ? { patch: raw.patch } : {}),
    ...(raw.cmd !== undefined ? { cmd: raw.cmd } : {}),
    ...(raw.task !== undefined ? { task: raw.task } : {}),
    ...(raw.assignments !== undefined ? { assignments: raw.assignments } : {}),
    ...(raw.agent !== undefined ? { agent: raw.agent } : {}),
    ...(raw.agentId !== undefined ? { agentId: raw.agentId } : {})
  };

  const normalized = {
    type: isEnvelope ? "tool_request" : "tool_request",
    request_id: String(raw.request_id || defaults.request_id || uuidv4()).trim(),
    task_id: String(raw.task_id || defaults.task_id || "").trim() || null,
    project_id: String(raw.project_id || defaults.project_id || mergedArgs.projectId || "").trim() || null,
    agent_id: String(raw.agent_id || defaults.agent_id || "").trim() || null,
    correlation_id: String(raw.correlation_id || defaults.correlation_id || uuidv4()).trim(),
    action,
    args: mergedArgs,
    reason: String(raw.reason || defaults.reason || "").trim()
  };

  if (!normalized.action) {
    throw new Error("Tool request is missing action.");
  }

  if (!normalized.request_id) {
    throw new Error("Tool request is missing request_id.");
  }

  return normalized;
}

function buildToolResultEnvelope({
  requestId,
  ok,
  sideEffect,
  receiptId = null,
  summary,
  artifacts = {},
  error = ""
}) {
  return {
    type: "tool_result",
    request_id: requestId,
    ok: Boolean(ok),
    side_effect: Boolean(sideEffect),
    receipt_id: receiptId,
    summary: String(summary || ""),
    error: String(error || ""),
    artifacts
  };
}

function structuredError(code, message, details = null) {
  return {
    ok: false,
    error: {
      code,
      message,
      details
    }
  };
}

function validateEnvelope(envelope) {
  if (envelope.type !== "tool_request") {
    return structuredError("MALFORMED_PAYLOAD", "type must be \"tool_request\".");
  }

  if (!envelope.request_id) {
    return structuredError("MALFORMED_PAYLOAD", "request_id is required.");
  }

  if (!envelope.action) {
    return structuredError("MALFORMED_PAYLOAD", "action is required.");
  }

  if (envelope.args && typeof envelope.args !== "object") {
    return structuredError("MALFORMED_PAYLOAD", "args must be an object.");
  }

  const encodedBinary = envelope.args?.content_base64 || envelope.args?.binary_base64 || null;
  if (encodedBinary != null) {
    const encoded = String(encodedBinary);
    const maxEncodedChars = 2 * 1024 * 1024;
    if (encoded.length > maxEncodedChars) {
      return structuredError(
        "PAYLOAD_TOO_LARGE",
        `Binary payload exceeds limit (${maxEncodedChars} encoded chars).`
      );
    }
  }

  const knownTool = describeTool(envelope.action, { version: "core" }) || describeTool(envelope.action);
  const localOnly = new Set(["delegate_task", "delegate_tasks", "rebuild_app", "reload_app", "restart_app"]);

  if (!knownTool && !localOnly.has(envelope.action)) {
    return structuredError("UNKNOWN_ACTION", `Unknown action \"${envelope.action}\".`);
  }

  return {
    ok: true
  };
}

function sanitizeArtifacts(projectId, artifacts = {}) {
  const clone = JSON.parse(JSON.stringify(artifacts || {}));
  const keys = Object.keys(clone);

  for (const key of keys) {
    const value = clone[key];
    if (typeof value === "string") {
      clone[key] = redactProjectSecrets(projectId, value);
    }
  }

  return clone;
}

export function getToolCallByRequestId(requestId) {
  const row = getDb()
    .prepare(
      `
        SELECT *
        FROM tool_calls
        WHERE request_id = ?
      `
    )
    .get(requestId);

  if (!row) {
    return null;
  }

  return {
    ...row,
    args: safeJsonParse(row.args_json, {}),
    result: safeJsonParse(row.result_json, null)
  };
}

export function prepareToolCall({ envelope, approvalRequired = false, approved = true }) {
  const normalized = normalizeToolRequestEnvelope(envelope);
  const validation = validateEnvelope(normalized);
  if (!validation.ok) {
    return {
      validation,
      malformed: true,
      cached: false,
      shouldExecute: false
    };
  }

  const db = getDb();
  const taskContext = resolveTaskContext(db, normalized.task_id);
  const safeTaskId = taskContext?.id || null;
  const safeProjectId =
    resolveProjectId(db, normalized.project_id || normalized.args?.projectId || taskContext?.project_id) ||
    null;
  const safeAgentId =
    resolveAgentId(
      db,
      normalized.agent_id ||
        normalized.args?.ownerAgentId ||
        normalized.args?.agentId ||
        taskContext?.agent_id
    ) || null;
  const existing = getToolCallByRequestId(normalized.request_id);

  if (existing) {
    const terminalStatuses = new Set([
      TOOL_CALL_STATES.REJECTED,
      TOOL_CALL_STATES.RECEIPTED,
      TOOL_CALL_STATES.ATTACHED_TO_TASK,
      TOOL_CALL_STATES.FAILED
    ]);

    if (terminalStatuses.has(existing.status) && existing.result) {
      return {
        validation,
        malformed: false,
        cached: true,
        shouldExecute: false,
        toolCall: existing,
        resultEnvelope: existing.result
      };
    }

    if (existing.status === TOOL_CALL_STATES.APPROVED || existing.status === TOOL_CALL_STATES.REQUESTED) {
      db.prepare(
        `
          UPDATE tool_calls
          SET status = ?,
              approval_required = ?,
              approved = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `
      ).run(
        approved ? TOOL_CALL_STATES.APPROVED : TOOL_CALL_STATES.REJECTED,
        approvalRequired ? 1 : 0,
        approved ? 1 : 0,
        existing.id
      );
    }

    if (!approved) {
      const rejectedEnvelope = buildToolResultEnvelope({
        requestId: normalized.request_id,
        ok: false,
        sideEffect: false,
        summary: `Action ${normalized.action} rejected by policy/approval`,
        error: "Action rejected",
        artifacts: {}
      });

      db.prepare(
        `
          UPDATE tool_calls
          SET result_json = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `
      ).run(toJson(rejectedEnvelope), existing.id);
    }

    const refreshed = getToolCallByRequestId(normalized.request_id);
    return {
      validation,
      malformed: false,
      cached: false,
      shouldExecute: approved,
      toolCall: refreshed,
      resultEnvelope: approved
        ? null
        : buildToolResultEnvelope({
            requestId: normalized.request_id,
            ok: false,
            sideEffect: false,
            summary: `Action ${normalized.action} rejected by policy/approval`,
            error: "Action rejected",
            artifacts: {}
          })
    };
  }

  const id = uuidv4();
  const status = approved ? TOOL_CALL_STATES.APPROVED : TOOL_CALL_STATES.REJECTED;
  db.prepare(
    `
      INSERT INTO tool_calls (
        id,
        request_id,
      task_id,
      project_id,
      agent_id,
        correlation_id,
        action,
        args_json,
        reason,
        status,
        side_effect,
        approval_required,
        approved,
        started_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `
  ).run(
    id,
    normalized.request_id,
    safeTaskId,
    safeProjectId,
    safeAgentId,
    normalized.correlation_id,
    normalized.action,
    toJson(normalized.args),
    normalized.reason,
    status,
    isReadOnlyToolAction(normalized.action) ? 0 : 1,
    approvalRequired ? 1 : 0,
    approved ? 1 : 0,
    nowIso()
  );

  const created = getToolCallByRequestId(normalized.request_id);
  if (!approved) {
    const resultEnvelope = buildToolResultEnvelope({
      requestId: normalized.request_id,
      ok: false,
      sideEffect: false,
      summary: `Action ${normalized.action} rejected by policy/approval`,
      error: "Action rejected",
      artifacts: {}
    });

    db.prepare(
      `
        UPDATE tool_calls
        SET result_json = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `
    ).run(toJson(resultEnvelope), created.id);

    return {
      validation,
      malformed: false,
      cached: false,
      shouldExecute: false,
      toolCall: getToolCallByRequestId(normalized.request_id),
      resultEnvelope
    };
  }

  return {
    validation,
    malformed: false,
    cached: false,
    shouldExecute: true,
    toolCall: created,
    resultEnvelope: null
  };
}

export function finalizeToolCall({
  requestId,
  toolCallId = null,
  result,
  sideEffect = null,
  summary = "",
  artifacts = {},
  error = ""
}) {
  const db = getDb();
  const toolCall = requestId
    ? getToolCallByRequestId(requestId)
    : db.prepare("SELECT * FROM tool_calls WHERE id = ?").get(toolCallId);

  if (!toolCall) {
    throw new Error("Tool call not found for finalization.");
  }

  const effectiveSideEffect =
    sideEffect === null || sideEffect === undefined
      ? !isReadOnlyToolAction(toolCall.action)
      : Boolean(sideEffect);
  const ok = Boolean(result?.ok);
  const normalizedArtifacts = sanitizeArtifacts(toolCall.project_id, artifacts);
  const receiptId = uuidv4();
  const endedAt = nowIso();
  const startedAt = toolCall.started_at || endedAt;

  const resultEnvelope = buildToolResultEnvelope({
    requestId: toolCall.request_id,
    ok,
    sideEffect: effectiveSideEffect,
    receiptId,
    summary:
      summary ||
      (ok
        ? `Executed ${toolCall.action}`
        : `Failed ${toolCall.action}: ${String(error || result?.error || "unknown error")}`),
    error: error || result?.error || "",
    artifacts: normalizedArtifacts
  });

  const nextStatus = ok ? TOOL_CALL_STATES.EXECUTED : TOOL_CALL_STATES.FAILED;
  db.prepare(
    `
      UPDATE tool_calls
      SET status = ?,
          side_effect = ?,
          error_message = ?,
          result_json = ?,
          ended_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(
    nextStatus,
    effectiveSideEffect ? 1 : 0,
    String(error || result?.error || ""),
    toJson(resultEnvelope),
    endedAt,
    toolCall.id
  );

  db.prepare(
    `
      INSERT OR REPLACE INTO tool_receipts (
        id,
        tool_call_id,
        task_id,
        project_id,
        ok,
        side_effect,
        started_at,
        ended_at,
        artifacts_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `
  ).run(
    receiptId,
    toolCall.id,
    toolCall.task_id,
    toolCall.project_id,
    ok ? 1 : 0,
    effectiveSideEffect ? 1 : 0,
    startedAt,
    endedAt,
    toJson(normalizedArtifacts)
  );

  db.prepare(
    `
      UPDATE tool_calls
      SET status = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(TOOL_CALL_STATES.RECEIPTED, toolCall.id);

  if (toolCall.task_id) {
    attachTaskArtifact({
      taskId: toolCall.task_id,
      projectId: toolCall.project_id,
      artifactType: "tool_result",
      title: `${toolCall.action} result`,
      content: {
        tool_call_id: toolCall.id,
        action: toolCall.action,
        ok,
        result,
        error: error || result?.error || ""
      },
      receiptId,
      correlationId: toolCall.correlation_id
    });

    db.prepare(
      `
        UPDATE tool_calls
        SET status = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `
    ).run(TOOL_CALL_STATES.ATTACHED_TO_TASK, toolCall.id);
  }

  return {
    toolCall: getToolCallByRequestId(toolCall.request_id),
    receipt: db.prepare("SELECT * FROM tool_receipts WHERE id = ?").get(receiptId),
    resultEnvelope
  };
}

export function getToolExecutionByRequestId(requestId) {
  const call = getToolCallByRequestId(requestId);
  if (!call) {
    return null;
  }

  const receipt = getDb()
    .prepare(
      `
        SELECT *
        FROM tool_receipts
        WHERE tool_call_id = ?
      `
    )
    .get(call.id);

  return {
    call,
    receipt,
    resultEnvelope: call.result || null
  };
}

export function listToolCalls(filters = {}) {
  const where = [];
  const params = [];

  if (filters.taskId) {
    where.push("task_id = ?");
    params.push(String(filters.taskId).trim());
  }

  if (filters.projectId) {
    where.push("project_id = ?");
    params.push(String(filters.projectId).trim());
  }

  if (filters.status) {
    where.push("status = ?");
    params.push(String(filters.status).trim());
  }

  const rows = getDb()
    .prepare(
      `
        SELECT *
        FROM tool_calls
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY created_at DESC
        LIMIT ?
      `
    )
    .all(...params, Math.max(1, Math.min(1000, Number(filters.limit) || 200)));

  return rows.map((row) => ({
    ...row,
    args: safeJsonParse(row.args_json, {}),
    result: safeJsonParse(row.result_json, null)
  }));
}
