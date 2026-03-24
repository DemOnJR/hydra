import { getDb } from "../db/schema.js";
import {
  getActiveTaskLease,
  grantTaskLease,
  listRunnableTasks,
  renewTaskLease,
  releaseTaskLease,
  revokeStaleTaskLeases
} from "./taskLifecycle.js";

function countActiveLeasesForAgent(agentId) {
  return (
    getDb()
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM task_assignments
          WHERE agent_id = ?
            AND status = 'active'
            AND datetime(lease_expires_at) > datetime('now')
        `
      )
      .get(agentId)?.count || 0
  );
}

export function dispatchNextRunnableTask({
  agentId,
  projectId = null,
  leaseMs = 45000,
  maxConcurrency = 1,
  correlationId = ""
}) {
  if (!String(agentId || "").trim()) {
    throw new Error("agentId is required.");
  }

  revokeStaleTaskLeases();

  const currentActive = Number(countActiveLeasesForAgent(agentId));
  if (currentActive >= Math.max(1, Number(maxConcurrency) || 1)) {
    return {
      dispatched: false,
      reason: "capacity_reached",
      activeLeases: currentActive,
      maxConcurrency: Math.max(1, Number(maxConcurrency) || 1)
    };
  }

  const runnable = listRunnableTasks(projectId, 100);
  const task = runnable.find((candidate) => !getActiveTaskLease(candidate.id));

  if (!task) {
    return {
      dispatched: false,
      reason: "no_runnable_tasks",
      activeLeases: currentActive
    };
  }

  const assignment = grantTaskLease({
    taskId: task.id,
    projectId: task.project_id,
    agentId,
    leaseMs,
    correlationId
  });

  return {
    dispatched: true,
    task,
    assignment
  };
}

export function heartbeatTaskLease({ assignmentId, leaseId, leaseMs = 45000 }) {
  const assignment = renewTaskLease({ assignmentId, leaseId, leaseMs });
  return {
    ok: true,
    assignment
  };
}

export function revokeLease(assignmentId, status = "released") {
  const assignment = releaseTaskLease(assignmentId, status);
  return {
    ok: Boolean(assignment),
    assignment
  };
}

export function reconcileSchedulerState() {
  const revokedCount = revokeStaleTaskLeases();
  return {
    revokedCount
  };
}

export function getSchedulerSnapshot(projectId = null) {
  const db = getDb();
  const assignments = db
    .prepare(
      `
        SELECT *
        FROM task_assignments
        ${projectId ? "WHERE project_id = ?" : ""}
        ORDER BY created_at DESC
        LIMIT 300
      `
    )
    .all(...(projectId ? [projectId] : []));

  const activeAssignments = assignments.filter((entry) => entry.status === "active");
  const runnableTasks = listRunnableTasks(projectId, 200);

  return {
    activeAssignments,
    assignments,
    runnableTasks,
    capacityByAgent: activeAssignments.reduce((acc, item) => {
      const key = item.agent_id;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  };
}
