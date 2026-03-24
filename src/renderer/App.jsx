import * as React from "react";
import { AgentSidebar } from "./components/AgentSidebar.jsx";
import { BrowserSessions } from "./components/BrowserSessions.jsx";
import { ProjectHistoryPanel } from "./components/ProjectHistoryPanel.jsx";
import { ProjectPanel } from "./components/ProjectPanel.jsx";
import { ProjectSettings } from "./components/ProjectSettings.jsx";
import { TaskBroadcast } from "./components/TaskBroadcast.jsx";
import { Tooltip } from "./components/Tooltip.jsx";
import { useAgents } from "./hooks/useAgents.js";
import { useProjectHistory } from "./hooks/useProjectHistory.js";
import { useProjectTasks } from "./hooks/useProjectTasks.js";
import { useProjects } from "./hooks/useProjects.js";

export default function App() {
  const [serverUrl, setServerUrl] = React.useState("");
  const [bootError, setBootError] = React.useState("");
  const [runtimeState, setRuntimeState] = React.useState({});
  const [taskEvents, setTaskEvents] = React.useState([]);
  const [workspaceTab, setWorkspaceTab] = React.useState("orchestrator");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = React.useState(false);
  const workspaceTabsRef = React.useRef(null);

  React.useEffect(() => {
    return window.agentSync.onTaskEvent((event) => {
      setTaskEvents((prev) => {
        // Keep only the last 100 events to prevent memory leaks
        const next = [...prev, event].slice(-100);
        return next;
      });
    });
  }, []);

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

  const activeProject = projectState.projects.find(
    (project) => project.id === projectState.activeProjectId
  );
  const orchestratorAgent =
    agentState.agents.find((agent) => agent.role === "orchestrator") || null;
  const workerAgents = agentState.agents.filter((agent) => agent.role !== "orchestrator");

  const recentTaskSpendUsd = projectTasks.tasks.reduce((sum, task) => {
    const value = Number.parseFloat(task?.cost_usd ?? task?.costUsd ?? "0");
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  async function handleOpenAgent(agent) {
    await window.agentSync.openAgent(agent.id, agent.platform);
    await handleInspectAgent(agent);
  }

  async function handleInspectAgent(agent) {
    const state = await window.agentSync.inspectAgent(agent.id, agent.platform);
    setRuntimeState((current) => ({ ...current, [agent.id]: state }));
  }

  function getProjectMonogram(name) {
    const text = String(name ?? "").trim();
    if (!text) return "?";
    const words = text.split(/\s+/).filter(Boolean);
    const first = words[0]?.[0] || "?";
    const second = words.length > 1 ? (words[1]?.[0] || "") : (words[0]?.[1] || "");
    return `${first}${second}`.toUpperCase();
  }

  function truncateInline(text, max = 90) {
    const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
  }

  function getCollapsedProjectTooltip(project) {
    const title = String(project?.name ?? "").trim();

    const isActive = project?.id && project.id === projectState.activeProjectId;
    const lastTask = isActive ? projectTasks.tasks?.[0] : null;
    const lastMessage = truncateInline(lastTask?.user_task || lastTask?.response || "", 110);
    const fallback = truncateInline(project?.description || project?.root_path || "", 110);
    const detail = lastMessage || fallback;

    return detail ? `${title}\n${detail}` : title;
  }

  React.useEffect(() => {
    const node = workspaceTabsRef.current;
    if (!node) return;

    const handleWheel = (event) => {
      if (node.scrollWidth <= node.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      
      event.preventDefault();
      node.scrollLeft += delta;
    };

    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [bootError]);

  function hasAgentActiveTask(agentId) {
    return projectTasks.tasks.some(
      (task) => task.agent_id === agentId && ["pending", "sent", "working"].includes(task.status)
    );
  }

  if (bootError) {
    return <main className="grid place-items-center min-h-screen text-zinc-500">Failed to start: {bootError}</main>;
  }

  if (!serverUrl) {
    return <main className="grid place-items-center min-h-screen text-zinc-500">Connecting to local services...</main>;
  }

  async function handleSendTask(agentId, task) {
    const agent = agentState.agents.find(a => a.id === agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const result = await window.agentSync.sendTaskToAgent(
      agent,
      projectState.activeProjectId,
      task
    );

    if (result && result.success === false) {
      throw new Error(result.error || "Task execution failed.");
    }

    return result;
  }

  return (
    <div className={`grid h-screen overflow-hidden bg-zinc-950 transition-all duration-300 ${
      isSidebarCollapsed 
        ? (isRightSidebarCollapsed ? "grid-cols-[64px_1fr_64px]" : "grid-cols-[64px_1fr_260px]")
        : (isRightSidebarCollapsed ? "grid-cols-[280px_1fr_64px]" : "grid-cols-[280px_1fr_260px]")
    }`}>
      {/* Left rail */}
      <aside className={`flex flex-col border-r border-white/5 overflow-y-auto overflow-x-hidden bg-zinc-900/50 transition-all duration-300 custom-scrollbar relative ${
        isSidebarCollapsed ? "p-2 items-center" : "p-3"
      }`}>
        <div className={`px-2 py-4 border-b border-white/5 mb-4 w-full ${isSidebarCollapsed ? "flex justify-center" : ""}`}>
          <Tooltip content={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} position="right">
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((v) => !v)}
              className={`flex items-center gap-3 mb-1 rounded-[5px] transition-colors ${
                isSidebarCollapsed
                  ? "p-0"
                  : "p-2 w-full hover:bg-white/[0.03]"
              }`}
            >
              <img
                className="w-[clamp(36px,4vw,44px)] h-[clamp(36px,4vw,44px)] shrink-0 drop-shadow-[0_10px_18px_rgba(99,102,241,0.2)]"
                src="/hydra-icon.svg"
                alt=""
              />
              {!isSidebarCollapsed && (
                <div className="min-w-0 animate-in fade-in duration-500 text-left">
                  <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-indigo-500 mb-0.5">Hydra</p>
                  <h1 className="text-base font-semibold text-zinc-100 uppercase tracking-tighter italic">Deck</h1>
                </div>
              )}
            </button>
          </Tooltip>
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
          <div className="animate-in fade-in duration-500 flex flex-col flex-1 min-h-0 w-full items-center">
            <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden custom-scrollbar">
              <div className="flex flex-col items-center gap-3 pb-4">
                {projectState.projects.length === 0 ? (
                  <div className="w-10 h-10 rounded-[5px] border border-dashed border-white/10 bg-zinc-950/40 flex items-center justify-center text-zinc-700 text-xs font-black" title="No projects">
                    —
                  </div>
                ) : (
                  projectState.projects.map((project) => {
                    const isActive = project.id === projectState.activeProjectId;
                    return (
                      <Tooltip key={project.id} content={getCollapsedProjectTooltip(project)} position="right">
                        <button
                          type="button"
                          className={`relative w-10 h-10 rounded-[5px] border transition-all flex items-center justify-center overflow-hidden ${
                            isActive
                              ? "bg-indigo-500/10 text-indigo-300 border-indigo-500/20 shadow-sm"
                              : "bg-zinc-950 text-zinc-500 border-white/5 hover:bg-white/[0.03] hover:text-zinc-200 hover:border-white/10"
                          }`}
                          onClick={() => projectState.activateProject(project.id)}
                          onDoubleClick={() => setIsSidebarCollapsed(false)}
                        >
                          <span className="text-[10px] font-black tracking-tight">
                            {getProjectMonogram(project.name)}
                          </span>
                          {isActive ? (
                            <span className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border-2 border-zinc-900 bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                          ) : null}
                        </button>
                      </Tooltip>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Workspace center */}
      <section className="flex flex-col overflow-hidden p-4 gap-4 bg-zinc-950">
        <div className="flex items-center justify-between gap-4 shrink-0">
          <div className="flex-1 flex justify-start min-w-0">
            <div
              ref={workspaceTabsRef}
              className="flex gap-1 p-1 rounded-[5px] bg-white/5 border border-white/5 shadow-inner overflow-x-auto overflow-y-hidden custom-scrollbar"
            >
              {[
                { id: "orchestrator", label: "Orchestrator", icon: "💬" },
                { id: "agents", label: "Agents", icon: "🤖" },
                { id: "history", label: "History", icon: "📚" },
                { id: "settings", label: "Settings", icon: "⚙️" }
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-[5px] transition-all flex items-center gap-2 whitespace-nowrap ${
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
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 px-4 py-2 rounded-[5px] border border-white/5 bg-zinc-900/50 shadow-sm" title={activeProject?.name || "No project selected"}>
              <div className="grid gap-0.5 min-w-0">
                <span className="text-[9px] font-black tracking-[0.2em] uppercase text-zinc-500 leading-none">Active Project</span>
                <strong className="text-xs text-indigo-400 truncate max-w-[140px] font-bold">{activeProject?.name || "None"}</strong>
              </div>
              {recentTaskSpendUsd > 0 ? (
                <div className="pl-3 ml-1 border-l border-white/5 grid gap-0.5" title="Estimated spend across the latest tasks (API-routed agents only).">
                  <span className="text-[9px] font-black tracking-[0.2em] uppercase text-zinc-600 leading-none">Spend</span>
                  <strong className="text-xs text-emerald-400 tabular-nums font-bold">${recentTaskSpendUsd.toFixed(2)}</strong>
                </div>
              ) : null}
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
              taskEvents={taskEvents}
              onSendToAgent={handleSendTask}
            />
          ) : workspaceTab === "agents" ? (
            <div className="h-full overflow-y-auto custom-scrollbar pr-2">
              <AgentSidebar
                agents={agentState.agents}
                catalog={agentState.catalog}
                loading={agentState.loading}
                onCreateAgent={agentState.createAgent}
                onDeleteAgent={agentState.deleteAgent}
                onUpdateAgentRole={agentState.updateAgentRole}
                onUpdateAgentSpecialty={agentState.updateAgentSpecialty}
                onRenameAgent={agentState.renameAgent}
                projectRoot={activeProject?.root_path || ""}
                fullPage={true}
              />
            </div>
          ) : workspaceTab === "history" ? (
            <ProjectHistoryPanel
              activeProject={activeProject}
              history={projectHistory}
              loading={projectHistory.loading}
            />
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
        tasks={projectTasks.tasks}
        onOpenAgent={handleOpenAgent}
        onInspectAgent={handleInspectAgent}
        isCollapsed={isRightSidebarCollapsed}
        onToggleCollapse={() => setIsRightSidebarCollapsed(!isRightSidebarCollapsed)}
        className="custom-scrollbar"
      />
    </div>
  );
}
