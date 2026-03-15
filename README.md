# AgentSync — Multi-AI Agent Orchestrator

Aplicatie desktop care coordoneaza mai multi agenti AI (ChatGPT, Gemini, Claude) prin sesiuni reale de browser controlate cu Playwright, context partajat si task management local.

## Ce face

- Lanseaza browsere reale (Chrome / Edge) per agent via Playwright
- Injecteaza prompt-uri si colecteaza raspunsuri automat
- Gestioneaza proiecte, knowledge base si task-uri local (SQLite)
- Expune un Context Server REST + MCP pentru agenti CLI
- UI Electron dark-mode cu layout 3 coloane

## UI — layout curent

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

**Functionalitati UI notabile:**
- Buton `New project` deschide un modal cu campuri name, description, root folder (Windows folder picker nativ), mode
- Browser Sessions apar in sidebar-ul din dreapta — fiecare agent are un status dot animat (idle / working / done / error) si task-ul curent vizibil
- Dark mode complet cu CSS variables

## Arhitectura

```text
Electron UI (Renderer — React)
  -> IPC (preload.cjs)
Electron Main
  -> ipcHandlers.js      (get-config, open-agent, inspect-agent, send-task, save-decisions, select-folder)
  -> playwrightManager.js
  -> toolBridge.js       (Hydra tool bridge)
  -> serverProcess.js    (porneste Context Server)

Context Server (Express + SQLite + MCP)
  -> routes/projects, agents, tasks, sessions, settings, ai, context, todos
  -> db/schema.js + queries.js
  -> orchestrator/sessionRunner, executor, contextBuilder, safetyGuards
```

## Structura proiectului

```text
agent-sync/
├── README.md
├── ARCHITECTURE.md
├── SETUP.md
├── PLAYWRIGHT-SETUP.md
├── CONTEXT-SERVER.md
├── ELECTRON-APP.md
├── CONTEXT-INJECTION.md
├── TASK-MANAGER.md
├── DATABASE-SCHEMA.md
├── ORCHESTRATOR.md
├── AI-CALLER.md
├── NOTIFICATIONS-APPROVAL.md
├── PIPELINE-CICD.md
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
    │   ├── ipcHandlers.js      ← select-folder dialog adăugat
    │   ├── playwrightManager.js
    │   ├── toolBridge.js
    │   ├── windowManager.js
    │   └── ...
    ├── preload/
    │   └── preload.cjs         ← selectFolder expus
    └── renderer/
        ├── App.jsx              ← layout 3 coloane
        ├── styles.css           ← dark mode complet
        └── components/
            ├── ProjectPanel.jsx ← modal New Project + folder picker
            ├── BrowserSessions.jsx ← sidebar compact cu status
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

Build productie:

```bash
npm run build:renderer
npm run start
```

## Flux de lucru

1. Apesi **New project** → completezi numele, descrierea, selectezi root folder din Windows, alegi modul.
2. Adaugi agenti din left rail.
3. In sidebar-ul din dreapta apesi **Open browser** per agent si faci login manual.
4. Trimiti task-uri din TaskBroadcast — agentii apar cu status `working` si task-ul curent vizibil.
5. Raspunsurile apar in ResponseCollector; le salvezi in knowledge base.

## Documentatie

| Fisier | Rol |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Arhitectura tehnica generala |
| [SETUP.md](./SETUP.md) | Instalare si configurare |
| [PLAYWRIGHT-SETUP.md](./PLAYWRIGHT-SETUP.md) | Migrare la Playwright |
| [CONTEXT-SERVER.md](./CONTEXT-SERVER.md) | REST API, SQLite, MCP |
| [ELECTRON-APP.md](./ELECTRON-APP.md) | Electron main/preload/renderer |
| [CONTEXT-INJECTION.md](./CONTEXT-INJECTION.md) | Injectie si colectare Playwright |
| [TASK-MANAGER.md](./TASK-MANAGER.md) | Broadcast, queue, response flow |
| [DATABASE-SCHEMA.md](./DATABASE-SCHEMA.md) | Structura bazei de date |
| [ORCHESTRATOR.md](./ORCHESTRATOR.md) | Orchestrator session runner |
| [AI-CALLER.md](./AI-CALLER.md) | AI caller si key manager |
| [NOTIFICATIONS-APPROVAL.md](./NOTIFICATIONS-APPROVAL.md) | Approval flow pentru tool requests |
| [ROADMAP.md](./ROADMAP.md) | MVP si pasi urmatori |
