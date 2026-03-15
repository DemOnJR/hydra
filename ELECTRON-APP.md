# Aplicatia Electron — AgentSync

Electron nu gazduieste paginile AI in `webview`. Rolul lui este:
- sa afiseze UI-ul local (React, dark mode)
- sa porneasca Context Server-ul
- sa orchestreze Playwright prin IPC
- sa expuna dialog-uri native Windows (folder picker)

## Main process

`src/main/index.js`

Responsabilitati:
- `startContextServer()`
- `createMainWindow()`
- `registerIpcHandlers()`
- shutdown ordonat pentru Playwright si server

## Window manager

`src/main/windowManager.js`

Fereastra principala:
- incarca renderer-ul React
- nu activeaza `webviewTag`
- ocupa work area-ul monitorului pana la 1920x1080

## IPC handlers

`src/main/ipcHandlers.js`

Canale inregistrate:

| Canal | Descriere |
|---|---|
| `agent-sync:get-config` | Returneaza serverUrl |
| `agent-sync:select-folder` | Deschide Windows folder picker nativ (`dialog.showOpenDialog`) |
| `agent-sync:open-agent` | Lanseaza browser Playwright pentru agent |
| `agent-sync:inspect-agent` | Verifica starea sesiunii |
| `agent-sync:send-task-to-agent` | Trimite task, ruleaza tool bridge, returneaza raspuns |
| `agent-sync:save-decisions` | Salveaza decizii in knowledge base |

Flux:

```text
Renderer
  -> IPC (preload)
Main process
  -> Playwright manager
  -> Context Server client
  -> dialog (folder picker)
```

### Tool bridge

`continueWithToolBridge()` ruleaza in bucla dupa fiecare raspuns al agentului:
1. Asteapta raspunsul din browser
2. Parseaza un eventual tool request (`hydra` block)
3. Cere aprobare (manual / semi-auto / full-auto)
4. Executa actiunea si injecteaza rezultatul
5. Se opreste cand nu mai exista tool request sau cand acelasi request se repeta de prea multe ori

## Preload

`src/preload/preload.cjs`

Expune API-ul sigur catre renderer prin `contextBridge`:

| Metoda | IPC canal |
|---|---|
| `getConfig()` | `agent-sync:get-config` |
| `selectFolder()` | `agent-sync:select-folder` |
| `openAgent(id, platform)` | `agent-sync:open-agent` |
| `inspectAgent(id, platform)` | `agent-sync:inspect-agent` |
| `sendTaskToAgent(agent, projectId, task)` | `agent-sync:send-task-to-agent` |
| `saveDecisions(projectId, decisions)` | `agent-sync:save-decisions` |

## Playwright manager

`src/main/playwrightManager.js`

Responsabilitati:
- gaseste browserul sistemului (Chrome / Edge / Chromium)
- lanseaza Playwright in mod vizibil
- creeaza contexte izolate per agent cu `storageState` persistent
- injecteaza prompt prin injector specific platformei
- asteapta si returneaza raspunsul

## Renderer — layout 3 coloane

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

### Componente principale

**`ProjectPanel.jsx`**
- Buton `New project` deschide un modal
- Modal contine: name, description, root folder (folder picker nativ Windows), mode
- La editarea proiectului activ: inline form cu acelasi folder picker

**`BrowserSessions.jsx`**
- Afisata in sidebar-ul din dreapta ca `<aside class="right-sidebar">`
- Fiecare agent: avatar cu initiale, status dot animat, task curent vizibil
- Status dot: `idle` (gri) / `working` (portocaliu, pulsating) / `done` (verde) / `error` (rosu)
- Butoane compacte: Open browser, Check session

**`AgentSidebar.jsx`** — left rail, lista agenti cu rol si queue count

**`TaskBroadcast.jsx`** — trimitere task catre orchestrator sau direct catre workeri

**`ResponseCollector.jsx`** — colecteaza si permite salvarea raspunsurilor in knowledge base

### Stilizare

`src/renderer/styles.css` — dark mode complet cu CSS variables:
- `--bg-base / --bg-surface / --bg-elevated / --bg-hover`
- `--accent` (#4f8ef7) pentru elemente active
- `--border` subtle rgba
- Modal overlay cu `backdrop-filter: blur`
- Animatie pulse pentru status `working`
