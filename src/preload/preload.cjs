const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentSync", {
  getConfig: () => ipcRenderer.invoke("agent-sync:get-config"),
  selectFolder: () => ipcRenderer.invoke("agent-sync:select-folder"),
  getAgentJournal: ({ projectRoot, agent }) =>
    ipcRenderer.invoke("agent-sync:get-agent-journal", {
      projectRoot,
      agent
    }),
  openAgent: (agentId, platform) =>
    ipcRenderer.invoke("agent-sync:open-agent", {
      agentId,
      platform
    }),
  inspectAgent: (agentId, platform) =>
    ipcRenderer.invoke("agent-sync:inspect-agent", {
      agentId,
      platform
    }),
  sendTaskToAgent: (agent, projectId, task) =>
    ipcRenderer.invoke("agent-sync:send-task-to-agent", {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      platform: agent.platform,
      projectId,
      task
    }),
  saveDecisions: (projectId, decisions) =>
    ipcRenderer.invoke("agent-sync:save-decisions", {
      projectId,
      decisions
    }),
  onTaskEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent-sync:task-event", listener);
    return () => {
      ipcRenderer.removeListener("agent-sync:task-event", listener);
    };
  }
});
