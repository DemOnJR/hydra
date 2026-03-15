# Context Server & MCP — AgentSync

Serverul local care stochează knowledge base-ul proiectelor și expune un MCP endpoint pentru CLI agents (Claude Code, Codex, Cursor).

Rulează la `http://localhost:3847` și pornește automat odată cu aplicația Electron.

---

## Pornire server — `server/index.js`

```javascript
const express = require('express')
const cors = require('cors')
const { initDb } = require('./db/schema')
const { createMcpServer } = require('./mcp')
const projectsRouter = require('./routes/projects')
const contextRouter = require('./routes/context')
const sessionsRouter = require('./routes/sessions')

const PORT = process.env.CONTEXT_SERVER_PORT || 3847

async function startServer() {
  const app = express()

  app.use(cors({ origin: ['http://localhost:5173', 'app://'] }))
  app.use(express.json())

  // Inițializează DB
  initDb()

  // REST routes
  app.use('/api/projects', projectsRouter)
  app.use('/api/context', contextRouter)
  app.use('/api/sessions', sessionsRouter)

  // MCP endpoint — pentru CLI agents
  const mcpServer = createMcpServer()
  app.use('/mcp', mcpServer.requestHandler)

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[Context Server] Rulează la http://localhost:${PORT}`)
    console.log(`[Context Server] MCP endpoint: http://localhost:${PORT}/mcp`)
  })
}

startServer()
```

---

## MCP Server — `server/mcp.js`

MCP (Model Context Protocol) permite CLI agents (Claude Code, Codex, Cursor) să citească și să scrie context direct din terminal.

```javascript
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { z } = require('zod')
const db = require('./db/queries')

function createMcpServer() {
  const server = new McpServer({
    name: 'agent-sync',
    version: '1.0.0',
  })

  // ─── TOOL: get_project_context ───────────────────────────
  // Citește knowledge base-ul unui proiect
  server.tool(
    'get_project_context',
    'Obține contextul complet al unui proiect: arhitectura, deciziile luate, fișierele importante',
    {
      project_id: z.string().optional().describe('ID-ul proiectului. Dacă lipsește, returnează proiectul activ.'),
    },
    async ({ project_id }) => {
      const project = project_id
        ? db.getProjectById(project_id)
        : db.getActiveProject()

      if (!project) {
        return { content: [{ type: 'text', text: 'Nu există proiect activ. Creează unul în aplicația AgentSync.' }] }
      }

      const context = db.getProjectContext(project.id)
      const recentDecisions = db.getRecentDecisions(project.id, 10)

      const text = formatContextForAgent(project, context, recentDecisions)

      return { content: [{ type: 'text', text }] }
    }
  )

  // ─── TOOL: save_decisions ────────────────────────────────
  // Salvează decizii/cunoștințe noi în knowledge base
  server.tool(
    'save_decisions',
    'Salvează decizii arhitecturale sau cunoștințe despre proiect în knowledge base',
    {
      project_id: z.string().optional(),
      decisions: z.array(z.object({
        title: z.string().describe('Titlu scurt al deciziei'),
        content: z.string().describe('Descriere detaliată'),
        category: z.enum(['architecture', 'convention', 'bug-fix', 'dependency', 'other'])
          .default('other'),
      })),
    },
    async ({ project_id, decisions }) => {
      const project = project_id
        ? db.getProjectById(project_id)
        : db.getActiveProject()

      if (!project) {
        return { content: [{ type: 'text', text: 'Eroare: Nu există proiect activ.' }] }
      }

      const saved = decisions.map(d => db.saveDecision(project.id, d))

      return {
        content: [{
          type: 'text',
          text: `✓ Salvate ${saved.length} decizii în proiectul "${project.name}"`
        }]
      }
    }
  )

  // ─── TOOL: list_projects ─────────────────────────────────
  server.tool(
    'list_projects',
    'Listează toate proiectele disponibile',
    {},
    async () => {
      const projects = db.getAllProjects()
      const text = projects.map(p =>
        `- ${p.name} (id: ${p.id})${p.is_active ? ' [ACTIV]' : ''}`
      ).join('\n')

      return { content: [{ type: 'text', text: text || 'Nu există proiecte.' }] }
    }
  )

  // ─── TOOL: set_active_project ────────────────────────────
  server.tool(
    'set_active_project',
    'Setează proiectul activ (cel folosit implicit de get_project_context)',
    {
      project_id: z.string(),
    },
    async ({ project_id }) => {
      db.setActiveProject(project_id)
      const project = db.getProjectById(project_id)
      return {
        content: [{ type: 'text', text: `✓ Proiect activ setat: "${project.name}"` }]
      }
    }
  )

  // ─── TOOL: search_context ────────────────────────────────
  server.tool(
    'search_context',
    'Caută în knowledge base-ul proiectului după un termen',
    {
      query: z.string().describe('Termenul de căutat'),
      project_id: z.string().optional(),
    },
    async ({ query, project_id }) => {
      const pid = project_id || db.getActiveProject()?.id
      if (!pid) return { content: [{ type: 'text', text: 'Nu există proiect activ.' }] }

      const results = db.searchContext(pid, query)
      if (results.length === 0) {
        return { content: [{ type: 'text', text: `Nu s-au găsit rezultate pentru "${query}"` }] }
      }

      const text = results.map(r =>
        `### ${r.title}\n${r.content}\n_(${r.category}, ${r.created_at})_`
      ).join('\n\n')

      return { content: [{ type: 'text', text }] }
    }
  )

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  server.connect(transport)

  return transport
}

