# 02 - Where To Look

Use this note when you know the task but not the file.

## If you need to...

### Change UI layout or component behavior

- Start: `src/renderer/App.jsx`
- Then: `src/renderer/components/`
- Context: [[11 - Renderer UI]]

### Change task sending, response parsing, or task polling

- Start: `src/renderer/components/TaskBroadcast.jsx`
- Then: `src/renderer/hooks/useProjectTasks.js`
- Main side execution: `src/main/ipcHandlers.js`
- Context: [[11 - Renderer UI]], [[10 - Electron Main Process]], [[20 - Core Flows]]

### Change IPC handlers or desktop behavior

- Start: `src/main/ipcHandlers.js`
- Window and lifecycle: `src/main/index.js`, `src/main/windowManager.js`
- Context: [[10 - Electron Main Process]]

### Change browser launch/session behavior

- Start: `src/main/playwrightManager.js`
- Browser detection/urls: `src/main/chromeFinder.js`, `src/main/platformUrls.js`
- Injectors: `injectors/*.js`
- Context: [[13 - Browser Automation]]

### Add or modify server API endpoints

- Start: `server/index.js`
- Route files: `server/routes/*.js`
- Database calls: `server/db/queries.js`
- Context: [[12 - Context Server]], [[14 - Data and Storage]]

### Change DB schema, queries, or persistence

- Start: `server/db/schema.js`, `server/db/init.js`, `server/db/queries.js`
- Context: [[14 - Data and Storage]]

### Change orchestrator session behavior

- Start: `server/orchestrator/sessionRunner.js`
- Supporting: `server/orchestrator/executor.js`, `server/orchestrator/contextBuilder.js`
- Prompt: `server/prompts/orchestrator.js`
- Context: [[12 - Context Server]], [[20 - Core Flows]]

### Change AI provider calls or model routing

- Start: `server/ai/caller.js`, `server/ai/modelConfig.js`
- Keys/pricing/local model: `server/ai/keyManager.js`, `server/ai/pricing.js`, `server/ai/localRunner.js`
- Context: [[12 - Context Server]]
