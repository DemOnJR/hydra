import { spawn } from "node:child_process";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "../db/schema.js";
import { validateCommand } from "../orchestrator/safetyGuards.js";
import { PROCESS_STATES } from "./constants.js";
import { redactProjectSecrets } from "./secretsVault.js";

const activeProcesses = new Map();
const MAX_RESTART_ATTEMPTS = 3;
const MAX_OUTPUT_CHUNK = 4000;

function nowIso() {
  return new Date().toISOString();
}

function sliceChunk(chunk) {
  const text = String(chunk ?? "");
  return text.length > MAX_OUTPUT_CHUNK ? text.slice(0, MAX_OUTPUT_CHUNK) : text;
}

function updateProcessRecord(processId, patch = {}) {
  const db = getDb();
  const current = db.prepare("SELECT * FROM processes WHERE id = ?").get(processId);
  if (!current) {
    return null;
  }

  const next = {
    ...current,
    ...patch
  };

  db.prepare(
    `
      UPDATE processes
      SET task_id = ?,
          project_id = ?,
          owner_agent_id = ?,
          command = ?,
          cwd = ?,
          pid = ?,
          state = ?,
          auto_restart = ?,
          restart_count = ?,
          exit_code = ?,
          started_at = ?,
          ended_at = ?,
          metadata_json = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `
  ).run(
    next.task_id,
    next.project_id,
    next.owner_agent_id,
    next.command,
    next.cwd,
    next.pid,
    next.state,
    Number(next.auto_restart) ? 1 : 0,
    Number(next.restart_count || 0),
    next.exit_code,
    next.started_at,
    next.ended_at,
    next.metadata_json || "{}",
    processId
  );

  return db.prepare("SELECT * FROM processes WHERE id = ?").get(processId);
}

function appendProcessOutput(processId, stream, chunk, projectId = null) {
  const db = getDb();
  const redactedChunk = redactProjectSecrets(projectId, sliceChunk(chunk));
  db.prepare(
    `
      INSERT INTO process_output (process_id, stream, chunk)
      VALUES (?, ?, ?)
    `
  ).run(processId, stream, redactedChunk);
}

function bindChildLifecycle(processId, child, options = {}) {
  const projectId = options.projectId || null;

  child.stdout?.on("data", (chunk) => {
    appendProcessOutput(processId, "stdout", chunk, projectId);
  });

  child.stderr?.on("data", (chunk) => {
    appendProcessOutput(processId, "stderr", chunk, projectId);
  });

  child.on("error", (error) => {
    appendProcessOutput(processId, "system", `Process error: ${error.message}`, projectId);
    updateProcessRecord(processId, {
      state: PROCESS_STATES.FAILED,
      ended_at: nowIso(),
      exit_code: 1
    });
  });

  child.on("close", (code) => {
    const metadata = activeProcesses.get(processId);
    if (!metadata) {
      updateProcessRecord(processId, {
        state: Number(code || 0) === 0 ? PROCESS_STATES.STOPPED : PROCESS_STATES.FAILED,
        ended_at: nowIso(),
        exit_code: Number.isInteger(code) ? code : 1
      });
      return;
    }

    const shouldRestart =
      metadata.autoRestart &&
      Number.isInteger(code) &&
      code !== 0 &&
      metadata.restartCount < MAX_RESTART_ATTEMPTS;

    if (shouldRestart) {
      metadata.restartCount += 1;
      activeProcesses.set(processId, metadata);
      appendProcessOutput(
        processId,
        "system",
        `Process exited with code ${code}. Restarting (${metadata.restartCount}/${MAX_RESTART_ATTEMPTS})...`,
        projectId
      );
      void restartProcess(processId);
      return;
    }

    activeProcesses.delete(processId);
    updateProcessRecord(processId, {
      state: Number(code || 0) === 0 ? PROCESS_STATES.STOPPED : PROCESS_STATES.FAILED,
      ended_at: nowIso(),
      exit_code: Number.isInteger(code) ? code : 1,
      restart_count: metadata.restartCount
    });
  });
}

function createProcessRecord({
  processId,
  taskId = null,
  projectId = null,
  ownerAgentId = null,
  command,
  cwd,
  autoRestart = false,
  metadata = {}
}) {
  const db = getDb();
  db.prepare(
    `
      INSERT INTO processes (
        id,
        task_id,
        project_id,
        owner_agent_id,
        command,
        cwd,
        state,
        auto_restart,
        restart_count,
        metadata_json,
        started_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, datetime('now'), datetime('now'))
    `
  ).run(
    processId,
    taskId,
    projectId,
    ownerAgentId,
    command,
    cwd,
    PROCESS_STATES.STARTING,
    autoRestart ? 1 : 0,
    JSON.stringify(metadata || {}),
    nowIso()
  );

  return db.prepare("SELECT * FROM processes WHERE id = ?").get(processId);
}

function launchTrackedProcess(record, env = {}) {
  const child = spawn(record.command, {
    cwd: record.cwd,
    shell: true,
    env: {
      ...process.env,
      ...env
    },
    windowsHide: true
  });

  activeProcesses.set(record.id, {
    child,
    autoRestart: Number(record.auto_restart) === 1,
    restartCount: Number(record.restart_count || 0),
    env,
    taskId: record.task_id,
    projectId: record.project_id,
    ownerAgentId: record.owner_agent_id
  });

  bindChildLifecycle(record.id, child, { projectId: record.project_id });

  return updateProcessRecord(record.id, {
    state: PROCESS_STATES.RUNNING,
    pid: child.pid,
    started_at: nowIso(),
    ended_at: null,
    exit_code: null
  });
}

