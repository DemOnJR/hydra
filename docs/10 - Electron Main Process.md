# 10 - Electron Main Process

Main process responsibilities:

- app lifecycle and window creation
- IPC registration and command handling
- Playwright/browser session management
- starting and talking to the local Context Server

## Primary files

- `src/main/index.js` - Electron startup and lifecycle
- `src/main/windowManager.js` - BrowserWindow setup
- `src/main/ipcHandlers.js` - core IPC handlers and task execution flow
- `src/main/playwrightManager.js` - session launch/connect/inspect
- `src/main/serverProcess.js` - spawns local Express server
- `src/main/serverClient.js` - HTTP client to local server
- `src/main/promptBuilder.js` - full prompt construction
- `src/main/toolBridge.js` - Hydra tool implementations

## Related notes

- [[13 - Browser Automation]]
- [[20 - Core Flows]]
- [[30 - Key Entry Points]]
