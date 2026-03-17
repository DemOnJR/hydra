# Hydra Codebase Guide

This file documents the project structure for both human developers and AI agents.
It distinguishes between **production code** (files the app actually runs) and **AI navigation wrappers** (thin re-export files that exist purely to give AI agents focused, small files to read).

---

## Legend

| Symbol | Meaning |
|---|---|
| 🟢 **PRODUCTION** | App uses this file directly at runtime |
| 🔵 **AI WRAPPER** | Thin re-export — for AI navigation only, not imported by the app |
| 🟡 **SHARED** | Used by both app and AI agents |

---

## Root

| File | Type | Purpose |
|---|---|---|
| `package.json` | 🟢 | Dependencies, scripts, app metadata |
| `vite.config.js` | 🟢 | Vite renderer build config |
| `tailwind.config.js` | 🟢 | Tailwind CSS config |
| `index.html` | 🟢 | Electron renderer entry HTML |
| `start-app.bat` | 🟢 | Windows dev launch script |
| `README.md` | 🟡 | Project overview and quick start |
| `ARCHITECTURE.md` | 🟡 | Technical architecture reference |
| `SETUP.md` | 🟡 | Installation and setup guide |
| `ROADMAP.md` | 🟡 | Feature roadmap |
| `CODEBASE.md` | 🟡 | **This file** — codebase map for humans and AI |
| `APP-ERRORS.md` | 🟡 | Auto-generated error log |

---

## `injectors/` — Browser Injection Adapters

Playwright scripts injected into AI platform browsers.

| File | Type | Purpose |
|---|---|---|
| `injectors/claude.js` | 🟢 | Claude.ai inject + waitForResponse |
| `injectors/chatgpt.js` | 🟢 | ChatGPT inject + waitForResponse |
| `injectors/gemini.js` | 🟢 | Gemini inject + waitForResponse |
| `injectors/registry.js` | 🟢 | Provider registration map |
| `injectors/index.js` | 🟢 | Barrel export for all injectors |

---

## `src/main/` — Electron Main Process

Runs in Node.js. Controls browser windows, IPC, and task execution.

### Production files

| File | Type | Purpose |
|---|---|---|
| `src/main/index.js` | 🟢 | Electron entry point, app lifecycle |
| `src/main/ipcHandlers.js` | 🟢 | **Core** — all IPC handlers + full task execution engine (1,300 lines) |
| `src/main/toolBridge.js` | 🟢 | **Core** — all Hydra tool implementations (1,654 lines) |
| `src/main/playwrightManager.js` | 🟢 | Browser session management via Playwright |
| `src/main/geminiBridgeManager.js` | 🟢 | Gemini-specific browser bridge |
| `src/main/promptBuilder.js` | 🟢 | Builds full prompt strings for agents |
| `src/main/serverClient.js` | 🟢 | HTTP client to the local Context Server |
| `src/main/serverProcess.js` | 🟢 | Spawns and manages the Express server |
| `src/main/windowManager.js` | 🟢 | Creates and manages Electron windows |
| `src/main/platformUrls.js` | 🟢 | Maps platform names to URLs |
| `src/main/chromeFinder.js` | 🟢 | Finds Chrome/Edge/Chromium on the system |
| `src/main/projectWorkspace.js` | 🟢 | Git detection, agent journals |
| `src/main/toolRegistry.js` | 🟢 | Tool registration metadata |
| `src/main/plugins/fs.js` | 🟢 | File system plugin |

### AI navigation wrappers (do not import these in app code)

These files re-export from `ipcHandlers.js` or `toolBridge.js`. They exist so AI agents can read focused 5-line files instead of 1,300+ line files.

