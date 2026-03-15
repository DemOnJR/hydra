import { HydraSprite } from "./HydraSprite.jsx";
import { extractInteractiveReplyState } from "../interactiveReply.js";

function getAgentTaskSnapshot(agent, tasks = []) {
  const agentTasks = tasks
    .filter((task) => task.agent_id === agent.id)
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
  const activeTask =
    agentTasks.find((task) => ["pending", "sent", "working"].includes(task.status)) || null;
  const latestTask = activeTask || agentTasks[0] || null;

  return { activeTask, latestTask };
}

function isDelegatedTask(task) {
  return /delegated subtask from orchestrator/i.test(task?.user_task || "");
}

function isRecent(timestamp, withinMs = 30000) {
  if (!timestamp) return false;
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) && Date.now() - parsed <= withinMs;
}

function deriveAgentActivity(agent, runtimeState, tasks = []) {
  const snapshot = getAgentTaskSnapshot(agent, tasks);
  const hasDelegatedWorkers =
    agent.role === "orchestrator" &&
    tasks.some(
      (task) =>
        task.agent_id !== agent.id &&
        ["pending", "sent", "working"].includes(task.status) &&
        isDelegatedTask(task)
    );

  if (agent.status === "error") return "error";

  if (snapshot.activeTask) {
    if (agent.role === "orchestrator") return hasDelegatedWorkers ? "syncing" : "thinking";
    return isDelegatedTask(snapshot.activeTask) ? "syncing" : "working";
  }

  if (isRecent(snapshot.latestTask?.completed_at, 10000)) {
    return "talking";
  }

  return "sleep";
}

function getActivityLabel(activity) {
  switch (activity) {
    case "thinking": return "orchestrating";
    case "working": return "coding";
    case "talking": return "replying";
    case "syncing": return "handoff";
    case "error": return "blocked";
    case "sleep":
    default: return "sleeping";
  }
}

export function BrowserSessions({
  agents,
  runtimeState,
  onInspectAgent,
  onOpenAgent,
  taskQueues,
  tasks
}) {
  if (agents.length === 0) {
    return (
      <aside className="right-sidebar">
        <div className="right-sidebar-header">
          <span className="eyebrow">Sessions</span>
        </div>
        <div style={{ padding: "1rem", color: "var(--muted)", fontSize: "0.8rem" }}>
          No agents yet.
        </div>
      </aside>
    );
  }

  return (
    <aside className="right-sidebar">
      <div className="right-sidebar-header">
        <span className="eyebrow">Browser Sessions</span>
        <span className="pill">{agents.length}</span>
      </div>

      <div className="session-list-compact">
        {agents.map((agent) => {
          const state = runtimeState[agent.id] || {};
          const queue = taskQueues?.[agent.id] || [];
          const snapshot = getAgentTaskSnapshot(agent, tasks);
          const interactiveReplyState = extractInteractiveReplyState(snapshot.latestTask?.response || "");
          const awaitingReply = !snapshot.activeTask && interactiveReplyState.awaitingInput;
          const activeTaskText = snapshot.activeTask?.user_task || queue[0] || "";
          const latestTaskText = snapshot.latestTask?.user_task || "";
          const activity = awaitingReply ? "talking" : deriveAgentActivity(agent, state, tasks);
          const visualStatus =
            agent.status === "error"
              ? "error"
              : snapshot.activeTask
                ? "working"
                : awaitingReply || isRecent(snapshot.latestTask?.completed_at, 10000)
                  ? "done"
                  : "idle";

          const statusText =
            snapshot.activeTask && activeTaskText
              ? activeTaskText
              : awaitingReply
                ? interactiveReplyState.summary || "Waiting for your reply"
              : activity === "talking" && latestTaskText
                ? latestTaskText
                : state.loggedIn
                  ? "Ready"
                  : agent.platform;

          return (
            <div key={agent.id} className="session-card-v2">
              <div className="session-card-v2-name">{agent.name}</div>

              <div className="session-card-v2-avatar">
                <HydraSprite
                  activity={activity}
                  role={agent.role}
                  label={`${agent.name} ${getActivityLabel(activity)}`}
                />
                <div
                  className={`session-status-dot ${
                    visualStatus === "working"
                      ? "working"
                      : visualStatus === "done"
                        ? "done"
                        : visualStatus === "error"
                          ? "error"
                          : "idle"
                  }`}
                />
              </div>

              <div className="session-card-v2-status">
                {awaitingReply ? "awaiting input" : getActivityLabel(activity)}
              </div>

              <p className="session-card-v2-task">{statusText}</p>

              <div className="session-card-v2-actions">
                <button
                  type="button"
                  className="session-icon-btn"
                  onClick={() => onOpenAgent(agent)}
                  title="Open browser"
                >
                  &#x2197;
                </button>
                <button
                  type="button"
                  className="session-icon-btn"
                  onClick={() => onInspectAgent(agent)}
                  title="Check session"
                >
                  &#x21BB;
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
