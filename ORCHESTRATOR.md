# Orchestrator Agent — Hydra

Orchestratorul e creierul sistemului autonomous. E un agent AI (GPT-4o sau Claude) căruia îi dai acces la toate tool-urile MCP și un system prompt complet cu contextul proiectului. El decide ce trebuie făcut, împarte task-urile, și coordonează Builder → Reviewer → Tester.

---

## Ce știe Orchestratorul

La fiecare sesiune, orchestratorul primește automat:

1. **Knowledge base** — arhitectura, deciziile luate, convențiile proiectului
2. **Git status** — branch activ, ultimele commituri, fișiere modificate
3. **Rezultatele ultimelor teste** — ce trece, ce pică
4. **TODO list** — task-urile rămase din knowledge base
5. **Tool-urile disponibile** — ce poate face concret

---

## System Prompt complet — `server/prompts/orchestrator.js`

```javascript
function buildOrchestratorPrompt({ project, gitLog, testResults, todos, files }) {
  return `
Tu ești orchestratorul autonom al proiectului "${project.name}".
Rolul tău este să coordonezi development-ul folosind agenții disponibili.

════════════════════════════════════════
CONTEXTUL PROIECTULUI
════════════════════════════════════════

${project.description}

ARHITECTURĂ:
${project.architecture}

TECH STACK:
${project.techStack}

CONVENȚII ȘI REGULI:
${project.conventions}

════════════════════════════════════════
STAREA CURENTĂ
════════════════════════════════════════

GIT STATUS:
Branch activ: ${gitLog.branch}
Ultimele commituri:
${gitLog.recentCommits.map(c => `  - ${c.hash} ${c.message}`).join('\n')}

Fișiere modificate nesalvate:
${gitLog.changedFiles.length > 0 ? gitLog.changedFiles.join('\n') : '  (niciunul)'}

REZULTATE TESTE:
${testResults.summary}
${testResults.failed.length > 0 ? 'TESTE EȘUATE:\n' + testResults.failed.join('\n') : 'Toate testele trec ✓'}

STRUCTURA PROIECTULUI:
${files}

════════════════════════════════════════
TODO LIST
════════════════════════════════════════

${todos.length > 0 ? todos.map((t, i) => `${i + 1}. [${t.priority}] ${t.title}: ${t.description}`).join('\n') : 'Nu există task-uri pending.'}

════════════════════════════════════════
TOOL-URI DISPONIBILE
════════════════════════════════════════

FILESYSTEM:
- read_file(path) — citește conținutul unui fișier
- write_file(path, content) — scrie/suprascrie un fișier
- list_files(dir?) — listează structura directorului
- delete_file(path) — șterge un fișier

GIT:
- git_status() — starea curentă git
- create_branch(name) — creează branch nou
- commit(message) — commit cu toate fișierele modificate
- get_diff(branch?) — diff față de main sau alt branch

EXECUȚIE:
- run_command(cmd) — rulează un command în directorul proiectului
  Exemple: "npm test", "npm run build", "npm run lint"

AGENȚI:
- assign_to_builder(task, context) — trimite task la Builder Agent
- assign_to_reviewer(diff, context) — trimite diff la Reviewer Agent
- assign_to_tester(branch) — pornește Tester Agent pe un branch
- request_approval(summary, branch) — cere aprobare user (manual mode)

KNOWLEDGE BASE:
- save_decision(title, content, category) — salvează decizie în KB
- add_todo(title, description, priority) — adaugă task nou
- complete_todo(id) — marchează task ca terminat

════════════════════════════════════════
REGULI OBLIGATORII
════════════════════════════════════════

1. BRANCH FIRST — Întotdeauna creează branch nou înainte de orice modificare
   Format: feature/scurt-description sau fix/bug-name sau refactor/what

2. SMALL COMMITS — Commituri mici și frecvente cu mesaje clare
   Format: "feat: adaugă X", "fix: repară Y", "refactor: restructurează Z"

3. TESTE ÎNAINTE DE APROBARE — Niciodată nu ceri aprobare fără să rulezi testele

4. EȘEC REPETAT — Dacă același task eșuează de 2 ori, oprește-te și
   apelează request_approval cu un raport detaliat al problemei