| File | Type | Re-exports from | What it covers |
|---|---|---|---|
| `src/main/ipc/index.js` | 🔵 | `ipcHandlers.js` | All IPC exports |
| `src/main/ipc/agentTasks.js` | 🔵 | `ipcHandlers.js` | `runAgentTask` |
| `src/main/ipc/register.js` | 🔵 | `ipcHandlers.js` | `registerIpcHandlers` |
| `src/main/ipc/taskEvents.js` | 🔵 | `ipcHandlers.js` | `emitTaskEvent`, change tracking |
| `src/main/tools/index.js` | 🔵 | `toolBridge.js` | All tool exports |
| `src/main/tools/fileOps.js` | 🔵 | `toolBridge.js` | `readFile`, `writeFile`, `replaceText`, etc. |
| `src/main/tools/searchOps.js` | 🔵 | `toolBridge.js` | `listFiles`, `searchFiles` |
| `src/main/tools/commandOps.js` | 🔵 | `toolBridge.js` | `runCommand`, `validateCommand` |
| `src/main/tools/patchOps.js` | 🔵 | `toolBridge.js` | `applyPatch` |
| `src/main/tools/parseRequest.js` | 🔵 | `toolBridge.js` | `parseToolRequest` |
| `src/main/tools/formatResult.js` | 🔵 | `toolBridge.js` | `formatToolResultPrompt`, etc. |
| `src/main/tools/executeRequest.js` | 🔵 | `toolBridge.js` | `executeToolRequest` |
| `src/main/tools/approval.js` | 🔵 | `toolBridge.js` | `requestToolApproval` |

---

## `src/renderer/` — React UI (Electron Renderer)

Runs in a Chromium context. All UI components.

| File | Type | Purpose |
|---|---|---|
| `src/renderer/main.jsx` | 🟢 | React entry point |
| `src/renderer/App.jsx` | 🟢 | Root component, 3-column layout |
| `src/renderer/api.js` | 🟢 | HTTP request helper to Context Server |
| `src/renderer/styles.css` | 🟢 | Global CSS + Tailwind base |
| `src/renderer/interactiveReply.js` | 🟢 | Parses interactive reply blocks from AI responses |
| `src/renderer/components/TaskBroadcast.jsx` | 🟢 | Main chat UI — send tasks, view responses |
| `src/renderer/components/AgentSidebar.jsx` | 🟢 | Agent management panel |
| `src/renderer/components/BrowserSessions.jsx` | 🟢 | Right sidebar — agent status |
| `src/renderer/components/ProjectPanel.jsx` | 🟢 | Left sidebar — project list |
| `src/renderer/components/ProjectSettings.jsx` | 🟢 | Project settings form |
| `src/renderer/components/ProjectHistoryPanel.jsx` | 🟢 | Memory/history panel |
| `src/renderer/components/OrchestratorPanel.jsx` | 🟢 | Legacy orchestrator session panel |
| `src/renderer/components/HydraSprite.jsx` | 🟢 | Animated agent avatar |
| `src/renderer/components/ResponseCollector.jsx` | 🟢 | Save responses to knowledge base |
| `src/renderer/components/Tooltip.jsx` | 🟢 | Tooltip component |
| `src/renderer/hooks/useAgents.js` | 🟢 | Agent state hook |
| `src/renderer/hooks/useProjects.js` | 🟢 | Project state hook |
| `src/renderer/hooks/useProjectTasks.js` | 🟢 | Task polling hook |
| `src/renderer/hooks/useProjectHistory.js` | 🟢 | Project memory hook |

---

## `src/preload/` — Electron Preload

| File | Type | Purpose |
|---|---|---|
| `src/preload/preload.cjs` | 🟢 | Exposes `window.agentSync` IPC bridge to renderer |

---

## `server/` — Local Context Server (Express + SQLite)

Runs as a child process. Provides REST API + MCP.

### Core server files

| File | Type | Purpose |
|---|---|---|
| `server/index.js` | 🟢 | Express server entry point |
| `server/mcp.js` | 🟢 | MCP (Model Context Protocol) endpoint |
| `server/browserBridgeStore.js` | 🟢 | Browser bridge state store |

### `server/db/` — Database Layer

