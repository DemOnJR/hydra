# Pipeline CI/CD cu Agenți — Hydra

Sistemul Builder → Reviewer → Tester care funcționează ca un CI/CD autonom.

---

## Fluxul complet

```
Orchestrator primește task
        │
        ▼
[1] Builder Agent
    - citește fișierele relevante
    - scrie modificările
    - face commit pe branch nou
        │
        ▼
[2] Reviewer Agent
    - citește diff-ul față de main
    - caută bugs, probleme de securitate, style issues
    - aprobă sau cere modificări
        │
    ┌───┴───┐
  Aprobat  Respins → înapoi la Builder (max 3 retry)
    │
    ▼
[3] Tester Agent
    - rulează npm test
    - rulează npm run build
    - verifică că nu există erori lint
    - raportează rezultatele
        │
    ┌───┴───┐
  Trece   Pică → înapoi la Builder
    │
    ▼
[4] Approval Gate
    - Manual: notifică userul, așteaptă click
    - Semi-auto: notifică userul, merge automat după 30 min fără răspuns
    - Full-auto: merge direct dacă toate testele trec
        │
        ▼
[5] Merge în main + deploy (opțional)
```

---

## Builder Agent — `server/agents/builder.js`

```javascript
const { callAI } = require('../ai/caller')
const mcpTools = require('../orchestrator/mcpTools')
const db = require('../db/queries')

const BUILDER_SYSTEM_PROMPT = `
Tu ești un developer expert. Primești un task specific și trebuie să îl implementezi.

REGULI:
- Citește ÎNTOTDEAUNA fișierele înainte să le modifici
- Fă modificări minimale — nu schimba ce nu trebuie schimbat
- Respectă stilul de cod existent (indentare, naming, structură)
- Nu adăuga dependențe noi fără să le menționezi explicit
- Scrie cod care trece testele existente
- Dacă nu ești sigur de ceva, citește mai multe fișiere pentru context

FORMAT RĂSPUNS:
1. Explică ce ai de gând să faci (2-3 propoziții)
2. Listează fișierele pe care le vei modifica
3. Efectuează modificările prin tool calls
4. Explică pe scurt ce ai făcut
`

async function runBuilderAgent(task, projectContext, tools) {
  const messages = [
    {
      role: 'user',
      content: `
PROJECT CONTEXT:
${projectContext}

TASK:
${task.title}

DESCRIERE DETALIATĂ:
${task.description}

Implementează acest task. Folosește tool-urile disponibile pentru a citi și modifica fișierele.
      `.trim()
    }
  ]

  let iterations = 0
  const maxIterations = 20  // protecție împotriva loop-urilor infinite

  while (iterations < maxIterations) {
    iterations++

    const response = await callAI({
      model: 'gpt-4o',  // sau claude-opus-4-5
      systemPrompt: BUILDER_SYSTEM_PROMPT,
      messages,
      tools: getBuilderTools(tools),
    })

    // Dacă nu mai are tool calls → a terminat
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        success: true,
        summary: response.text,
        iterations,
      }
    }

    // Execută tool calls și adaugă rezultatele în conversație
    const toolResults = []
    for (const call of response.toolCalls) {
      const result = await tools.execute(call.name, call.params)
      toolResults.push({ toolCallId: call.id, result })
    }

    messages.push({ role: 'assistant', content: response.toolCalls })
    messages.push({ role: 'tool', content: toolResults })
  }

  throw new Error(`Builder a depășit ${maxIterations} iterații fără să termine`)
}

// Tool-urile disponibile pentru Builder
function getBuilderTools(tools) {
  return [
    {
      name: 'read_file',
      description: 'Citește conținutul unui fișier din proiect',
      parameters: { path: { type: 'string', description: 'Calea relativă la fișier' } }
    },
    {
      name: 'write_file',
      description: 'Scrie conținut într-un fișier (creează dacă nu există)',
      parameters: {
        path: { type: 'string' },
        content: { type: 'string', description: 'Conținutul complet al fișierului' }
      }
    },
    {
      name: 'list_files',
      description: 'Listează fișierele dintr-un director',
      parameters: { dir: { type: 'string', default: '.' } }
    },
    {
      name: 'run_command',
      description: 'Rulează un command (npm install, etc.) — NU pentru teste',
      parameters: { cmd: { type: 'string' } }
    },
  ]
}

module.exports = { runBuilderAgent }
```