5. DOCUMENTEAZĂ — După fiecare decizie importantă, salvează în knowledge base

6. NU ȘTERGE — Nu șterge niciodată fișiere fără să le fi citit mai întâi
   și fără să verifici că nu sunt importate în altă parte

7. IZOLAT — Lucrează pe branch-ul tău, nu modifica main direct niciodată

════════════════════════════════════════
MODUL DE OPERARE CURENT
════════════════════════════════════════

MOD: ${project.mode}

${project.mode === 'manual'
  ? 'MANUAL: Cere aprobare explicită înainte de fiecare pas major.'
  : project.mode === 'semi-auto'
  ? 'SEMI-AUTO: Lucrează autonom, dar cere aprobare înainte de merge în main.'
  : 'FULL-AUTO: Lucrează complet autonom. Merge automat dacă testele trec 100%.'}

════════════════════════════════════════
ACUM
════════════════════════════════════════

Analizează starea proiectului și decide care e cel mai important lucru de făcut.
Explică planul tău, apoi începe să lucrezi.
`.trim()
}

module.exports = { buildOrchestratorPrompt }
```

---

## Cum construiești contextul dinamic — `server/orchestrator/contextBuilder.js`

```javascript
const simpleGit = require('simple-git')
const path = require('path')
const db = require('../db/queries')
const { runCommand } = require('./executor')

async function buildOrchestratorContext(projectId) {
  const project = db.getProjectById(projectId)
  const context = db.getProjectContext(projectId)
  const todos = db.getPendingTodos(projectId)

  const git = simpleGit(project.root_path)

  // Git info
  const branch = (await git.branch()).current
  const log = await git.log({ maxCount: 10 })
  const status = await git.status()

  const gitLog = {
    branch,
    recentCommits: log.all.map(c => ({
      hash: c.hash.substring(0, 7),
      message: c.message,
    })),
    changedFiles: [
      ...status.modified,
      ...status.not_added,
      ...status.created,
    ],
  }

  // Rezultate teste
  let testResults = { summary: 'Testele nu au fost rulate încă.', failed: [] }
  try {
    const { stdout, exitCode } = await runCommand('npm test -- --json 2>/dev/null', project.root_path)
    testResults = parseTestResults(stdout, exitCode)
  } catch {}

  // Structura fișierelor (primele 3 nivele)
  const { stdout: tree } = await runCommand('find . -not -path "./node_modules/*" -not -path "./.git/*" | head -60', project.root_path)

  return {
    project: {
      name: project.name,
      description: context.architecture || project.description,
      architecture: context.architecture || '',
      techStack: context.tech_stack || '',
      conventions: context.conventions || '',
      mode: project.mode || 'manual',
      root_path: project.root_path,
    },
    gitLog,
    testResults,
    todos,
    files: tree,
  }
}

function parseTestResults(output, exitCode) {
  if (exitCode === 0) {
    return { summary: '✅ Toate testele trec.', failed: [] }
  }

  // Parsează output Jest/Vitest/Mocha
  const failedMatches = output.match(/✕ .+/g) || output.match(/FAIL .+/g) || []
  return {
    summary: `❌ ${failedMatches.length} teste eșuate.`,
    failed: failedMatches.slice(0, 10),
  }
}

module.exports = { buildOrchestratorContext }
```

---

## Session Runner — `server/orchestrator/sessionRunner.js`

Pornește o sesiune de orchestrare și gestionează loop-ul autonom.

