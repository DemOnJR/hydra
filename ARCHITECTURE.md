# Arhitectura Tehnica - AgentSync

## Stack tehnic

| Layer | Tehnologie | Motiv |
|---|---|---|
| Desktop app | Electron | UI local, IPC, integrare OS |
| Browser automation | Playwright + browser real | login compatibil, sesiuni persistente, control robust |
| Frontend UI | React + Vite | iteratie rapida si componentizare |
| Context Server | Node.js + Express | REST API + MCP local |
| Baza de date | SQLite + better-sqlite3 | local-first, simplu, rapid |
| MCP | @modelcontextprotocol/sdk | integrare cu Claude Code, Codex, Cursor |

## Componente principale

### 1. Electron main process

Responsabilitati:
- porneste Context Server-ul local
- creeaza fereastra principala
- expune IPC pentru renderer
- delega operatiile browserului catre Playwright

Fisiere cheie:

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

Responsabilitati:
- management proiecte
- management agenti
- control sesiuni browser
- broadcast task-uri
- vizualizare raspunsuri si salvare in KB

Fisiere cheie:

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
    `-- useTaskManager.js
```

### 3. Playwright manager

Modelul curent:
- un browser real lansat de Playwright
- contexte izolate per agent
- storage state salvat pe disk
- fiecare agent poate fi adus in fata si controlat automat

## Fluxuri

### Adaugare agent

```text
User creeaza agent
  -> agentul este salvat in SQLite
  -> AgentSync poate deschide sesiunea lui in browser real
  -> user face login manual
  -> Playwright salveaza storage state pe disk
```

### Broadcast task

```text
User scrie task in UI
  -> Context Server returneaza knowledge base-ul proiectului
  -> main process construieste promptul complet
  -> Playwright injecteaza promptul in browserul agentului
  -> Playwright asteapta finalul raspunsului
  -> raspunsul este salvat in DB si afisat in Electron
```

### Salvare in knowledge base

```text
ResponseCollector afiseaza raspunsul
  -> user alege "Save to KB"
  -> Context Server salveaza decizia in SQLite
  -> task-urile viitoare folosesc contextul actualizat
```

## De ce Playwright si nu webview

- browserul real trece mai bine de challenge-uri de login
- selectorii si actiunile sunt mai robuste decat `executeJavaScript` raw
- sesiunile pot fi persistate fara sa randam paginile in Electron
- Electron ramane usor: control plane, nu browser host

## Trade-off-uri

- ferestrele browserului sunt separate de fereastra Electron
- login-ul initial este manual
- adaptarile pe selectorii platformelor tot trebuie mentinute cand UI-ul se schimba

## Securitate

- comunicarea intre UI si server ramane pe localhost
- datele stau local
- sesiunile browser sunt separate per agent
- Electron nu mai embedeaza site-uri third-party in UI