---

## Reviewer Agent — `server/agents/reviewer.js`

```javascript
const REVIEWER_SYSTEM_PROMPT = `
Tu ești un senior developer care face code review.
Primești un diff și trebuie să verifici calitatea modificărilor.

VERIFICĂ:
- Bugs logice sau runtime errors evidente
- Probleme de securitate (SQL injection, XSS, path traversal, etc.)
- Respectarea convențiilor proiectului
- Consistența cu restul codului
- Import-uri lipsă sau inutile
- Memory leaks sau resurse necleanuite
- Edge cases netratate

NU BLOCA pentru:
- Preferințe stilistice minore
- Optimizări premature
- Lipsa comentariilor (dacă nu e o regulă a proiectului)

RĂSPUNDE cu JSON:
{
  "approved": true/false,
  "issues": [
    {
      "severity": "blocking" | "warning" | "suggestion",
      "file": "path/to/file.js",
      "line": 42,
      "description": "Descrierea problemei",
      "suggestion": "Cum să o rezolvi"
    }
  ],
  "summary": "Rezumat scurt al review-ului"
}
`

async function runReviewerAgent(diff, projectContext, conventions) {
  const response = await callAI({
    model: 'claude-sonnet-4-6',  // Claude e excelent la code review
    systemPrompt: REVIEWER_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `
PROJECT CONVENTIONS:
${conventions}

DIFF DE REVIZUIT:
\`\`\`diff
${diff}
\`\`\`

Fă review-ul acestor modificări.
      `.trim()
    }],
    responseFormat: 'json',
  })

  const review = JSON.parse(response.text)

  const blockingIssues = review.issues.filter(i => i.severity === 'blocking')

  return {
    approved: review.approved && blockingIssues.length === 0,
    blockingIssues,
    warnings: review.issues.filter(i => i.severity === 'warning'),
    suggestions: review.issues.filter(i => i.severity === 'suggestion'),
    summary: review.summary,
  }
}

module.exports = { runReviewerAgent }
```

---

## Tester Agent — `server/agents/tester.js`

```javascript
const { runCommand } = require('../orchestrator/executor')

/**
 * Rulează toate testele și validările pe un branch.
 * Returnează un raport detaliat.
 */
async function runTesterAgent(projectRoot, branch) {
  const git = require('simple-git')(projectRoot)

  // Checkout pe branch-ul de testat
  await git.checkout(branch)

  const results = {
    branch,
    passed: false,
    steps: [],
  }

  // ─── PASUL 1: Install dependencies ─────────────────────
  const installResult = await runStep('npm install', projectRoot)
  results.steps.push({ name: 'npm install', ...installResult })

  if (!installResult.success) {
    results.summary = 'npm install a eșuat — dependențe lipsă sau incompatibile'
    return results
  }

  // ─── PASUL 2: Lint ──────────────────────────────────────
  const lintResult = await runStep('npm run lint 2>&1 || true', projectRoot)
  results.steps.push({ name: 'lint', ...lintResult })

  // Lint nu blochează dacă există warnings — blochează doar la errors

  // ─── PASUL 3: Build ─────────────────────────────────────
  const buildResult = await runStep('npm run build', projectRoot)
  results.steps.push({ name: 'build', ...buildResult })

  if (!buildResult.success) {
    results.summary = 'Build a eșuat — cod cu erori de compilare'
    return results
  }

  // ─── PASUL 4: Tests ─────────────────────────────────────
  const testResult = await runStep('npm test', projectRoot)
  results.steps.push({ name: 'tests', ...testResult })

  // ─── PASUL 5: Type check (dacă există TypeScript) ───────
  const hasTypeScript = require('fs').existsSync(
    require('path').join(projectRoot, 'tsconfig.json')
  )
  if (hasTypeScript) {
    const tsResult = await runStep('npx tsc --noEmit', projectRoot)
    results.steps.push({ name: 'typecheck', ...tsResult })
  }

  // Raport final
  const failedSteps = results.steps.filter(s => !s.success)
  results.passed = failedSteps.length === 0
  results.summary = results.passed
    ? `✅ Toate ${results.steps.length} verificări au trecut`
    : `❌ ${failedSteps.length} verificări au eșuat: ${failedSteps.map(s => s.name).join(', ')}`

  return results
}

