import { getDb } from "../db/schema.js";

function avg(values = []) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getCoreMetrics(projectId = null) {
  const db = getDb();
  const scopedProjectId = projectId ? String(projectId).trim() : null;

  const transitionLatencies = db
    .prepare(
      `
        SELECT
          CAST((julianday(t2.created_at) - julianday(t1.created_at)) * 86400000 AS INTEGER) AS latency_ms
        FROM task_transitions t1
        JOIN task_transitions t2 ON t2.task_id = t1.task_id
        JOIN tasks t ON t.id = t1.task_id
        WHERE (? IS NULL OR t.project_id = ?)
          AND t2.id = (
            SELECT MIN(id)
            FROM task_transitions x
            WHERE x.task_id = t1.task_id
              AND x.id > t1.id
          )
      `
    )
    .all(scopedProjectId, scopedProjectId)
    .map((row) => Number(row.latency_ms || 0))
    .filter((value) => value >= 0);

  const toolStats = db
    .prepare(
      `
        SELECT
          action,
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('receipted', 'attached_to_task') THEN 1 ELSE 0 END) AS success,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM tool_calls
        WHERE (? IS NULL OR project_id = ?)
        GROUP BY action
      `
    )
    .all(scopedProjectId, scopedProjectId);

  const processStats = db
    .prepare(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN state = 'running' THEN 1 ELSE 0 END) AS running,
          SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
          AVG(
            CASE
              WHEN started_at IS NOT NULL AND ended_at IS NOT NULL
                THEN (julianday(ended_at) - julianday(started_at)) * 86400
              ELSE NULL
            END
          ) AS avg_uptime_seconds
        FROM processes
        WHERE (? IS NULL OR project_id = ?)
      `
    )
    .get(scopedProjectId, scopedProjectId);

  const capabilityGaps = db
    .prepare(
      `
        SELECT category, SUM(frequency) AS frequency
        FROM capability_gaps
        WHERE (? IS NULL OR project_id = ?)
        GROUP BY category
        ORDER BY frequency DESC
      `
    )
    .all(scopedProjectId, scopedProjectId);

  const genesisStats = db
    .prepare(
      `
        SELECT
          SUM(CASE WHEN status = 'promoted' THEN 1 ELSE 0 END) AS promoted,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          COUNT(*) AS total
        FROM genesis_tasks
        WHERE (? IS NULL OR project_id = ?)
      `
    )
    .get(scopedProjectId, scopedProjectId);

  return {
    taskTransitionLatencyMs: {
      p50: percentile(transitionLatencies, 50),
      p95: percentile(transitionLatencies, 95),
      average: Math.round(avg(transitionLatencies))
    },
    toolSuccessByAction: toolStats.map((entry) => ({
      action: entry.action,
      total: Number(entry.total || 0),
      success: Number(entry.success || 0),
      failed: Number(entry.failed || 0),
      successRate:
        Number(entry.total || 0) > 0
          ? Number(entry.success || 0) / Number(entry.total || 0)
          : 0
    })),
    process: {
      total: Number(processStats?.total || 0),
      running: Number(processStats?.running || 0),
      failed: Number(processStats?.failed || 0),
      avgUptimeSeconds: Number(processStats?.avg_uptime_seconds || 0)
    },
    capabilityGaps,
    genesis: {
      total: Number(genesisStats?.total || 0),
      promoted: Number(genesisStats?.promoted || 0),
      rejected: Number(genesisStats?.rejected || 0)
    }
  };
}

function percentile(values, p) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function getTaskDebugArtifacts(taskId) {
  const db = getDb();
  const toolCalls = db
    .prepare(
      `
        SELECT *
        FROM tool_calls
        WHERE task_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(taskId);

  const receipts = db
    .prepare(
      `
        SELECT *
        FROM tool_receipts
        WHERE task_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(taskId);

  const verificationArtifacts = db
    .prepare(
      `
        SELECT *
        FROM task_artifacts
        WHERE task_id = ?
          AND artifact_type = 'verification'
        ORDER BY created_at DESC
      `
    )
    .all(taskId);

  const previewArtifacts = db
    .prepare(
      `
        SELECT *
        FROM task_artifacts
        WHERE task_id = ?
          AND artifact_type LIKE 'preview_%'
        ORDER BY created_at DESC
      `
    )
    .all(taskId);

  const decision = db
    .prepare(
      `
        SELECT *
        FROM task_transitions
        WHERE task_id = ?
          AND to_state IN ('complete', 'blocked')
        ORDER BY id DESC
        LIMIT 1
      `
    )
    .get(taskId);

  return {
    taskId,
    toolCalls,
    receipts,
    verificationArtifacts,
    previewArtifacts,
    finalDecision: decision
      ? {
          state: decision.to_state,
          reason: decision.reason,
          actorType: decision.actor_type,
          actorId: decision.actor_id,
          at: decision.created_at
        }
      : null
  };
}
