# Technical Architecture - Hydra

## Tech stack

| Layer | Technology | Reason |
|---|---|---|
| Desktop app | Electron | Local UI, IPC, OS integration |
| Browser automation | Playwright + real browser | Compatible login, persistent sessions, robust control |
| Frontend UI | React + Vite | Fast iteration and componentization |
| Context Server | Node.js + Express | REST API + local MCP |
| Database | SQLite + better-sqlite3 | Local-first, simple, fast |
| MCP | @modelcontextprotocol/sdk | Integration with Claude Code, Codex, Cursor |

## Main components

### 1. Electron main process

Responsibilities:
- starts the local Context Server
- creates the main window
- exposes IPC for the renderer
- delegates browser operations to Playwright

Key files:

```text
src/main/
|-- chromeFinder.js
|-- index.js
|-- ipcHandlers.js
|-- playwrightManager.js
|-- platformUrls.js
|-- promptBuilder.js
|-- serverClient.js
|-- serverProcess.js
`-- windowManager.js
```

### 2. Renderer process

Responsibilities:
- project management
- agent management
- browser session control
- task broadcasting
- response visualization and saving to KB

Key files:

```text
src/renderer/
|-- App.jsx
|-- components/
|   |-- AgentSidebar.jsx
|   |-- BrowserSessions.jsx
|   |-- ProjectPanel.jsx
|   |-- ResponseCollector.jsx
|   `-- TaskBroadcast.jsx
`-- hooks/
    |-- useAgents.js
    |-- useProjects.js
    |-- useProjectTasks.js
    `-- useProjectHistory.js
```

### 3. Browser manager (Playwright + CDP)

Current model:
- real Chrome/Edge/Chromium browser launched as a separate process (`spawn`)
- connection via CDP (Chrome DevTools Protocol) for control
- isolated profile directories per agent on disk (stores login, cookies)
- each agent has its own real browser window controlled automatically
- better bypass for Cloudflare Turnstile and captchas by using the system browser
- "Blocked" agents can be unblocked manually via "Check session" if logged in

## Flows

### Adding an agent

```text
User creates agent
  -> agent is saved in SQLite
  -> Hydra can open its session in a real browser
  -> user logs in manually
  -> Playwright saves storage state to disk
```

### Broadcasting a task

```text
User writes task in UI
  -> Context Server returns the project knowledge base
  -> main process builds the full prompt
  -> Playwright injects the prompt into the agent's browser
  -> Playwright waits for the end of the response
  -> response is saved in DB and displayed in Electron
```

### Saving to knowledge base

```text
ResponseCollector displays the response
  -> user chooses "Save to KB"
  -> Context Server saves the decision in SQLite
  -> future tasks use the updated context
```

## Why Playwright and not webview

- the real browser passes login challenges more reliably
- selectors and actions are more robust than raw `executeJavaScript`
- sessions can be persisted without rendering pages in Electron
- Electron stays lightweight: control plane, not a browser host

## Trade-offs

- browser windows are separate from the Electron window
- initial login is manual
- platform selector adaptations still need to be maintained when the UI changes

## Security

- communication between UI and server stays on localhost
- data is stored locally
- browser sessions are isolated per agent
- Electron no longer embeds third-party sites in the UI