async function runStep(command, cwd) {
  try {
    const { stdout, stderr, exitCode } = await runCommand(command, cwd, { timeout: 120000 })
    return {
      success: exitCode === 0,
      output: stdout + (stderr ? '\nSTDERR:\n' + stderr : ''),
      exitCode,
    }
  } catch (err) {
    return {
      success: false,
      output: err.message,
      exitCode: 1,
    }
  }
}

module.exports = { runTesterAgent }
```

---

## Pipeline Runner — `server/pipeline/runner.js`

Coordonează cei 3 agenți și gestionează retry-urile.

```javascript
const { runBuilderAgent } = require('../agents/builder')
const { runReviewerAgent } = require('../agents/reviewer')
const { runTesterAgent } = require('../agents/tester')
const { notifyUser } = require('../orchestrator/notifier')
const simpleGit = require('simple-git')
const db = require('../db/queries')

const MAX_BUILDER_RETRIES = 3
const MAX_TESTER_RETRIES = 2

async function runPipeline(task, projectId, mode) {
  const project = db.getProjectById(projectId)
  const context = db.getProjectContext(projectId)
  const git = simpleGit(project.root_path)

  // Creează branch nou pentru task
  const branchName = `feature/agent-${task.id}-${slugify(task.title)}`
  await git.checkoutBranch(branchName, 'main')

  const pipelineLog = []
  const log = (msg) => {
    pipelineLog.push({ ts: new Date().toISOString(), msg })
    console.log(`[Pipeline] ${msg}`)
  }

  log(`Start pipeline pentru: "${task.title}"`)
  log(`Branch: ${branchName}`)

  // ─── FAZA 1: Builder ────────────────────────────────────
  let buildAttempts = 0
  let builderFeedback = ''

  while (buildAttempts < MAX_BUILDER_RETRIES) {
    buildAttempts++
    log(`Builder attempt ${buildAttempts}/${MAX_BUILDER_RETRIES}`)

    const taskWithFeedback = builderFeedback
      ? { ...task, description: task.description + '\n\nFEEDBACK DIN REVIEW ANTERIOR:\n' + builderFeedback }
      : task

    const buildResult = await runBuilderAgent(taskWithFeedback, formatContext(context), {
      execute: (toolName, params) => executeTool(toolName, params, project.root_path)
    })

    await git.add('.')
    await git.commit(`feat: ${task.title} (attempt ${buildAttempts})`)

    log(`Builder terminat: ${buildResult.summary}`)

    // ─── FAZA 2: Reviewer ─────────────────────────────────
    log('Reviewer pornit...')
    const diff = await git.diff(['main', branchName])
    const reviewResult = await runReviewerAgent(diff, formatContext(context), context.conventions)

    log(`Review: ${reviewResult.approved ? '✅ Aprobat' : '❌ Respins'} — ${reviewResult.summary}`)

    if (reviewResult.approved) break

    // Reviewer a respins — pregătește feedback pentru Builder
    builderFeedback = [
      ...reviewResult.blockingIssues.map(i => `BLOCKING [${i.file}:${i.line}]: ${i.description} → ${i.suggestion}`),
      ...reviewResult.warnings.map(i => `WARNING [${i.file}:${i.line}]: ${i.description}`),
    ].join('\n')

    log(`Builder va reîncerca cu feedback: ${builderFeedback.substring(0, 200)}...`)

    // Resetează la starea anterioară pentru retry curat
    await git.reset(['--hard', 'HEAD~1'])
  }

  if (buildAttempts >= MAX_BUILDER_RETRIES) {
    const msg = `Builder + Reviewer au eșuat după ${MAX_BUILDER_RETRIES} încercări.`
    log(msg)
    await notifyUser(projectId, 'pipeline_failed', { task, reason: msg, branch: branchName })
    return { success: false, reason: msg }
  }

  // ─── FAZA 3: Tester ─────────────────────────────────────
  let testAttempts = 0

  while (testAttempts < MAX_TESTER_RETRIES) {
    testAttempts++
    log(`Tester attempt ${testAttempts}/${MAX_TESTER_RETRIES}`)

    const testResult = await runTesterAgent(project.root_path, branchName)
    log(`Teste: ${testResult.summary}`)

    if (testResult.passed) break

    if (testAttempts < MAX_TESTER_RETRIES) {
      // Încearcă să repare testele cu Builder-ul
      log('Teste eșuate — Builder încearcă să repare...')
      const failedOutput = testResult.steps.filter(s => !s.success).map(s => s.output).join('\n')

      await runBuilderAgent(
        {
          title: `Fix failing tests`,
          description: `Repară testele eșuate:\n${failedOutput}`
        },
        formatContext(context),
        { execute: (toolName, params) => executeTool(toolName, params, project.root_path) }
      )

      await git.add('.')
      await git.commit('fix: repair failing tests')
    }
  }

  if (testAttempts >= MAX_TESTER_RETRIES) {
    const msg = `Testele au eșuat după ${MAX_TESTER_RETRIES} încercări.`
    log(msg)
    await notifyUser(projectId, 'pipeline_failed', { task, reason: msg, branch: branchName })
    return { success: false, reason: msg }
  }

  // ─── FAZA 4: Approval Gate ──────────────────────────────
  log('Toate verificările trec — Approval Gate...')

  const approved = await approvalGate(mode, projectId, {
    task,
    branch: branchName,
    pipelineLog,
  })

  if (!approved) {
    log('Respins de user — branch păstrat pentru referință')
    return { success: false, reason: 'Respins de user', branch: branchName }
  }

  // ─── FAZA 5: Merge ──────────────────────────────────────
  log('Merge în main...')
  await git.checkout('main')
  await git.merge([branchName, '--no-ff', '-m', `Merge: ${task.title}`])
  await git.deleteLocalBranch(branchName)

  db.completeTodo(task.id)
  log('✅ Pipeline complet!')

  return { success: true, branch: branchName, pipelineLog }
}