```javascript
const { buildOrchestratorContext } = require('./contextBuilder')
const { buildOrchestratorPrompt } = require('../prompts/orchestrator')
const { executeMcpTool } = require('./mcpTools')
const { notifyUser } = require('./notifier')
const db = require('../db/queries')

/**
 * Pornește o sesiune autonomă pentru un proiect.
 * Rulează până la finalizare sau eroare.
 */
async function startOrchestratorSession(projectId, options = {}) {
  const sessionId = createSession(projectId)
  const maxCycles = options.maxCycles || 10
  let cycles = 0
  let consecutiveFailures = 0

  log(sessionId, 'Sesiune orchestrator pornită')

  while (cycles < maxCycles) {
    cycles++
    log(sessionId, `Ciclu ${cycles}/${maxCycles}`)

    try {
      // 1. Construiește contextul proaspăt la fiecare ciclu
      const ctx = await buildOrchestratorContext(projectId)
      const prompt = buildOrchestratorPrompt(ctx)

      // 2. Trimite la agentul orchestrator (GPT-4o sau Claude)
      const response = await callOrchestrator(prompt, ctx.project.mode)

      // 3. Procesează tool call-urile din răspuns
      const toolCalls = parseToolCalls(response)

      if (toolCalls.length === 0) {
        // Orchestratorul a terminat — nu mai are ce face
        log(sessionId, 'Orchestratorul a raportat că nu mai sunt task-uri.')
        await notifyUser(projectId, 'session_complete', {
          message: 'Orchestratorul a terminat toate task-urile.',
          cycles,
        })
        break
      }

      // 4. Execută fiecare tool call
      for (const call of toolCalls) {
        const result = await executeMcpTool(call.name, call.params, {
          projectId,
          sessionId,
          mode: ctx.project.mode,
        })

        log(sessionId, `Tool: ${call.name} → ${JSON.stringify(result).substring(0, 100)}`)

        // Dacă e request_approval și modul e manual/semi-auto → pauză
        if (call.name === 'request_approval') {
          await pauseForApproval(sessionId, projectId, result)
        }
      }

      consecutiveFailures = 0

    } catch (err) {
      consecutiveFailures++
      log(sessionId, `Eroare: ${err.message}`)

      if (consecutiveFailures >= 2) {
        await notifyUser(projectId, 'session_error', {
          message: `Orchestratorul a eșuat de ${consecutiveFailures} ori consecutiv.`,
          error: err.message,
          sessionId,
        })
        break
      }
    }
  }

  endSession(sessionId)
}

/**
 * Pauzează sesiunea și așteaptă aprobarea userului.
 * Timeoutează după 24h dacă userul nu răspunde.
 */
async function pauseForApproval(sessionId, projectId, approvalRequest) {
  db.setSessionStatus(sessionId, 'waiting_approval')

  await notifyUser(projectId, 'approval_required', {
    summary: approvalRequest.summary,
    branch: approvalRequest.branch,
    approveUrl: `http://localhost:3847/approve/${sessionId}`,
    rejectUrl: `http://localhost:3847/reject/${sessionId}`,
  })

  // Așteaptă răspunsul (polling la DB)
  const decision = await waitForDecision(sessionId, 24 * 60 * 60 * 1000)

  if (decision === 'rejected') {
    throw new Error('Task respins de user. Orchestratorul va reîncerca cu altă abordare.')
  }

  db.setSessionStatus(sessionId, 'running')
}

module.exports = { startOrchestratorSession }
```

---

## Cum gestionezi erorile orchestratorului

Orchestratorul poate face greșeli. Protecții implementate:

```javascript
// server/orchestrator/safetyGuards.js

const FORBIDDEN_COMMANDS = [
  'rm -rf',
  'DROP TABLE',
  'format',
  'del /f /s',
  'git push --force',  // niciodată force push
]

function validateCommand(cmd) {
  for (const forbidden of FORBIDDEN_COMMANDS) {
    if (cmd.toLowerCase().includes(forbidden.toLowerCase())) {
      throw new Error(`Comandă interzisă detectată: "${forbidden}" în "${cmd}"`)
    }
  }
  return true
}

// Limitează dimensiunea fișierelor scrise
function validateFileWrite(path, content) {
  if (content.length > 500_000) {  // 500KB max per fișier
    throw new Error(`Conținut prea mare pentru ${path}: ${content.length} bytes`)
  }

  // Nu permite scriere în afara directorului proiectului
  const resolvedPath = require('path').resolve(path)
  const resolvedRoot = require('path').resolve(PROJECT_ROOT)
  if (!resolvedPath.startsWith(resolvedRoot)) {
    throw new Error(`Path traversal detectat: ${path}`)
  }
}

// Rollback automat dacă testele pică după modificări
async function autoRollback(git, branchName, reason) {
  console.log(`[SafetyGuard] Rollback: ${reason}`)
  await git.checkout('main')
  await git.deleteLocalBranch(branchName, true)
}
```