// Formatare context pentru agent
function formatContextForAgent(project, context, recentDecisions) {
  let text = `# Proiect: ${project.name}\n\n`

  if (project.description) {
    text += `## Descriere\n${project.description}\n\n`
  }

  if (context.architecture) {
    text += `## Arhitectură\n${context.architecture}\n\n`
  }

  if (context.tech_stack) {
    text += `## Tech Stack\n${context.tech_stack}\n\n`
  }

  if (context.conventions) {
    text += `## Convenții și reguli\n${context.conventions}\n\n`
  }

  if (recentDecisions.length > 0) {
    text += `## Decizii recente\n`
    recentDecisions.forEach(d => {
      text += `- **${d.title}** (${d.category}): ${d.content}\n`
    })
  }

  return text
}

module.exports = { createMcpServer }
```

---

## REST API Routes

### Projects — `server/routes/projects.js`

```javascript
const router = require('express').Router()
const db = require('../db/queries')
const { v4: uuidv4 } = require('uuid')

// GET /api/projects — listează toate proiectele
router.get('/', (req, res) => {
  res.json(db.getAllProjects())
})

// POST /api/projects — creează proiect nou
router.post('/', (req, res) => {
  const { name, description } = req.body
  if (!name) return res.status(400).json({ error: 'Numele proiectului e obligatoriu' })

  const project = db.createProject({
    id: uuidv4(),
    name,
    description: description || '',
  })

  res.status(201).json(project)
})

// PUT /api/projects/:id/activate — setează proiect activ
router.put('/:id/activate', (req, res) => {
  db.setActiveProject(req.params.id)
  res.json({ success: true })
})

// DELETE /api/projects/:id
router.delete('/:id', (req, res) => {
  db.deleteProject(req.params.id)
  res.json({ success: true })
})

module.exports = router
```

### Context — `server/routes/context.js`

```javascript
const router = require('express').Router()
const db = require('../db/queries')

// GET /api/context/:projectId — obține contextul complet
router.get('/:projectId', (req, res) => {
  const context = db.getProjectContext(req.params.projectId)
  const decisions = db.getRecentDecisions(req.params.projectId, 50)
  res.json({ context, decisions })
})

// PUT /api/context/:projectId — actualizează câmpuri context
router.put('/:projectId', (req, res) => {
  const { architecture, tech_stack, conventions } = req.body
  db.updateProjectContext(req.params.projectId, { architecture, tech_stack, conventions })
  res.json({ success: true })
})

// POST /api/context/:projectId/decisions — adaugă decizie nouă
router.post('/:projectId/decisions', (req, res) => {
  const { title, content, category } = req.body
  const decision = db.saveDecision(req.params.projectId, { title, content, category })
  res.status(201).json(decision)
})

// DELETE /api/context/:projectId/decisions/:decisionId
router.delete('/:projectId/decisions/:decisionId', (req, res) => {
  db.deleteDecision(req.params.decisionId)
  res.json({ success: true })
})

module.exports = router
```

---

## MCP Tools — Referință rapidă

Acestea sunt tool-urile disponibile pentru CLI agents după conectare:

| Tool | Parametri | Descriere |
|------|-----------|-----------|
| `get_project_context` | `project_id?` | Returnează contextul complet al proiectului activ |
| `save_decisions` | `decisions[]`, `project_id?` | Salvează decizii noi în knowledge base |
| `list_projects` | — | Listează toate proiectele |
| `set_active_project` | `project_id` | Schimbă proiectul activ |
| `search_context` | `query`, `project_id?` | Caută în knowledge base |

### Exemplu utilizare în Claude Code

```
> Ce framework folosim în proiect?

[Claude apelează get_project_context]
[Server returnează: "Tech Stack: React 18, TypeScript, Tailwind..."]

Proiectul folosește React 18 cu TypeScript și Tailwind CSS...
```
