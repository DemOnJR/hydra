import { useEffect, useState } from "react";
import { AgentSidebar } from "./components/AgentSidebar.jsx";
import { BrowserSessions } from "./components/BrowserSessions.jsx";
import { NotificationFeed } from "./components/NotificationFeed.jsx";
import { ProjectHistoryPanel } from "./components/ProjectHistoryPanel.jsx";
import { ProjectPanel } from "./components/ProjectPanel.jsx";
import { TaskBroadcast } from "./components/TaskBroadcast.jsx";
import { TaskQueueViewer } from "./components/TaskQueueViewer.jsx";
import { useAgents } from "./hooks/useAgents.js";
import { useProjectHistory } from "./hooks/useProjectHistory.js";
import { useProjectTasks } from "./hooks/useProjectTasks.js";
import { useProjects } from "./hooks/useProjects.js";
import { useTaskManager } from "./hooks/useTaskManager.js";

export default function App() {
  const [serverUrl, setServerUrl] = useState("");
  const [bootError, setBootError] = useState("");
  const [runtimeState, setRuntimeState] = useState({});
  const [activeTab, setActiveTab] = useState("projects");
  const [workspaceTab, setWorkspaceTab] = useState("orchestrator");

  useEffect(() => {
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
    markAgentStatus: agentState.markAgentStatus
  });

  const activeProject = projectState.projects.find(
    (project) => project.id === projectState.activeProjectId
  );
  const orchestratorAgent =
    agentState.agents.find((agent) => agent.role === "orchestrator") || null;
  const workerAgents = agentState.agents.filter((agent) => agent.role !== "orchestrator");

  const notifEvents = taskManager.taskEvents
    .filter(ev => ["done", "error", "working", "delegated", "assistant"].includes(ev.kind))
    .map((ev, i) => ({ ...ev, id: ev.id || `notif-${i}` }));

  async function handleOpenAgent(agent) {
    await window.agentSync.openAgent(agent.id, agent.platform);
    await handleInspectAgent(agent);
  }

  async function handleInspectAgent(agent) {
    const state = await window.agentSync.inspectAgent(agent.id, agent.platform);
    setRuntimeState((current) => ({ ...current, [agent.id]: state }));
  }

  if (bootError) {
    return <main className="boot-screen">Failed to start: {bootError}</main>;
  }

  if (!serverUrl) {
    return <main className="boot-screen">Connecting to local services...</main>;
  }

  return (
    <div className="app-shell">
      {/* Left rail */}
      <aside className="left-rail">
        <div className="brand-block">
          <div className="brand-lockup">
            <img className="brand-mark" src="/hydra-icon.svg" alt="" />
            <div className="brand-copy">
              <p className="app-name">Hydra</p>
              <h1>Command Deck</h1>
            </div>
          </div>
        </div>

        <div className="tab-bar">
          <button
            type="button"
            className={activeTab === "projects" ? "tab-btn active" : "tab-btn"}
            onClick={() => setActiveTab("projects")}
          >
            Projects
          </button>
          <button
            type="button"
            className={activeTab === "agents" ? "tab-btn active" : "tab-btn"}
            onClick={() => setActiveTab("agents")}
          >
            Agents
          </button>
        </div>

        {activeTab === "projects" && (
          <ProjectPanel
            projects={projectState.projects}
            activeProject={activeProject}
            activeProjectId={projectState.activeProjectId}
            loading={projectState.loading}
            onCreateProject={projectState.createProject}
            onActivateProject={projectState.activateProject}
            onUpdateProject={projectState.updateProject}
            onDeleteProject={projectState.deleteProject}
          />
        )}

        {activeTab === "agents" && (
          <AgentSidebar
            agents={agentState.agents}
            loading={agentState.loading}
            queueCounts={Object.fromEntries(
              Object.entries(taskManager.taskQueues).map(([id, queue]) => [id, queue.length])
            )}
            onCreateAgent={agentState.createAgent}
            onDeleteAgent={agentState.deleteAgent}
            onUpdateAgentRole={agentState.updateAgentRole}
            onUpdateAgentSpecialty={agentState.updateAgentSpecialty}
            onRenameAgent={agentState.renameAgent}
          />
        )}
      </aside>

      {/* Workspace center */}
      <section className="workspace">
        <div className="workspace-topbar">
          <div className="workspace-tabs">
            <button
              type="button"
              className={workspaceTab === "orchestrator" ? "workspace-tab-btn active" : "workspace-tab-btn"}
              onClick={() => setWorkspaceTab("orchestrator")}
            >
              Orchestrator
            </button>
            <button
              type="button"
              className={workspaceTab === "history" ? "workspace-tab-btn active" : "workspace-tab-btn"}
              onClick={() => setWorkspaceTab("history")}
            >
              History
            </button>
            <button
              type="button"
              className={workspaceTab === "queue" ? "workspace-tab-btn active" : "workspace-tab-btn"}
              onClick={() => setWorkspaceTab("queue")}
            >
              Queue
            </button>
          </div>

          <NotificationFeed events={notifEvents} />

          <div className="workspace-project-pill" title={activeProject?.name || "No project selected"}>
            <img className="workspace-project-mark" src="/hydra-icon.svg" alt="" />
            <div className="workspace-project-copy">
              <span className="workspace-project-label">Project</span>
              <strong>{activeProject?.name || "No project selected"}</strong>
            </div>
          </div>
        </div>

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
        ) : workspaceTab === "history" ? (
          <ProjectHistoryPanel
            activeProject={activeProject}
            history={projectHistory}
            loading={projectHistory.loading}
          />
        ) : (
          <TaskQueueViewer tasks={projectTasks.tasks} agents={agentState.agents} />
        )}
      </section>

      {/* Right sidebar */}
      <BrowserSessions
        agents={agentState.agents}
        runtimeState={runtimeState}
        taskQueues={taskManager.taskQueues}
        tasks={projectTasks.tasks}
        onOpenAgent={handleOpenAgent}
        onInspectAgent={handleInspectAgent}
      />
    </div>
  );
}
