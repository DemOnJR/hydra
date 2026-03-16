# Setup - AgentSync

## Cerinte

| Componenta | Minim |
|---|---|
| Node.js | 20+ |
| npm | 9+ |
| Browser | Chrome, Chromium sau Edge instalat |
| OS | Windows 10+, macOS 12+, Ubuntu 20.04+ |

## Instalare

```bash
npm install
npm run db:init
```

Playwright este folosit cu browserul real al sistemului.

Nu este necesar sa descarci browserele Playwright daca folosesti Chrome/Edge deja instalat.

## Variabile de mediu

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

## Rulare

Development:

```bash
npm run dev
```

Productie locala:

```bash
npm run build:renderer
npm run start
```

## Primul login pentru un agent

1. Pornesti AgentSync.
2. Creezi proiectul.
3. Creezi agentul.
4. Apesi `Open browser`.
5. Se deschide browserul real controlat de Playwright.
6. Faci login manual normal.
7. Apesi `Check session` in AgentSync.
8. Dupa asta poti trimite task-uri.

## Structura utila

```text
src/main/chromeFinder.js
src/main/playwrightManager.js
injectors/chatgpt.js
injectors/claude.js
injectors/gemini.js
```

## Troubleshooting

### Browserul nu este gasit

Verifica sa ai instalat:
- Google Chrome
- Chromium
- Microsoft Edge

### `better-sqlite3` are eroare de ABI

Ruleaza:

```bash
npm install
```

si porneste aplicatia prin scripturile proiectului, nu cu runtime-uri amestecate.

### Login-ul nu trece

Nu mai folosim `webview`.

Daca o platforma refuza in continuare login-ul:
- foloseste browserul real deschis de Playwright
- dezactiveaza VPN/proxy daca exista
- incearca alta retea
- actualizeaza browserul sistemului

### Selectorii de injectie s-au stricat

Actualizeaza adaptorul platformei din `injectors/*.js`.
