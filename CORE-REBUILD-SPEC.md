# Hydra - Core Rebuild Spec v3
### Browser AI with Full Development Superpowers

---

## 0) Mission

Free browser AI chats (Claude.ai, ChatGPT, Gemini, Copilot, and others) are strong at reasoning,
planning, and code generation, but they cannot directly operate on the local machine.

Hydra gives browser AI real execution capability on the user's computer, with strict safety,
proof of execution, and a workflow that works for non-technical and technical users.

The target is practical parity with CLI-native workflows (OpenCode, Cursor, Aider), but with
no terminal requirement for the user.

---

## 1) Core Problem

The current failure mode is the sandbox illusion:

- AI says a file was edited, but no local file changed.
- AI says tests passed, but no test command ran.
- AI says a server is running, but no process exists.

This is not a prompting problem. It is an execution-trust problem.

Hydra must enforce a model where only locally executed actions with receipts are treated as real.

---

## 2) Capability Parity Map

| Capability | CLI Tool | Browser AI Alone | Hydra + Browser AI |
|---|---|---|---|
| Read/write local files | Yes | No | Yes |
| Run shell commands | Yes | No | Yes |
| Install packages | Yes | No | Yes |
| Start dev server/watcher | Yes | No | Yes |
| Git operations | Yes | No | Yes |
| Live preview/screenshot | Partial | No | Yes |
| Console errors in real time | Yes | No | Yes |
| Binary/asset file handling | Yes | No | Yes |
| Parallel branch workflow | Yes (manual) | No | Yes (automated) |
| Session persistence | Yes | No | Yes |
| Multi-provider worker pool | Partial | Manual | Yes |
| No terminal required | No | Yes | Yes |

---

## 3) Product Principles

1. Local-first execution
   - All side effects run on the user's machine through Hydra.
2. Evidence-first truth
   - Every side effect must have a receipt and artifact trail.
3. Provider-agnostic workers
   - Any supported browser AI provider can be used as a worker.
4. Human-level simplicity
   - User describes goals in plain language; terminal is optional, not required.
5. Safe by default
   - Policy guards, approval modes, and path restrictions are always active.
6. Recoverable by design
   - Crash recovery restores task state, process state, and execution history.

---

## 4) Personas

Hydra must support all personas without changing the underlying model.

### Builder (non-technical)
Describes desired app/game/project in plain language and gets a working deliverable.

### Developer (technical)
Offloads implementation tasks to workers while keeping review and merge control.

### Power User (advanced)
Runs multi-provider free-account worker pools in parallel with strict evidence tracking.

---

## 5) Non-Negotiable Rules

1. No receipt, no action.
2. Browser agents can request tools but cannot claim side effects without receipts.
3. Structured tool protocol only (no free-form claims as proof).
4. Task state is explicit and persisted (`todo -> in_progress -> in_review -> complete`, plus `blocked`).
5. A task cannot be `complete` without evidence.
6. The AI must receive real feedback (test output, process logs, screenshots, console errors).
7. Long-running processes are tracked resources, not fire-and-forget commands.
8. Only Hydra runtime can mutate state in the source-of-truth store.

---

## 6) Execution Invariants (Critical Missing Piece)

These invariants make the system robust and debuggable.

1. Deterministic tool lifecycle
   - `requested -> approved/rejected -> executed -> receipted -> attached_to_task`.
2. Idempotency
   - Same `request_id` always returns the same result without re-execution.
3. Exclusive task lease
   - A task has one active worker lease at a time.
4. Process ownership
   - Each process belongs to a task and project; orphan processes are reconciled on restart.
5. Completion gate
   - `complete` transition must validate required evidence checks.
6. Auditability
   - Every transition and tool call is timestamped, correlated, and queryable.

---

## 7) Roles

### User
- Defines goals and constraints.
- Approves high-risk operations according to approval mode.

### Orchestrator (Manager Agent)
- Main conversation interface.
- Builds plan and task graph.
- Delegates subtasks to workers.
- Runs verification and review.
- Creates bug/rework tasks.
- Decides if task can move to `complete`.

### Worker Agents (Browser Sessions)
- Execute assigned subtasks via tool requests.
- Work in isolated branches/worktrees.
- Submit summary, receipts, and blockers.

### Hydra Local Runtime (Authority)
- Executes all tool requests locally.
- Enforces policy and path constraints.
- Tracks processes, logs, previews, and receipts.
- Persists task and execution state.

---

## 8) Required Architecture

