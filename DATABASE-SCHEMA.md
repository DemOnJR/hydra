# Database Schema - AgentSync

SQLite local pentru proiecte, context, agenti si task-uri.

## Observatie despre migrare

Schema agentilor pastreaza coloana `partition` doar pentru compatibilitate cu baza locala mai veche.

Implementarea curenta foloseste:
- `session_dir` pentru sesiunea Playwright de pe disk
- nu mai foloseste `partition` pentru runtime

## Tabele

### projects

| Coloana | Tip | Rol |
|---|---|---|
| id | TEXT PK | id proiect |
| name | TEXT | nume |
| description | TEXT | descriere |
| is_active | INTEGER | proiect activ |
| created_at | TEXT | creare |
| updated_at | TEXT | update |

### project_context

| Coloana | Tip |
|---|---|
| project_id | TEXT PK/FK |
| architecture | TEXT |
| tech_stack | TEXT |
| conventions | TEXT |
| updated_at | TEXT |

### decisions

| Coloana | Tip |
|---|---|
| id | TEXT PK |
| project_id | TEXT FK |
| title | TEXT |
| content | TEXT |
| category | TEXT |
| created_at | TEXT |

### agents

| Coloana | Tip | Rol |
|---|---|---|
| id | TEXT PK | id agent |
| name | TEXT | nume agent |
| platform | TEXT | chatgpt / gemini / claude |
| partition | TEXT | legacy compatibility only |
| session_dir | TEXT | director sesiune Playwright |
| status | TEXT | idle / working / done / error |
| created_at | TEXT | creare |

### tasks

| Coloana | Tip |
|---|---|
| id | TEXT PK |
| project_id | TEXT FK |
| agent_id | TEXT FK |
| prompt | TEXT |
| user_task | TEXT |
| response | TEXT |
| status | TEXT |
| created_at | TEXT |
| completed_at | TEXT |

## Persistenta sesiunilor browser

Storage state-ul Playwright nu este salvat in DB.

Este salvat pe disk in:

```text
~/.agent-sync/sessions/agent-<agentId>/storage.json
```

## Query helpers importante

`server/db/queries.js`

- `createProject`
- `setActiveProject`
- `getProjectContext`
- `saveDecision`
- `createAgent`
- `updateAgentStatus`
- `createTask`
- `completeTask`

