import { HydraSprite } from "./HydraSprite.jsx";
import { Tooltip } from "./Tooltip.jsx";
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
  tasks,
  isCollapsed = false,
  onToggleCollapse,
  className = ""
}) {
  if (agents.length === 0) {
    return (
      <aside className={`flex flex-col border-l border-white/5 bg-zinc-900/50 overflow-y-auto ${className}`}>
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-white/5 sticky top-0 bg-zinc-900/80 backdrop-blur-md z-10">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors text-zinc-500 hover:text-zinc-300"
            title={isCollapsed ? "Expand" : "Collapse"}
          >
            {isCollapsed ? "←" : "→"}
          </button>
          {!isCollapsed && <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex-1">Sessions</span>}
        </div>
        <div className="p-4 text-zinc-500 text-xs">
          No agents yet.
        </div>
      </aside>
    );
  }

  return (
    <aside className={`flex flex-col border-l border-white/5 bg-zinc-900/50 overflow-y-auto ${className} ${isCollapsed ? "items-center" : ""}`}>
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-white/5 sticky top-0 bg-zinc-900/80 backdrop-blur-md z-10 w-full">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/5 transition-colors text-zinc-500 hover:text-zinc-300 shrink-0"
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? "←" : "→"}
        </button>
        {!isCollapsed && (
          <>
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex-1 whitespace-nowrap">Browser Sessions</span>
            <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-zinc-800 text-zinc-400 text-[10px] font-medium leading-none">{agents.length}</span>
          </>
        )}
      </div>

      <div className="flex flex-col w-full">
        {agents.map((agent) => {
          const state = runtimeState[agent.id] || {};
          const snapshot = getAgentTaskSnapshot(agent, tasks);
          const interactiveReplyState = extractInteractiveReplyState(snapshot.latestTask?.response || "");
          const awaitingReply = !snapshot.activeTask && interactiveReplyState.awaitingInput;
          const activeTaskText = snapshot.activeTask?.user_task || "";
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
            <div key={agent.id} className={`flex flex-col items-center gap-3 p-5 border-b border-white/5 hover:bg-white/[0.02] transition-colors group ${isCollapsed ? "p-3" : ""}`}>
              
              <div className="flex items-center justify-center gap-2.5 w-full">
                {/* Agent Name Vertical */}
                {!isCollapsed && (
                  <div className="text-[7px] font-medium text-zinc-500 tracking-widest uppercase whitespace-nowrap [writing-mode:vertical-lr] rotate-180 group-hover:text-zinc-400 transition-colors max-h-[48px] truncate">
                    {agent.name}
                  </div>
                )}

                {/* Avatar */}
                <Tooltip content={isCollapsed ? `${agent.name} (${agent.platform})` : "Check session"} position="left">
                  <div 
                    className="relative flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
                    onClick={() => onInspectAgent(agent)}
                  >
                    <div className={`p-2 rounded-[5px] border transition-all duration-300 ${
                      agent.role === "orchestrator" 
                        ? "bg-indigo-500/10 border-indigo-500/30 group-hover:bg-indigo-500/20 shadow-lg shadow-indigo-500/5" 
                        : "bg-emerald-500/5 border-emerald-500/20 group-hover:bg-emerald-500/10 shadow-lg shadow-emerald-500/5"
                    }`}>
                      <HydraSprite
                        activity={activity}
                        role={agent.role}
                        label={`${agent.name} ${getActivityLabel(activity)}`}
                        size={isCollapsed ? 32 : 38}
                      />
                    </div>
                    <div
                      className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-zinc-900 z-10 ${
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
                </Tooltip>

                {/* Platform Name Vertical */}
                {!isCollapsed && (
                  <div className="text-[7px] font-medium text-zinc-600 uppercase tracking-widest whitespace-nowrap [writing-mode:vertical-lr] opacity-70">
                    {agent.platform}
                  </div>
                )}
              </div>

              {!isCollapsed && (
                <div className="text-[7px] font-medium tracking-widest uppercase text-zinc-600 mt-0.5">
                  {awaitingReply ? <span className="text-amber-500 animate-pulse">awaiting input</span> : getActivityLabel(activity)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
