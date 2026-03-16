import * as React from "react";
import { AgentSidebar } from "./components/AgentSidebar.jsx";
import { BrowserSessions } from "./components/BrowserSessions.jsx";
import { NotificationFeed } from "./components/NotificationFeed.jsx";
import { ProjectHistoryPanel } from "./components/ProjectHistoryPanel.jsx";
import { ProjectPanel } from "./components/ProjectPanel.jsx";
import { ProjectSettings } from "./components/ProjectSettings.jsx";
import { TaskBroadcast } from "./components/TaskBroadcast.jsx";
import { TaskQueueViewer } from "./components/TaskQueueViewer.jsx";
import { useAgents } from "./hooks/useAgents.js";
import { useProjectHistory } from "./hooks/useProjectHistory.js";
import { useProjectTasks } from "./hooks/useProjectTasks.js";
import { useProjects } from "./hooks/useProjects.js";
import { useTaskManager } from "./hooks/useTaskManager.js";

export default function App() {
  const [serverUrl, setServerUrl] = React.useState("");
  const [bootError, setBootError] = React.useState("");
  const [runtimeState, setRuntimeState] = React.useState({});
  const [workspaceTab, setWorkspaceTab] = React.useState("orchestrator");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    window.agentSync
      .getConfig()
      .then((config) => {
        if (!cancelled) {
          setServerUrl(config.serverUrl);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setBootError(error.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const projectState = useProjects(serverUrl);
  const agentState = useAgents(serverUrl);
  const projectTasks = useProjectTasks(serverUrl, projectState.activeProjectId);
  const projectHistory = useProjectHistory(serverUrl, projectState.activeProjectId);
  const taskManager = useTaskManager({
    activeProjectId: projectState.activeProjectId,
    agents: agentState.agents,
    markAgentStatus: agentState.markAgentStatus,
    serverUrl
  });

  const activeProject = projectState.projects.find(
    (project) => project.id === projectState.activeProjectId
  );
  const orchestratorAgent =
    agentState.agents.find((agent) => agent.role === "orchestrator") || null;
  const workerAgents = agentState.agents.filter((agent) => agent.role !== "orchestrator");

  const notifEvents = taskManager.taskEvents
    .filter(ev => ["done", "error", "working", "delegated", "assistant"].includes(ev.kind))
    .filter(ev => !ev.message?.startsWith("[Downloading"))
    .map((ev, i) => ({ ...ev, id: ev.id || `notif-${i}` }));

  // --- Notifications & Sound alerts ---
  const lastNotifId = React.useRef(null);
  React.useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  React.useEffect(() => {
    if (notifEvents.length === 0) return;
    const latest = notifEvents[notifEvents.length - 1];
    if (latest.id === lastNotifId.current) return;
    
    const isNew = lastNotifId.current !== null;
    lastNotifId.current = latest.id;

    if (isNew && (latest.kind === "done" || latest.kind === "error")) {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(`Hydra: ${latest.label}`, {
          body: latest.message,
          icon: "/hydra-icon.png"
        });
      }
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        oscillator.type = latest.kind === "error" ? "sawtooth" : "sine";
        oscillator.frequency.setValueAtTime(latest.kind === "error" ? 200 : 440, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.5);
        oscillator.connect(gain);
        gain.connect(audioCtx.destination);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.5);
      } catch (e) {
        console.warn("Sound play failed", e);
      }
    }
  }, [notifEvents]);

  async function handleOpenAgent(agent) {
    await window.agentSync.openAgent(agent.id, agent.platform);
    await handleInspectAgent(agent);
  }

  async function handleInspectAgent(agent) {
    const state = await window.agentSync.inspectAgent(agent.id, agent.platform);
    setRuntimeState((current) => ({ ...current, [agent.id]: state }));
  }

  if (bootError) {
    return <main className="grid place-items-center min-h-screen text-zinc-500">Failed to start: {bootError}</main>;
  }

  if (!serverUrl) {
    return <main className="grid place-items-center min-h-screen text-zinc-500">Connecting to local services...</main>;
  }

  return (
    <div className={`grid h-screen overflow-hidden bg-zinc-950 transition-all duration-300 ${
      isSidebarCollapsed ? "grid-cols-[64px_1fr_260px]" : "grid-cols-[280px_1fr_260px]"
    }`}>
      {/* Left rail */}
      <aside className={`flex flex-col border-r border-white/5 overflow-y-auto overflow-x-hidden bg-zinc-900/50 transition-all duration-300 custom-scrollbar relative ${
        isSidebarCollapsed ? "p-2 items-center" : "p-3"
      }`}>
        <button 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white z-50 shadow-md transition-transform hover:scale-110"
          title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          <span className="text-[10px]">{isSidebarCollapsed ? "→" : "←"}</span>
        </button>

        <div className={`px-2 py-4 border-b border-white/5 mb-4 w-full ${isSidebarCollapsed ? "flex justify-center" : ""}`}>
          <div className="flex items-center gap-3 mb-1">
            <img className="w-11 h-11 shrink-0 drop-shadow-[0_10px_18px_rgba(99,102,241,0.2)]" src="/hydra-icon.svg" alt="" />
            {!isSidebarCollapsed && (
              <div className="min-w-0 animate-in fade-in duration-500">
                <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-indigo-500 mb-0.5">Hydra</p>
                <h1 className="text-base font-semibold text-zinc-100 uppercase tracking-tighter italic">Deck</h1>
              </div>
            )}
          </div>
        </div>

        {!isSidebarCollapsed ? (
          <div className="animate-in fade-in duration-500 flex flex-col flex-1 min-h-0">
            <ProjectPanel
              projects={projectState.projects}
              activeProjectId={projectState.activeProjectId}
              loading={projectState.loading}
              onCreateProject={projectState.createProject}
              onActivateProject={projectState.activateProject}
              onDeleteProject={projectState.deleteProject}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-6 mt-6 animate-in fade-in duration-500">
            <button 
              onClick={() => setIsSidebarCollapsed(false)} 
              className="p-2 rounded-xl transition-all bg-indigo-500/20 text-indigo-400 shadow-lg shadow-indigo-500/10" 
              title="Projects"
            >
              <span className="text-xl">📁</span>
            </button>
            <button 
              onClick={() => {setIsSidebarCollapsed(false); setWorkspaceTab("agents");}} 
              className={`p-2 rounded-xl transition-all ${workspaceTab === "agents" ? "bg-indigo-500/20 text-indigo-400" : "text-zinc-500 hover:text-zinc-300"}`} 
              title="Agents"
            >
              <span className="text-xl">🤖</span>
            </button>
          </div>
        )}
      </aside>

      {/* Workspace center */}
      <section className="flex flex-col overflow-hidden p-4 gap-4 bg-zinc-950">
        <div className="flex items-center justify-between gap-4 shrink-0">
          <div className="flex gap-1 p-1 rounded-full bg-white/5 border border-white/5 shadow-inner overflow-x-auto custom-scrollbar no-scrollbar">
            {[
              { id: "orchestrator", label: "Orchestrator", icon: "💬" },
              { id: "agents", label: "Agents", icon: "🤖" },
              { id: "history", label: "History", icon: "📚" },
              { id: "queue", label: "Queue", icon: "⏳" },
              { id: "settings", label: "Settings", icon: "⚙️" }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-full transition-all flex items-center gap-2 whitespace-nowrap ${
                  workspaceTab === tab.id 
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" 
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                }`}
                onClick={() => setWorkspaceTab(tab.id)}
              >
                <span className="text-xs">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <NotificationFeed events={notifEvents} />

            <div className="flex items-center gap-3 px-4 py-2 rounded-2xl border border-white/5 bg-zinc-900/50 shadow-sm" title={activeProject?.name || "No project selected"}>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[9px] font-black tracking-[0.2em] uppercase text-zinc-500 leading-none">Active Project</span>
                <strong className="text-xs text-indigo-400 truncate max-w-[140px] font-bold">{activeProject?.name || "None"}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {workspaceTab === "orchestrator" ? (
            <TaskBroadcast
              serverUrl={serverUrl}
              activeProject={activeProject}
              orchestratorAgent={orchestratorAgent}
              workerAgents={workerAgents}
              tasks={projectTasks.tasks}
              taskEvents={taskManager.taskEvents}
              onSendToAgent={taskManager.sendTask}
            />
          ) : workspaceTab === "agents" ? (
            <div className="h-full overflow-y-auto custom-scrollbar pr-2">
              <AgentSidebar
                agents={agentState.agents}
                catalog={agentState.catalog}
                loading={agentState.loading}
                queueCounts={Object.fromEntries(
                  Object.entries(taskManager.taskQueues).map(([id, queue]) => [id, queue.length])
                )}
                onCreateAgent={agentState.createAgent}
                onDeleteAgent={agentState.deleteAgent}
                onUpdateAgentRole={agentState.updateAgentRole}
                onUpdateAgentSpecialty={agentState.updateAgentSpecialty}
                onRenameAgent={agentState.renameAgent}
                fullPage={true}
              />
            </div>
          ) : workspaceTab === "history" ? (
            <ProjectHistoryPanel
              activeProject={activeProject}
              history={projectHistory}
              loading={projectHistory.loading}
            />
          ) : workspaceTab === "queue" ? (
            <TaskQueueViewer tasks={projectTasks.tasks} agents={agentState.agents} onClear={taskManager.clearAll} />
          ) : (
            <ProjectSettings
              activeProject={activeProject}
              onUpdateProject={projectState.updateProject}
            />
          )}
        </div>
      </section>

      {/* Right sidebar */}
      <BrowserSessions
        agents={agentState.agents}
        runtimeState={runtimeState}
        taskQueues={taskManager.taskQueues}
        tasks={projectTasks.tasks}
        onOpenAgent={handleOpenAgent}
        onInspectAgent={handleInspectAgent}
        className="custom-scrollbar"
      />
    </div>
  );
}
