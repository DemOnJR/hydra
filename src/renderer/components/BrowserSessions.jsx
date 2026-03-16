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
  tasks,
  className = ""
}) {
  if (agents.length === 0) {
    return (
      <aside className={`flex flex-col border-l border-white/5 bg-zinc-900/50 overflow-y-auto ${className}`}>
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-white/5 sticky top-0 bg-zinc-900/80 backdrop-blur-md z-10">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex-1">Sessions</span>
        </div>
        <div className="p-4 text-zinc-500 text-xs">
          No agents yet.
        </div>
      </aside>
    );
  }

  return (
    <aside className={`flex flex-col border-l border-white/5 bg-zinc-900/50 overflow-y-auto ${className}`}>
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-white/5 sticky top-0 bg-zinc-900/80 backdrop-blur-md z-10">
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex-1 whitespace-nowrap">Browser Sessions</span>
        <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-zinc-800 text-zinc-400 text-[10px] font-medium leading-none">{agents.length}</span>
      </div>

      <div className="flex flex-col">
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
            <div key={agent.id} className="flex flex-col items-center gap-3 p-5 border-b border-white/5 hover:bg-white/[0.02] transition-colors group">
              <div className="text-[11px] font-bold text-zinc-400 group-hover:text-zinc-100 transition-colors tracking-tight uppercase truncate max-w-full">{agent.name}</div>

              <div className="relative flex items-center justify-center">
                <div className={`p-3 rounded-2xl border transition-all duration-300 ${
                  agent.role === "orchestrator" 
                    ? "bg-indigo-500/10 border-indigo-500/30 group-hover:bg-indigo-500/20 shadow-lg shadow-indigo-500/5" 
                    : "bg-emerald-500/5 border-emerald-500/20 group-hover:bg-emerald-500/10 shadow-lg shadow-emerald-500/5"
                }`}>
                  <HydraSprite
                    activity={activity}
                    role={agent.role}
                    label={`${agent.name} ${getActivityLabel(activity)}`}
                    size={48}
                  />
                </div>
                <div
                  className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-zinc-900 z-10 ${
                    visualStatus === "working"
                      ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse"
                      : visualStatus === "done"
                        ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                        : visualStatus === "error"
                          ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.3)]"
                          : "bg-zinc-600"
                  }`}
                />
              </div>

              <div className="text-[10px] font-bold tracking-widest uppercase text-zinc-500 mt-1">
                {awaitingReply ? <span className="text-amber-500 animate-pulse">awaiting input</span> : getActivityLabel(activity)}
              </div>

              <p className="text-xs text-zinc-400 text-center line-clamp-2 leading-relaxed h-8 flex items-center justify-center overflow-hidden px-1 italic">
                {statusText}
              </p>

              <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 border border-white/5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100 transition-colors shadow-sm"
                  onClick={() => onOpenAgent(agent)}
                  title="Open browser"
                >
                  ↗
                </button>
                <button
                  type="button"
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 border border-white/5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100 transition-colors shadow-sm"
                  onClick={() => onInspectAgent(agent)}
                  title="Check session"
                >
                  ↻
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
