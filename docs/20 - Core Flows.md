# 20 - Core Flows

## Add an agent

1. User creates agent in UI.
2. Agent is persisted through server API and SQLite.
3. User opens browser session for the agent.
4. Login/session state is persisted in that agent's profile.

Touchpoints:

- `src/renderer/components/AgentSidebar.jsx`
- `src/main/ipcHandlers.js`
- `src/main/playwrightManager.js`
- `server/routes/agents.js`
- `server/db/queries.js`

## Broadcast a task

1. User sends task from TaskBroadcast UI.
2. Main process builds full prompt and context.
3. Playwright injects prompt into target platform tab.
4. Response is captured, persisted, and rendered.

Touchpoints:

- `src/renderer/components/TaskBroadcast.jsx`
- `src/main/ipcHandlers.js`
- `src/main/promptBuilder.js`
- `injectors/*.js`
- `server/routes/tasks.js`

## Save response to knowledge/context

1. User chooses save action.
2. Request goes to Context Server.
3. Decision is written to DB and reused by later prompts.

Touchpoints:

- `src/renderer/components/ResponseCollector.jsx`
- `server/routes/context.js`
- `server/db/queries.js`

## Related notes

- [[02 - Where To Look]]
- [[10 - Electron Main Process]]
- [[11 - Renderer UI]]
- [[12 - Context Server]]
