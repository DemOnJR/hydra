# Hydra Core Rebuild Implementation Plan

This plan translates `CORE-REBUILD-SPEC.md` into executable delivery tracks.

## Phase 1 - Execution Truth Layer

- [x] Add protocol-backed persistence tables (`tool_calls`, `tool_receipts`, `task_artifacts`, `task_transitions`, `task_assignments`)
- [x] Add strict tool call lifecycle service (`requested -> approved/rejected -> executed -> receipted -> attached_to_task`)
- [x] Add request idempotency via `request_id` lookup + cached envelope return
- [x] Add malformed/unknown action structured errors
- [x] Wire Electron tool loop to prepare/finalize API so all side effects emit receipts
- [x] Add completion gate state model (`todo -> in_progress -> in_review -> complete`, plus `blocked`)

## Phase 2 - Process and Feedback Layer

- [x] Add tracked process manager with persistent process table + output stream table
- [x] Add process APIs (`start_process`, `stop_process`, `restart_process`, `read_process_output`, `list_processes`)
- [x] Add preview engine (screenshot + console + network failures) and artifact attachment
- [x] Add verification runner with archetype-aware defaults + task verification artifacts

## Phase 3 - Delegation + Scheduler Core

- [x] Add dependency graph table (`task_dependencies`) and runnable task queries
- [x] Add lease model (`task_assignments` with heartbeat/expiry/revoke)
- [x] Add scheduler API for dispatch/heartbeat/reconcile/snapshot
- [ ] Add automated worktree lifecycle (`.hydra/worktrees/<task-id>/`) and branch isolation
- [ ] Add merge-readiness checks and conflict-resolution task generation

## Phase 4 - Registry, Gaps, Genesis

- [x] Add tool registry/version persistence (`tool_registry`, `tool_versions`)
- [x] Seed core tools into registry on runtime bootstrap
- [x] Add capability gap logging + frequency tracking
- [x] Add genesis and macro persistence + promotion/rollback APIs
- [ ] Add sandboxed genesis test executor and approval queue UX

## Phase 5 - Environment + Secrets

- [x] Add environment profile persistence (`environment_profiles`)
- [x] Add environment tools (`detect_environment`, `ensure_runtime`, `create_environment`, `install_dependencies`, `activate_environment`, `describe_environment`)
- [x] Add project-scoped encrypted vault + secret refs (`secret_refs`)
- [x] Add secret APIs (`set_secret`, `list_secret_refs`, `delete_secret`, `inject_secret_ref`)
- [x] Add secret redaction hook for persisted process/tool outputs

## Phase 6 - Observability + UX Surface

- [x] Add observability metrics endpoint (transitions, tools, processes, gaps, genesis)
- [x] Add per-task debug artifact endpoint (calls, receipts, verification, previews, decision)
- [x] Add tri-mode approval UI toggle (`manual`, `semi-auto`, `auto`) in task broadcast
- [ ] Add full progress dashboard with timeline + capability gap trend view in renderer

## Remaining Critical Items

1. Worktree branch isolation and merge orchestration
2. Recovery orchestration for unfinished tasks after crash with process ownership reconciliation
3. Acceptance test automation for all 12 critical suite cases in the spec
4. End-user wizard/dashboard polish and no-terminal completion walkthrough
