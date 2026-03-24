# 14 - Data and Storage

Hydra stores state locally in SQLite.

## Data domains

- projects
- agents
- tasks
- context decisions / memory
- sessions and settings

## Primary files

- `server/db/schema.js` - schema and migrations
- `server/db/init.js` - DB initialization
- `server/db/queries.js` - core query logic

## Data flow

- UI action -> route in `server/routes/*.js`
- Route -> query in `server/db/queries.js`
- Query -> SQLite

## Related notes

- [[12 - Context Server]]
- [[20 - Core Flows]]
