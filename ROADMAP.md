# Roadmap — Hydra

## Current MVP

- [x] Local Electron UI
- [x] Local Context Server with SQLite
- [x] MCP endpoint for CLI agents
- [x] Agents persisted in DB
- [x] Migration from `webview` to Playwright
- [x] Launch real browser for AI sessions
- [x] Broadcast tasks to agents
- [x] Collect responses in UI
- [x] Hydra tool bridge (read/write/run with approval)
- [x] Full dark mode UI redesign (CSS variables)
- [x] 3-column layout (left rail / workspace / right sidebar)
- [x] `New project` modal with native Windows folder picker
- [x] Compact Browser Sessions sidebar with animated status dot and current task
- [x] IPC `select-folder` via `dialog.showOpenDialog`

## Next steps

- [ ] More robust login detection per platform
- [ ] Retry / cancel for long-running tasks
- [ ] Per-task progress indicator in sidebar (percentage / steps)
- [ ] `Open all agents` button (launches all sessions at once)
- [ ] Desktop notifications when an agent finishes a task
- [ ] Browser session history per agent
- [ ] Export / import knowledge base
- [ ] Windows packaging (electron-builder)
- [ ] Auto-update
- [ ] Browser extension for easier integration

## Technical risks

| Risk | Level | Mitigation |
|---|---|---|
| Platform UI changes | high | Playwright adapters per platform in `injectors/*.js` |
| Browser not found on system | medium | `chromeFinder.js` with Chrome / Edge / Chromium fallback |
| Stricter Cloudflare or login checks | medium | Real browser, manual login, persistent sessions |
| Unstable injection selectors | high | Fast update cycle in `injectors/*.js` |
| Tool bridge infinite loop | medium | Repeated request detection + MAX_IDENTICAL_TOOL_REQUESTS limit |