async function approvalGate(mode, projectId, context) {
  if (mode === 'full-auto') {
    return true  // merge direct
  }

  if (mode === 'semi-auto') {
    // Notifică și așteaptă 30 min, merge automat dacă nu răspunde
    await notifyUser(projectId, 'approval_required', {
      ...context,
      autoApproveIn: '30 minute',
    })
    const decision = await waitForDecision(context.branch, 30 * 60 * 1000)
    return decision !== 'rejected'  // approved sau timeout = merge
  }

  // manual mode — notifică și așteaptă nelimitat
  await notifyUser(projectId, 'approval_required', context)
  const decision = await waitForDecision(context.branch, 24 * 60 * 60 * 1000)
  return decision === 'approved'
}

function formatContext(context) {
  return [
    context.architecture && `ARHITECTURĂ:\n${context.architecture}`,
    context.tech_stack && `TECH STACK:\n${context.tech_stack}`,
    context.conventions && `CONVENȚII:\n${context.conventions}`,
  ].filter(Boolean).join('\n\n')
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30)
}

module.exports = { runPipeline }
```

---

## Executor comenzi — `server/orchestrator/executor.js`

```javascript
const { exec } = require('child_process')

function runCommand(cmd, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 60000

    const child = exec(cmd, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,  // 10MB output max
    }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: error ? error.code || 1 : 0,
        success: !error,
      })
    })
  })
}

// Execută un MCP tool cu safety guards
async function executeTool(toolName, params, projectRoot) {
  const { validateCommand, validateFileWrite } = require('./safetyGuards')

  switch (toolName) {
    case 'read_file': {
      const fullPath = require('path').join(projectRoot, params.path)
      return require('fs').readFileSync(fullPath, 'utf8')
    }

    case 'write_file': {
      validateFileWrite(params.path, params.content)
      const fullPath = require('path').join(projectRoot, params.path)
      require('fs').mkdirSync(require('path').dirname(fullPath), { recursive: true })
      require('fs').writeFileSync(fullPath, params.content)
      return { success: true, path: params.path }
    }

    case 'list_files': {
      const dir = require('path').join(projectRoot, params.dir || '.')
      const { stdout } = await runCommand(
        `find . -not -path "*/node_modules/*" -not -path "*/.git/*" -maxdepth 4`,
        dir
      )
      return stdout
    }

    case 'run_command': {
      validateCommand(params.cmd)
      return await runCommand(params.cmd, projectRoot)
    }

    default:
      throw new Error(`Tool necunoscut: ${toolName}`)
  }
}

module.exports = { runCommand, executeTool }
```