### 8.1 Control Plane
- Task Graph Service: tasks, dependencies, priorities, states.
- Orchestrator Engine: planning, delegation, review, retry logic.
- Scheduler: dispatch, capacity control, lease management.
- Session Manager: browser session health and provider tracking.

### 8.2 Execution Plane
- Tool Runtime:
  - file read/list/search
  - file write/edit/patch (text and binary)
  - semantic file operations (`rename_symbol`, `move_function`, `find_references`) via LSP/tree-sitter
  - shell command execution
  - package install
  - HTTP proxy requests (health checks, API probes, dependency downloads) under policy controls
  - git operations
  - process start/stop/restart/status
  - environment setup helpers (`nvm`, `pyenv`, `virtualenv`, `conda`)
- Process Manager:
  - stdout/stderr streaming
  - hang/crash detection
  - port conflict detection
- Workspace Manager:
  - per-task worktree lifecycle
  - branch ownership and merge readiness
- Preview Engine:
  - capture screenshots
  - capture browser console errors
  - attach preview artifacts to tasks
- Verification Runner:
  - test/build/lint and custom checks

### 8.3 Browser AI Plane
- Browser connector (hybrid recommended): Playwright/CDP + extension fallback.
- Provider adapters: selector normalization, context rehydration, thread control.
- Response parser: robust extraction of structured tool envelopes.

### 8.4 Persistence
Minimum tables:

- `projects`
- `agents`
- `tasks`
- `task_transitions`
- `task_assignments`
- `tool_calls`
- `tool_receipts`
- `task_artifacts`
- `processes`
- `process_output`
- `branches`
- `review_issues`
- `sessions`
- `tool_registry`
- `tool_versions`
- `capability_gaps`
- `genesis_tasks`
- `macro_tools`
- `environment_profiles`
- `secret_refs`

---

## 9) Data Contracts (Critical Missing Piece)

The protocol must include correlation metadata for debugging and replay.

### 9.1 Tool Request Envelope

```json
{
  "type": "tool_request",
  "request_id": "uuid",
  "task_id": "uuid",
  "agent_id": "uuid",
  "correlation_id": "uuid",
  "action": "edit_file",
  "args": {
    "path": "src/main/ipcHandlers.js",
    "patch": "..."
  },
  "reason": "Implement fallback behavior"
}
```

### 9.2 Tool Result Envelope

```json
{
  "type": "tool_result",
  "request_id": "uuid",
  "ok": true,
  "side_effect": true,
  "receipt_id": "uuid",
  "summary": "Updated src/main/ipcHandlers.js",
  "artifacts": {
    "files_changed": ["src/main/ipcHandlers.js"],
    "diff_preview": "..."
  }
}
```

### 9.3 Execution Receipt (Source of Truth)

```json
{
  "receipt_id": "uuid",
  "tool_call_id": "uuid",
  "task_id": "uuid",
  "project_id": "uuid",
  "ok": true,
  "side_effect": true,
  "started_at": "2026-03-24T10:00:00Z",
  "ended_at": "2026-03-24T10:00:01Z",
  "artifacts": {
    "files_changed": ["src/main/ipcHandlers.js"],
    "exit_code": 0
  }
}
```

Protocol rules:

- `request_id` idempotency is mandatory.
- Unknown action returns structured error.
- Malformed payload triggers correction loop, not guessed execution.
- Binary payloads must be encoded and size-limited.

---

## 10) Scheduler and Concurrency Model (Critical Missing Piece)

1. Readiness
   - Task is runnable only if dependencies are complete.
2. Lease
   - Scheduler grants task lease (`lease_id`, `expires_at`) to a worker.
3. Heartbeat
   - Worker must renew lease; stale lease is revoked and task is re-queued.
4. Capacity
   - Each worker has configurable concurrency (default 1 active task).
5. Conflict handling
   - Soft file-lock hints from planned file list.
   - If overlap risk is high, serialize tasks or open conflict-resolution task.

---

## 11) Task Lifecycle

States:

- `todo`: defined but not started
- `in_progress`: assigned and active
- `in_review`: implementation submitted with evidence
- `complete`: validated and integrated
- `blocked`: cannot proceed due to dependency, repeated failure, or external constraint

Required transitions:

1. `todo -> in_progress` by scheduler assignment.
2. `in_progress -> in_review` only when evidence bundle is attached.
3. `in_review -> complete` only when verification checks pass.
4. `in_review -> in_progress` when fix iteration is required.
5. `in_progress -> blocked` after retry ceiling.

Review issue types:

