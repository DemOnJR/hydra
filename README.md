# Hydra — Multi-AI Agent Orchestrator

Desktop application that coordinates multiple AI agents (ChatGPT, Gemini, Claude) through real browser sessions controlled via CDP (Chrome DevTools Protocol) with Playwright, shared context, and local task management.

## What it does

- Launches real browsers (Chrome / Edge) per agent via CDP
- Injects prompts and collects responses automatically
- Manages projects, knowledge base, and tasks locally (SQLite)
- Exposes a REST Context Server + MCP for CLI agents
- Electron dark-mode UI with 3-column layout

## UI — current layout

```text
┌─────────────┬──────────────────────┬───────────────┐
│  Left Rail  │     Workspace        │ Right Sidebar │
│  280px      │     (flex)           │   260px       │
│             │                      │               │
│  Projects   │  Active project      │  Browser      │
│  Agents     │  Task Broadcast      │  Sessions     │
│             │  Responses           │  (compact)    │
└─────────────┴──────────────────────┴───────────────┘
```

**Notable UI features:**
- `New project` button opens a modal with name, description, root folder (native Windows folder picker), and mode fields
- Browser Sessions appear in the right sidebar — each agent has an animated status dot (idle / working / done / error) and the current task visible
- Full dark mode with CSS variables

## Architecture

```text
Electron UI (Renderer — React)
  -> IPC (preload.cjs)
Electron Main
  -> ipcHandlers.js      (get-config, open-agent, inspect-agent, send-task, save-decisions, select-folder)
  -> playwrightManager.js
  -> toolBridge.js       (Hydra tool bridge)
  -> serverProcess.js    (starts Context Server)

Context Server (Express + SQLite + MCP)
  -> routes/projects, agents, tasks, sessions, settings, ai, context, todos
  -> db/schema.js + queries.js
  -> orchestrator/sessionRunner, executor, contextBuilder, safetyGuards
```

## Project structure

```text
agent-sync/
├── README.md
├── ARCHITECTURE.md
├── SETUP.md
├── ROADMAP.md
├── injectors/
│   ├── chatgpt.js
│   ├── claude.js
│   └── gemini.js
├── server/
│   ├── index.js
│   ├── mcp.js
│   ├── ai/
│   ├── db/
│   ├── orchestrator/
│   ├── prompts/
│   └── routes/
└── src/
    ├── main/
    │   ├── index.js
    │   ├── ipcHandlers.js      ← select-folder dialog added
    │   ├── playwrightManager.js
    │   ├── toolBridge.js
    │   ├── windowManager.js
    │   └── ...
    ├── preload/
    │   └── preload.cjs         ← selectFolder exposed
    └── renderer/
        ├── App.jsx              ← 3-column layout
        ├── styles.css           ← full dark mode
        └── components/
            ├── ProjectPanel.jsx ← New Project modal + folder picker
            ├── BrowserSessions.jsx ← compact sidebar with status
            ├── AgentSidebar.jsx
            ├── TaskBroadcast.jsx
            ├── ResponseCollector.jsx
            └── OrchestratorPanel.jsx
```

## Quick Start

```bash
npm install
npm run db:init
npm run dev
```

Production build:

```bash
npm run build:renderer
npm run start
```

## Workflow

1. Press **New project** → fill in name, description, select root folder from Windows, choose mode.
2. Add agents from the left rail.
3. In the right sidebar press **Open browser** per agent and log in manually.
4. Send tasks from TaskBroadcast — agents appear with status `working` and the current task visible.
5. Responses appear in ResponseCollector; save them to the knowledge base.

## Documentation

| File | Role |
|---|---|
| [SETUP.md](./SETUP.md) | Installation and configuration |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | General technical architecture |
| [ROADMAP.md](./ROADMAP.md) | MVP and next steps |
| [APP-ERRORS.md](./APP-ERRORS.md) | Centralized error log (auto-generated) |

## Monitoring & Task Workflow

### Task Workflow (Retry & Templates)
- **Retry**: If a task fails, you can press the **Retry** button directly in the Orchestrator chat to resubmit the request.
- **Templates**: Use the **Templates** button in the Orchestrator info panel to load predefined prompts (e.g. Project Audit).
- **Cleanup on startup**: The app automatically cleans up "stuck" tasks (those left in the working state after a crash) and resets agents.

### Error Monitoring
To monitor application health and collect errors in one place:
```bash
npm run monitor:errors
```
This script will generate or update the `APP-ERRORS.md` file with all recent errors from session logs.
