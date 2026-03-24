# 01 - System Overview

## Runtime shape

Hydra has three major runtime areas:

1. Electron renderer (React UI)
2. Electron main process (IPC, browser control, process orchestration)
3. Local Context Server (Express + SQLite + MCP)

## High-level map

- UI and components: [[11 - Renderer UI]]
- Main orchestration and tools: [[10 - Electron Main Process]]
- API, DB, and MCP: [[12 - Context Server]] and [[14 - Data and Storage]]
- Browser session model: [[13 - Browser Automation]]
- End-to-end behavior: [[20 - Core Flows]]

## Key design choices

- Uses real Chrome/Edge/Chromium via Playwright CDP for reliable logins and session persistence.
- Keeps data local-first with SQLite.
- Uses localhost communication between UI and server.