- bug
- error
- wrong_logic
- optimization
- missing_tests

---

## 12) Process and Preview Model

Processes are first-class entities with explicit states:

- `starting`
- `running`
- `stopped`
- `failed`
- `zombie` (detected without owning task)

Required process tools:

- `start_process`
- `stop_process`
- `restart_process`
- `read_process_output`
- `list_processes`

Preview capture rules:

- on-demand capture always supported
- automatic capture after successful build or server start
- optional timed capture interval per project

Preview artifacts:

- screenshot image
- console errors/warnings
- network error summary

---

## 13) Project Archetypes

Each archetype defines default checks and preview style.

| Archetype | Detection Hints | Default Verification | Preview |
|---|---|---|---|
| Web App | `package.json`, `index.html` | `npm test`, `npm run build` | screenshot + console |
| Web Game | Phaser/Three/Canvas | `npm run build` + smoke run | screenshot + console |
| Native Game | Godot/Unity/Pygame files | project build command | process output |
| API/Backend | Express/FastAPI/etc | test suite + health check | HTTP probe + logs |
| CLI Tool | executable entry + tests | unit + smoke run | stdout/stderr |
| Mobile | Expo/React Native files | build + type checks | tool output |
| Library/SDK | package metadata | tests + build + type checks | optional |
| Data/ML | Python scripts/notebooks | script assertions | artifact outputs |

All defaults are overridable per project.

---

## 14) Feedback Loops

### Code -> Run -> Observe -> Fix
1. Worker edits code via tool request.
2. Hydra executes and records receipt.
3. Orchestrator runs verification and/or starts process.
4. Hydra captures logs, test output, previews.
5. Evidence is injected back into worker context.
6. Worker iterates until checks pass.

### Error -> Review Issue -> Rework
1. Verification fails.
2. Failure output is attached to `review_issues`.
3. Orchestrator creates rework task and links failing artifacts.
4. Worker fixes and re-submits.

---

## 15) Delegation and Parallel Branch Strategy

- One active implementation task per worker branch/worktree.
- Branch naming: `task/<short-id>-<slug>`.
- Worktree path: `.hydra/worktrees/<short-id>/`.

Per-task branch metadata:

- branch name
- worktree path
- base SHA
- head SHA
- owning agent ID

Merge policy:

- Verify branch before merge.
- Reject merge if required checks fail.
- For overlap conflicts, either serialize or open explicit conflict-resolution task.

---

## 16) End-to-End Flow

1. User describes goal in orchestrator chat.
2. Orchestrator selects or confirms project archetype.
3. Orchestrator creates prioritized task graph.
4. Scheduler dispatches runnable tasks to workers.
5. Workers issue tool requests; Hydra executes locally.
6. Hydra records receipts and artifacts for every side effect.
7. Orchestrator moves task to `in_review` with evidence.
8. Verification runs automatically.
9. Failures generate rework tasks.
10. Passing tasks move to `complete` and are merged.
11. Orchestrator reports plain-language progress and deliverables.

---

## 17) Cross-Session Memory

Hydra rehydrates worker context because browser chats lose memory.

Context package should include:

- project goal and constraints
- task description and dependency context
- relevant files and summaries
- open review issues
- current process status
- latest verification results

When context limits are hit, Hydra summarizes older history and keeps links to full artifacts.

---

## 18) Reliability and Recovery

- Browser session heartbeat and health scoring
- Command timeout and cancellation
- Retry policy with cap (default 3)
- Loop guard for repeated no-progress tool requests
- Process crash detection and configurable auto-restart

On app restart:

1. Reload unfinished tasks.
2. Reconcile processes by PID and ownership.
3. Revoke stale task leases.
4. Move tasks to safe state with reason.
5. Rehydrate worker context and continue.

---

## 19) Safety, Security, and Compliance

Approval modes:

- `auto`: low-risk actions auto-approved
- `semi-auto`: destructive actions require confirmation
- `manual`: all side effects require confirmation

Policy requirements:

- Restrict file operations to project/worktree roots.
- Block known dangerous command patterns unless explicitly approved.
- Add extra confirmation for secrets and credentials.
- Enforce resource limits (CPU/memory/timeouts).
- Redact secrets from logs/artifacts before persistence.

Compliance note:

- Browser automation should respect provider terms and local user consent settings.

---

## 20) Observability and Debuggability (Critical Missing Piece)

Hydra should expose a task timeline with correlation IDs.

Key telemetry:

