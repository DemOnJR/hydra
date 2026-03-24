# 30 - Key Entry Points

When exploring unfamiliar behavior, start from these files.

- `src/main/index.js` - desktop app startup and process wiring
- `src/main/ipcHandlers.js` - central IPC behavior and task execution
- `src/main/toolBridge.js` - tool execution surface used by orchestration
- `src/main/playwrightManager.js` - browser lifecycle and session handling
- `src/renderer/App.jsx` - top-level UI composition
- `src/renderer/components/TaskBroadcast.jsx` - task UX and response handling
- `server/index.js` - server bootstrap and route registration
- `server/db/queries.js` - most persistence behavior
- `server/orchestrator/sessionRunner.js` - orchestrator runtime loop
- `server/ai/caller.js` - model provider routing

## Related notes

- [[02 - Where To Look]]
- [[10 - Electron Main Process]]
- [[12 - Context Server]]
