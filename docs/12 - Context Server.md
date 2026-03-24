# 12 - Context Server

The local server is an Express process started by Electron main.

## Responsibilities

- REST endpoints for projects/agents/tasks/settings/context
- DB access and persistence via SQLite
- MCP endpoint for external coding agents
- orchestrator and AI provider routing

## Primary files

- `server/index.js` - Express bootstrap and route mounting
- `server/mcp.js` - Model Context Protocol endpoint
- `server/routes/*.js` - REST API handlers
- `server/db/queries.js` - core query implementation
- `server/orchestrator/sessionRunner.js` - orchestrator loop
- `server/ai/caller.js` - AI provider dispatch

## Good starting points by task

- New route or API fix: `server/routes/*.js` + `server/index.js`
- Data correctness bug: `server/db/queries.js` + `server/db/schema.js`
- Orchestrator behavior: `server/orchestrator/*.js`
- Model routing or key handling: `server/ai/*.js`

## Related notes

- [[14 - Data and Storage]]
- [[20 - Core Flows]]
- [[30 - Key Entry Points]]
