# AgentSync — Multi-AI Agent Orchestrator

Aplicatie desktop care coordoneaza mai multi agenti AI (ChatGPT, Gemini, Claude) prin sesiuni reale de browser controlate prin CDP (Chrome DevTools Protocol) cu Playwright, context partajat si task management local.

## Ce face

- Lanseaza browsere reale (Chrome / Edge) per agent via CDP
- Injecteaza prompt-uri si colecteaza raspunsuri automat (bypass Cloudflare)
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
| [SETUP.md](./SETUP.md) | Instalare si configurare |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Arhitectura tehnica generala |
| [ROADMAP.md](./ROADMAP.md) | MVP si pasi urmatori |
| [APP-ERRORS.md](./APP-ERRORS.md) | Log centralizat de erori (generat automat) |

## Monitoring & Task Workflow

### Task Workflow (Retry & Templates)
- **Retry**: Dacă un task eșuează, poți apăsa butonul **Retry** direct în chat-ul Orchestratorului pentru a retrimite solicitarea.
- **Templates**: Folosește butonul **Templates** din panoul de info al Orchestratorului pentru a încărca prompt-uri predefinite (ex: Project Audit).
- **Cleanup la pornire**: Aplicația curăță automat task-urile "blocate" (care au rămas în starea working după un crash) și resetează agenții.

### Monitorizarea Erorilor
Pentru a monitoriza sănătatea aplicației și a colecta erorile într-un singur loc:
```bash
npm run monitor:errors
```
Acest script va genera sau actualiza fișierul `APP-ERRORS.md` cu toate erorile recente din log-urile sesiunilor.