- task state transition latency
- tool success/failure rate by action
- provider reliability score
- retry counts and block reasons
- process uptime and crash rate
- capability gap frequency by category
- genesis tool promotion/rollback counts

Debug artifacts per task:

- tool call log
- receipt log
- verification outputs
- preview captures
- final review decision with rationale

Dashboard requirement:

- capability gap log with trend view (repeat gaps are auto-surfaced as genesis candidates)

---

## 21) UX Requirements (Anyone Layer)

- Project Wizard with minimal clarifying questions.
- Progress dashboard with plain-language status.
- One-click preview.
- Human-readable approval prompts.
- Deliverable packaging at completion.
- No terminal required for standard workflow.

---

## 22) MVP Build Plan

### Phase 1 - Execution Truth Layer
- strict protocol
- idempotent tool execution
- mandatory receipts
- completion gate on evidence

### Phase 2 - Process and Feedback Layer
- process manager
- preview capture
- feedback injection into worker sessions

### Phase 3 - Delegation Core
- scheduler, leases, dependencies
- per-task branch/worktree lifecycle
- multi-provider worker pool

### Phase 4 - Review Automation
- archetype-based verification pipeline
- review issue creation and rework loop
- context rehydration and summarization

### Phase 5 - UX and Hardening
- wizard + dashboard
- recovery robustness
- performance tuning for parallelism

---

## 23) Acceptance Test Suite (Critical Missing Piece)

Core rebuild is not accepted until these tests pass:

1. Sandbox illusion test
   - worker claims edit without tool call -> system rejects claim.
2. Receipt integrity test
   - every side effect links to exactly one receipt.
3. Delegation reliability test
   - N parallel worker tasks produce isolated real changes.
4. Process tracking test
   - started process appears in process table and logs stream.
5. Preview feedback test
   - screenshot and console errors are attached and reinjected.
6. Recovery test
   - app crash/restart preserves unfinished task and process state.
7. Approval policy test
   - destructive action blocks or prompts as configured.
8. Capability gap signal test
   - missing capability emits `capability_gap` instead of silent failure.
9. Genesis promotion test
   - tool draft + tests + approval -> tool becomes active and discoverable.
10. Genesis rollback test
   - bad tool version can be reverted with deterministic rollback.
11. Environment bootstrap test
   - project runtime setup succeeds via environment manager profile.
12. Secrets redaction test
   - no secret value appears in logs, receipts, or artifacts.

---

## 24) Definition of Done

The core rebuild is done only when all are true:

1. Delegated tasks consistently create real local changes.
2. Every side effect has a persisted receipt and artifact link.
3. Running processes are tracked and readable by agents.
4. Agents receive visual/runtime feedback (screenshots, console, tests).
5. Orchestrator completes full cycle: plan -> delegate -> verify -> fix -> complete.
6. Parallel branch/worktree execution is stable.
7. Restart recovery does not lose task/process/command history.
8. Non-technical user can complete a project without terminal usage.
9. Capability gaps are logged and can trigger genesis tasks.
10. Genesis and macro tools are versioned, discoverable, and rollbackable.
11. Environment setup and secret injection work without leaking credentials.

---

## 25) Open Decisions

1. Connector strategy default: Playwright, extension, or hybrid.
2. Default approval mode for new projects.
3. Merge policy default (squash vs rebase).
4. Max parallel workers per project (recommended start: 3).
5. Default verification command packs per archetype.
6. Context rehydration budget and summarization threshold.
7. Preview capture cadence (on-demand vs automatic).
8. Provider routing policy (priority, fallback, fairness).
9. Genesis promotion policy (always require user approval vs policy-based auto-approval).
10. Macro publication scope (project-only vs global workspace).
11. Environment manager defaults per stack.
12. Secret backend default (OS keychain vs encrypted file vault).
13. HTTP proxy policy (allowlist-only vs policy tiers).

---

## 26) Non-Goals (Scope Guard)

Not in core rebuild scope:

- replacing all provider UIs with proprietary models
- cloud-hosted remote execution as default path
- autonomous production deployment without explicit user approval

---

## 27) Tool Genesis (Self-Evolution Engine)

Core idea: the tool runtime is not fixed. Workers can detect capability gaps,
propose new tools, and after evidence + approval, promote those tools to first-class runtime capabilities.

### 27.1 Tool Registry Record

Every tool (core, genesis, macro) must have a registry record:

```json
{
  "tool_id": "uuid",
  "name": "semantic_rename",
  "version": "1.0.0",
  "status": "active",
  "source": "genesis",
  "schema": {
    "input": {},
    "output": {}
  },
  "created_by_task": "uuid",
  "test_receipt_ids": ["uuid"],
  "performance_p50_ms": 240,
  "failure_rate": 0.01
}
```

