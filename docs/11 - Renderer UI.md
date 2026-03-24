# 11 - Renderer UI

Renderer responsibilities:

- project and agent management UI
- task compose/send UX
- response display and save-to-context UX
- sidebar status for browser sessions

## Primary files

- `src/renderer/main.jsx` - React entry
- `src/renderer/App.jsx` - top-level layout and orchestration
- `src/renderer/components/TaskBroadcast.jsx` - task composer + response stream UI
- `src/renderer/components/ProjectPanel.jsx` - project list/settings entry
- `src/renderer/components/AgentSidebar.jsx` - agent management
- `src/renderer/components/BrowserSessions.jsx` - session status controls
- `src/renderer/components/ResponseCollector.jsx` - context save flow
- `src/renderer/hooks/useProjects.js` - project state
- `src/renderer/hooks/useAgents.js` - agent state
- `src/renderer/hooks/useProjectTasks.js` - task polling/state
- `src/renderer/hooks/useProjectHistory.js` - memory/history panel

## Talks to

- IPC bridge in `src/preload/preload.cjs`
- Main process handlers in `src/main/ipcHandlers.js`
- Local server REST API in `server/routes/*.js`

## Related notes

- [[10 - Electron Main Process]]
- [[12 - Context Server]]
- [[20 - Core Flows]]
