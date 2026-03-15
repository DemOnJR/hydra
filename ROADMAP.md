# Roadmap — AgentSync

## MVP curent

- [x] Electron UI local
- [x] Context Server local cu SQLite
- [x] MCP endpoint pentru CLI agents
- [x] Agenti persistati in DB
- [x] Migrare de la `webview` la Playwright
- [x] Lansare browser real pentru sesiuni AI
- [x] Broadcast task-uri catre agenti
- [x] Colectare raspunsuri in UI
- [x] Tool bridge Hydra (read/write/run cu aprobare)
- [x] UI redesign dark mode complet (CSS variables)
- [x] Layout 3 coloane (left rail / workspace / right sidebar)
- [x] Modal `New project` cu folder picker nativ Windows
- [x] Browser Sessions sidebar compact cu status dot animat si task curent
- [x] IPC `select-folder` via `dialog.showOpenDialog`

## Urmatorii pasi

- [ ] Detectie login mai robusta per platforma
- [ ] Retry / cancel pentru task-uri lungi
- [ ] Indicator de progres per task in sidebar (procent / pasi)
- [ ] Buton `Open all agents` (lanseaza toate sesiunile dintr-o data)
- [ ] Notificari desktop cand un agent termina un task
- [ ] Istoric sesiuni browser per agent
- [ ] Export / import knowledge base
- [ ] Packaging Windows (electron-builder)
- [ ] Auto-update
- [ ] Browser extension pentru integrare mai usoara

## Riscuri tehnice

| Risc | Nivel | Mitigare |
|---|---|---|
| UI-ul platformelor se schimba | ridicat | adaptoare Playwright per platforma in `injectors/*.js` |
| Browserul nu este gasit pe sistem | mediu | `chromeFinder.js` cu fallback Chrome / Edge / Chromium |
| Cloudflare sau login checks mai stricte | mediu | browser real, login manual, sesiuni persistente |
| Selectori instabili la injectie | ridicat | actualizare rapida in `injectors/*.js` |
| Tool bridge bucla infinita | mediu | detectie request repetat + limita MAX_IDENTICAL_TOOL_REQUESTS |