Versioning conventions:

- core tools use version label `core`
- genesis and macro tools use semantic versions and support rollback

### 27.2 Capability Gap Signal

If a worker cannot complete a task with available tools, it must emit a structured gap signal:

```json
{
  "type": "capability_gap",
  "task_id": "uuid",
  "description": "Need to rename a symbol across all files while preserving imports",
  "workaround_attempted": "regex replacement, failed on aliased imports",
  "proposed_tool_name": "semantic_rename"
}
```

Orchestrator options:

1. route around the gap with existing tools
2. defer and mark dependency
3. open a genesis task

### 27.3 Genesis Task Flow

1. Worker receives genesis task (`task_type = genesis`).
2. Worker implements tool module locally.
3. Worker adds tool tests and fixture cases.
4. Hydra runs tests in sandboxed subprocess.
5. If tests fail, tool remains draft/quarantined.
6. If tests pass, tool moves to `pending_approval`.
7. User/orchestrator approval promotes tool to `active`.
8. Tool becomes available to all workers through registry discovery.

Storage and audit:

- genesis source lives in `.hydra/tools/`
- tests and metadata are persisted with receipts
- promoted tools should be committed with project history unless user policy opts out

### 27.4 Tool Composition (Macros)

Workers can define higher-order tools by composing existing tools:

```json
{
  "type": "macro_tool",
  "name": "git_checkpoint",
  "steps": [
    {
      "tool": "write_file",
      "args": {}
    },
    {
      "tool": "shell",
      "args": {
        "cmd": "git add -A"
      }
    },
    {
      "tool": "shell",
      "args": {
        "cmd": "git commit -m '{{message}}'"
      }
    }
  ]
}
```

Macro policy:

- no source compilation required
- schema validation required
- orchestrator approval required before activation
- versioned and rollbackable

### 27.5 Safety Rules for Genesis

- genesis code runs in sandboxed subprocesses under standard path/resource policy
- genesis tools cannot mutate registry metadata directly
- a genesis tool cannot auto-promote itself
- cross-calling between draft genesis tools is blocked until each passes evidence gate
- promotion requires explicit approval and passing tests

### 27.6 Tool Lifecycle States

`draft -> testing -> pending_approval -> active -> deprecated -> archived`

---

## 28) Tool Registry and Discovery

Workers must discover capabilities before attempting execution.

Required runtime APIs:

- `list_tools` (filter by status/source/category)
- `describe_tool` (schema, version, limits, examples)
- `list_tool_versions` (history + rollback targets)
- `list_capability_gaps` (open and frequent gaps)

Registry metadata requirements:

- input/output schema
- source (`core`, `genesis`, `macro`)
- status and version
- reliability metrics (p50 latency, failure rate)
- safety classification (read-only, side-effect, destructive)

Rollback requirements:

- one-step rollback to last known-good version
- rollback creates receipt and transition record
- active calls pin to resolved tool version for deterministic runs

---

## 29) Environment Manager

Many project failures happen at setup, not coding. Environment management is first-class.

Responsibilities:

- detect project runtime requirements from files
- provision runtime versions (`node`, `python`, etc.)
- create/manage virtual environments (`venv`, `conda`, project-local toolchains)
- install dependencies with lockfile awareness
- expose active environment state to workers and orchestrator

Required tools:

- `detect_environment`
- `ensure_runtime`
- `create_environment`
- `install_dependencies`
- `activate_environment`
- `describe_environment`

Environment evidence:

- runtime versions
- dependency install logs
- lockfile hash
- environment fingerprint attached to task artifacts

---

## 30) Secrets Vault

Secrets handling cannot be an afterthought.

Vault model:

- project-scoped encrypted storage under `.hydra/secrets/` or OS keychain backend
- DB stores references/metadata, never plaintext values
- secrets are injected into subprocess env only at execution time

Required capabilities:

- `set_secret` (write/update)
- `list_secret_refs` (names/scopes only)
- `delete_secret`
- `inject_secret_ref` (bind secret to command/process env)

Security rules:

- secret values are redacted from logs, receipts, previews, and task artifacts
- secret read access follows approval policy and least-privilege scope
- secret usage is auditable (who/when/which task) without exposing values

---

This document is the implementation contract for rebuilding Hydra core logic.
Mission: give browser AI real execution hands, with trust, safety, and repeatable outcomes.
