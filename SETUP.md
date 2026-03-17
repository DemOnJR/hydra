# Setup - Hydra

## Requirements

| Component | Minimum |
|---|---|
| Node.js | 20+ |
| npm | 9+ |
| Browser | Chrome, Chromium, or Edge installed |
| OS | Windows 10+, macOS 12+, Ubuntu 20.04+ |

## Installation

```bash
npm install
npm run db:init
```

Playwright is used with the system's real browser.

You do not need to download Playwright browsers if you already have Chrome/Edge installed.

## Environment variables

`.env.example`

```env
CONTEXT_SERVER_HOST=127.0.0.1
CONTEXT_SERVER_PORT=3847
DB_PATH=
HYDRA_HOME=
DEBUG=false
LOCAL_SECRET=
TELEMETRY=false
```

## Runtime data

Hydra keeps per-user runtime data outside the repo by default:

- Windows: `%LOCALAPPDATA%\\Hydra`
- macOS: `~/Library/Application Support/Hydra`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/hydra`

Inside that directory you will find the SQLite database, browser sessions/profiles, per-project agent journals, and imported local debug logs.

Notes:
- `HYDRA_HOME` overrides the whole runtime directory.
- `DB_PATH` overrides only the SQLite file location.
- API keys stay in the OS keychain via `keytar`, not in the repo.

## Running

Development:

```bash
npm run dev
```

Local production:

```bash
npm run build:renderer
npm run start
```

## First login for an agent

1. Start Hydra.
2. Create a project.
3. Create an agent.
4. Press `Open browser`.
5. A real browser controlled by Playwright opens.
6. Log in manually as usual.
7. Press `Check session` in Hydra.
8. After that you can send tasks.

## Useful structure

```text
src/main/chromeFinder.js
src/main/playwrightManager.js
injectors/chatgpt.js
injectors/claude.js
injectors/gemini.js
```

## Troubleshooting

### Browser not found

Make sure you have one of the following installed:
- Google Chrome
- Chromium
- Microsoft Edge

### `better-sqlite3` ABI error

Run:

```bash
npm install
```

and start the application through the project scripts, not with mixed runtimes.

### Login not working

We no longer use `webview`.

If a platform still refuses login:
- use the real browser opened by Playwright
- disable VPN/proxy if present
- try a different network
- update your system browser

### Injection selectors broken

Update the platform adapter in `injectors/*.js`.