export function reconcileTrackedProcesses() {
  const db = getDb();
  const runningRows = db
    .prepare(
      `
        SELECT *
        FROM processes
        WHERE state IN ('starting', 'running')
      `
    )
    .all();

  for (const row of runningRows) {
    updateProcessRecord(row.id, {
      state: PROCESS_STATES.ZOMBIE,
      ended_at: row.ended_at || nowIso()
    });
  }

  return runningRows.length;
}

export function listTrackedProcesses(filters = {}) {
  const where = [];
  const params = [];

  if (filters.projectId) {
    where.push("project_id = ?");
    params.push(String(filters.projectId).trim());
  }

  if (filters.taskId) {
    where.push("task_id = ?");
    params.push(String(filters.taskId).trim());
  }

  if (filters.state) {
    where.push("state = ?");
    params.push(String(filters.state).trim());
  }

  return getDb()
    .prepare(
      `
        SELECT *
        FROM processes
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY created_at DESC
      `
    )
    .all(...params);
}

export function readTrackedProcessOutput(processId, options = {}) {
  const limit = Math.max(1, Math.min(5000, Number(options.limit) || 500));
  const afterId = Number(options.afterId || 0);

  const rows = getDb()
    .prepare(
      `
        SELECT *
        FROM process_output
        WHERE process_id = ?
          AND id > ?
        ORDER BY id ASC
        LIMIT ?
      `
    )
    .all(processId, afterId, limit);

  return {
    processId,
    rows,
    lastId: rows.length ? rows[rows.length - 1].id : afterId
  };
}

export async function startProcess({
  taskId = null,
  projectId = null,
  ownerAgentId = null,
  command,
  cwd,
  env = {},
  autoRestart = false,
  metadata = {}
}) {
  const safeCommand = validateCommand(command);
  const normalizedCwd = path.resolve(String(cwd || ".").trim() || ".");
  const processId = uuidv4();

  const record = createProcessRecord({
    processId,
    taskId,
    projectId,
    ownerAgentId,
    command: safeCommand,
    cwd: normalizedCwd,
    autoRestart,
    metadata
  });

  const running = launchTrackedProcess(record, env);
  appendProcessOutput(processId, "system", `Started process ${safeCommand}`, projectId);

  return {
    processId,
    pid: running.pid,
    state: running.state,
    command: running.command,
    cwd: running.cwd,
    startedAt: running.started_at
  };
}

export async function stopProcess(processId) {
  const normalizedProcessId = String(processId || "").trim();
  if (!normalizedProcessId) {
    throw new Error("processId is required.");
  }

  const metadata = activeProcesses.get(normalizedProcessId);
  const row = getDb().prepare("SELECT * FROM processes WHERE id = ?").get(normalizedProcessId);
  if (!row) {
    throw new Error("Process not found.");
  }

  if (!metadata?.child) {
    const patched = updateProcessRecord(normalizedProcessId, {
      state: row.state === PROCESS_STATES.RUNNING ? PROCESS_STATES.ZOMBIE : row.state,
      ended_at: row.ended_at || nowIso()
    });

    return {
      processId: normalizedProcessId,
      state: patched?.state || PROCESS_STATES.ZOMBIE,
      pid: row.pid
    };
  }

  metadata.child.kill();
  activeProcesses.delete(normalizedProcessId);
  const patched = updateProcessRecord(normalizedProcessId, {
    state: PROCESS_STATES.STOPPED,
    ended_at: nowIso()
  });
  appendProcessOutput(normalizedProcessId, "system", "Process stopped by user request.", row.project_id);

  return {
    processId: normalizedProcessId,
    state: patched?.state || PROCESS_STATES.STOPPED,
    pid: row.pid
  };
}

export async function restartProcess(processId) {
  const normalizedProcessId = String(processId || "").trim();
  if (!normalizedProcessId) {
    throw new Error("processId is required.");
  }

  const row = getDb().prepare("SELECT * FROM processes WHERE id = ?").get(normalizedProcessId);
  if (!row) {
    throw new Error("Process not found.");
  }

  if (activeProcesses.has(normalizedProcessId)) {
    try {
      await stopProcess(normalizedProcessId);
    } catch {
      // Keep restart attempt even if stop fails.
    }
  }

  updateProcessRecord(normalizedProcessId, {
    state: PROCESS_STATES.STARTING,
    ended_at: null,
    exit_code: null,
    restart_count: Number(row.restart_count || 0) + 1
  });

  const refreshed = getDb().prepare("SELECT * FROM processes WHERE id = ?").get(normalizedProcessId);
  const running = launchTrackedProcess(refreshed);
  appendProcessOutput(normalizedProcessId, "system", "Process restarted.", row.project_id);

  return {
    processId: normalizedProcessId,
    pid: running.pid,
    state: running.state,
    restartCount: running.restart_count
  };
}

export async function shutdownProcessManager() {
  const entries = [...activeProcesses.entries()];
  for (const [processId, metadata] of entries) {
    try {
      metadata.child?.kill();
    } catch {
      // Best effort shutdown.
    }
    activeProcesses.delete(processId);
    updateProcessRecord(processId, {
      state: PROCESS_STATES.STOPPED,
      ended_at: nowIso()
    });
  }
}