| File | Type | Purpose |
|---|---|---|
| `server/db/schema.js` | 🟢 | SQLite schema creation and migrations |
| `server/db/init.js` | 🟢 | DB initialization entry point |
| `server/db/queries.js` | 🟢 | **Core** — all DB queries (1,031 lines) |
| `server/db/utils.js` | 🔵 | Normalizer helpers + constants (AI navigation) |
| `server/db/index.js` | 🔵 | Barrel re-export of all domain query files |
| `server/db/projectQueries.js` | 🔵 | Project + context queries (AI navigation) |
| `server/db/agentQueries.js` | 🔵 | Agent CRUD queries (AI navigation) |
| `server/db/taskQueries.js` | 🔵 | Task queries (AI navigation) |
| `server/db/todoQueries.js` | 🔵 | Todo queries (AI navigation) |
| `server/db/sessionQueries.js` | 🔵 | Orchestrator session queries (AI navigation) |
| `server/db/contextQueries.js` | 🔵 | Decisions + search queries (AI navigation) |
| `server/db/conversationQueries.js` | 🔵 | Conversation turn queries (AI navigation) |
| `server/db/compactionQueries.js` | 🔵 | Memory compaction queries (AI navigation) |
| `server/db/settingsQueries.js` | 🔵 | AI + app settings queries (AI navigation) |

### `server/routes/` — REST API Routes

| File | Type | Purpose |
|---|---|---|
| `server/routes/agents.js` | 🟢 | `GET/POST/PATCH/DELETE /api/agents` |
| `server/routes/projects.js` | 🟢 | `GET/POST/PATCH/DELETE /api/projects` |
| `server/routes/tasks.js` | 🟢 | `GET /api/tasks` |
| `server/routes/sessions.js` | 🟢 | `GET/POST /api/sessions` |
| `server/routes/settings.js` | 🟢 | `GET/PUT /api/settings` |
| `server/routes/ai.js` | 🟢 | `POST /api/ai/call` |
| `server/routes/context.js` | 🟢 | `GET/PUT /api/context` |
| `server/routes/todos.js` | 🟢 | `GET/POST/PATCH/DELETE /api/todos` |
| `server/routes/tasks.js` | 🟢 | Task routes |
| `server/routes/browserBridge.js` | 🟢 | Browser bridge routes |

### `server/orchestrator/` — Legacy Orchestrator

| File | Type | Purpose |
|---|---|---|
| `server/orchestrator/sessionRunner.js` | 🟢 | Runs AI-driven orchestrator sessions (480 lines) |
| `server/orchestrator/executor.js` | 🟢 | Tool execution for orchestrator sessions |
| `server/orchestrator/contextBuilder.js` | 🟢 | Builds context payload for orchestrator |
| `server/orchestrator/safetyGuards.js` | 🟢 | Safety checks for destructive operations |

### `server/ai/` — AI Provider Callers

| File | Type | Purpose |
|---|---|---|
| `server/ai/caller.js` | 🟢 | Routes AI calls to OpenAI/Anthropic/Ollama/Local |
| `server/ai/modelConfig.js` | 🟢 | Model name mapping and settings |
| `server/ai/keyManager.js` | 🟢 | API key management via OS keychain |
| `server/ai/localRunner.js` | 🟢 | Local ONNX model runner |
| `server/ai/localWorker.js` | 🟢 | Worker thread for local inference |
| `server/ai/pricing.js` | 🟢 | Token cost estimation |

### `server/prompts/`

| File | Type | Purpose |
|---|---|---|
| `server/prompts/orchestrator.js` | 🟢 | Builds orchestrator system prompt |

---

## How to add a new feature

1. **Add production code** to the relevant `🟢` file
2. **If the file grows beyond ~300 lines**, consider extracting to a new production file
3. **Update the AI wrapper** in the matching `🔵` file to re-export the new function
4. **Update this file** (`CODEBASE.md`) to document the new function/file

## Rule of thumb for AI agents

- To understand **what a module does** → read the `🔵` wrapper (5-15 lines)
- To **edit the actual logic** → read and edit the `🟢` production file
- To find **where a function is defined** → search in production files, not wrappers
