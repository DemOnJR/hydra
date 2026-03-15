# Playwright Browser Management — Hydra

Înlocuiește abordarea cu `<webview>` Electron. În loc să folosim webview-uri izolate (care pică Cloudflare Turnstile), lansăm Chrome-ul real al userului prin Playwright și controlăm contextele izolate prin CDP.

---

## De ce Playwright și nu webview Electron

| | Electron webview | Playwright + Chrome real |
|--|--|--|
| Cloudflare Turnstile | ❌ Pică | ✅ Trece |
| Sesiuni izolate | ✅ | ✅ |
| Injectare JS | ✅ | ✅ (mai puternic) |
| Fingerprint browser | ❌ Detectabil | ✅ Chrome real |
| Persistență sesiune | ✅ | ✅ |
| Vizibil pentru user | ✅ | ✅ (ferestre Chrome) |

---

## Instalare

```bash
npm install playwright

# Playwright vine cu browsere proprii (Chromium, Firefox, WebKit)
# DAR noi vrem Chrome-ul REAL al userului — nu instalăm browsere Playwright
npx playwright install-deps  # doar dependențe sistem, nu browsere
```

---

## Găsirea Chrome-ului instalat — `src/main/chromeFinder.js`

```javascript
const fs = require('fs')
const os = require('os')

function findChromePath() {
  const platform = os.platform()

  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    ],
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ],
  }

  const paths = candidates[platform] || []

  for (const p of paths) {
    if (fs.existsSync(p)) return p
  }

  throw new Error(
    'Chrome nu a fost găsit. Instalează Google Chrome și repornește aplicația.'
  )
}

module.exports = { findChromePath }
```

---

## Playwright Manager — `src/main/playwrightManager.js`

Modulul central care gestionează toate contextele (sesiunile izolate per agent).

```javascript
const { chromium } = require('playwright')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { findChromePath } = require('./chromeFinder')

// Directorul unde stocăm sesiunile persistate
const SESSIONS_DIR = path.join(os.homedir(), '.hydra', 'sessions')

// Map: agentId → { context, page }
const activeContexts = new Map()

let browser = null

/**
 * Pornește browserul Chrome real.
 * Un singur proces Chrome, mai multe contexte izolate.
 */
async function launchBrowser() {
  if (browser) return browser

  fs.mkdirSync(SESSIONS_DIR, { recursive: true })

  const executablePath = findChromePath()
  console.log(`[Playwright] Folosesc Chrome de la: ${executablePath}`)

  browser = await chromium.launch({
    executablePath,
    headless: false,        // Vizibil — userul vede și interacționează
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions-except',  // permite extensii de-ale noastre dacă vrem
    ],
  })

  browser.on('disconnected', () => {
    console.log('[Playwright] Browserul s-a închis')
    browser = null
    activeContexts.clear()
  })

  return browser
}

/**
 * Creează sau refolosește un context izolat pentru un agent.
 * Fiecare context = sesiune separată (cookies, localStorage, etc.)
 * Sesiunea e persistată pe disk între restartări.
 */
async function getOrCreateContext(agentId) {
  if (activeContexts.has(agentId)) {
    return activeContexts.get(agentId)
  }

  const b = await launchBrowser()
  const sessionPath = path.join(SESSIONS_DIR, `agent-${agentId}`)

  // storageState persistă cookies + localStorage pe disk
  // La prima rulare fișierul nu există — context curat (user face login)
  const storageStatePath = path.join(sessionPath, 'storage.json')
  const hasExistingSession = fs.existsSync(storageStatePath)

  const context = await b.newContext({
    storageState: hasExistingSession ? storageStatePath : undefined,
    viewport: { width: 1280, height: 800 },
    userAgent: undefined, // Folosește user-agent-ul real Chrome — important pentru Turnstile
    locale: 'en-US',
  })

  // Salvează sesiunea pe disk la fiecare schimbare (login, cookie refresh etc.)
  context.on('page', async () => {
    await saveSession(context, agentId)
  })

  // Pagina principală pentru acest agent
  const page = await context.newPage()

  const agent = { context, page, agentId }
  activeContexts.set(agentId, agent)

  return agent
}

/**
 * Navighează agentul la platforma sa și îl pregătește.
 * Dacă nu e logat, userul face login manual în fereastra Chrome.
 */
async function openAgent(agentId, platformUrl) {
  const { page } = await getOrCreateContext(agentId)

  // Verifică dacă pagina e deja pe platformă
  if (!page.url().startsWith(platformUrl)) {
    await page.goto(platformUrl, { waitUntil: 'domcontentloaded' })
  }

  // Aduce fereastra în față
  await page.bringToFront()

  return page
}

/**
 * Injectează un prompt în pagina agentului.
 * Returnează true dacă a reușit.
 */
async function injectPrompt(agentId, platform, prompt) {
  const { page } = await getOrCreateContext(agentId)

  // Importă injector-ul specific platformei
  const injector = require(`../../injectors/${platform}`)
  return await injector.inject(page, prompt)
}

/**
 * Așteaptă și colectează răspunsul agentului.
 * Returnează textul răspunsului când generarea s-a terminat.
 */
async function waitForResponse(agentId, platform, timeoutMs = 120000) {
  const { page } = await getOrCreateContext(agentId)
  const collector = require(`../../injectors/${platform}`)
  return await collector.waitForResponse(page, timeoutMs)
}

/**
 * Salvează sesiunea curentă pe disk.
 */
async function saveSession(context, agentId) {
  const sessionPath = path.join(SESSIONS_DIR, `agent-${agentId}`)
  fs.mkdirSync(sessionPath, { recursive: true })
  await context.storageState({
    path: path.join(sessionPath, 'storage.json')
  })
}

/**
 * Salvează toate sesiunile active.
 * Apelat înainte de închiderea aplicației.
 */
async function saveAllSessions() {
  for (const [agentId, { context }] of activeContexts) {
    await saveSession(context, agentId)
  }
}

/**
 * Închide contextul unui agent (fără să închidă browserul).
 */
async function closeAgent(agentId) {
  const agent = activeContexts.get(agentId)
  if (!agent) return

  await saveSession(agent.context, agentId)
  await agent.context.close()
  activeContexts.delete(agentId)
}

/**
 * Închide tot — apelat la quit aplicație.
 */
async function shutdown() {
  await saveAllSessions()
  if (browser) await browser.close()
}

module.exports = {
  launchBrowser,
  getOrCreateContext,
  openAgent,
  injectPrompt,
  waitForResponse,
  closeAgent,
  shutdown,
}
```

---

## Injector ChatGPT cu Playwright — `injectors/chatgpt.js`

Cu Playwright ai acces la metode mult mai robuste decât `executeJavaScript` raw.

```javascript
/**
 * Injectează un prompt în ChatGPT și apasă Send.
 * @param {import('playwright').Page} page
 * @param {string} prompt
 */
async function inject(page, prompt) {
  // Asteaptă ca pagina să fie gata
  await page.waitForLoadState('domcontentloaded')

  // Selectori în ordine de preferință
  const editorSelectors = [
    '#prompt-textarea',
    'div[contenteditable="true"]',
    'textarea[placeholder]',
  ]

  let editor = null
  for (const sel of editorSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 })
      editor = page.locator(sel).first()
      break
    } catch {
      continue
    }
  }

  if (!editor) throw new Error('[ChatGPT] Nu am găsit câmpul de input')

  // Click pentru focus
  await editor.click()

  // Playwright fill() funcționează cu React controlled inputs
  // Mult mai fiabil decât executeJavaScript cu synthetic events
  await editor.fill(prompt)

  // Mică pauză — lasă React să proceseze
  await page.waitForTimeout(300)

  // Apasă butonul Send
  const sendSelectors = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]',
  ]

  for (const sel of sendSelectors) {
    const btn = page.locator(sel).first()
    if (await btn.isVisible() && await btn.isEnabled()) {
      await btn.click()
      return true
    }
  }

  // Fallback: Enter
  await editor.press('Enter')
  return true
}

/**
 * Așteaptă să termine generarea și returnează răspunsul.
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 */
async function waitForResponse(page, timeoutMs = 120000) {
  const startTime = Date.now()

  // Așteaptă să apară butonul Stop (înseamnă că a început generarea)
  try {
    await page.waitForSelector('[data-testid="stop-button"]', { timeout: 10000 })
  } catch {
    // Poate a generat deja rapid — continuăm
  }

  // Așteaptă să dispară butonul Stop (înseamnă că a terminat)
  await page.waitForSelector('[data-testid="stop-button"]', {
    state: 'detached',
    timeout: timeoutMs,
  })

  // Ia ultimul răspuns
  const responseEl = page.locator('[data-message-author-role="assistant"]').last()
  const text = await responseEl.innerText()

  return text
}

module.exports = { inject, waitForResponse }
```

---

## Injector Gemini cu Playwright — `injectors/gemini.js`

```javascript
async function inject(page, prompt) {
  await page.waitForLoadState('domcontentloaded')

  const editorSelectors = [
    'div[contenteditable="true"].ql-editor',
    'rich-textarea div[contenteditable]',
    'div[role="textbox"]',
  ]

  let editor = null
  for (const sel of editorSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 })
      editor = page.locator(sel).first()
      break
    } catch { continue }
  }

  if (!editor) throw new Error('[Gemini] Nu am găsit câmpul de input')

  await editor.click()
  await editor.fill(prompt)
  await page.waitForTimeout(400)

  // Send button Gemini
  const sendBtn = page.locator('button[aria-label="Send message"]').first()
  if (await sendBtn.isVisible() && await sendBtn.isEnabled()) {
    await sendBtn.click()
    return true
  }

  await editor.press('Enter')
  return true
}

async function waitForResponse(page, timeoutMs = 120000) {
  // Gemini arată un spinner când generează
  try {
    await page.waitForSelector('.loading-indicator, [aria-label="Gemini is thinking"]', {
      timeout: 10000
    })
  } catch {}

  await page.waitForSelector('.loading-indicator, [aria-label="Gemini is thinking"]', {
    state: 'detached',
    timeout: timeoutMs,
  })

  const responseEl = page.locator('model-response').last()
  return await responseEl.innerText()
}

module.exports = { inject, waitForResponse }
```

---

## Integrare în Electron IPC — `src/main/ipcHandlers.js` (update)

```javascript
const playwright = require('./playwrightManager')

// Deschide agentul (navighează la platformă)
ipcMain.handle('open-agent', async (event, { agentId, platform }) => {
  const urls = {
    chatgpt: 'https://chat.openai.com',
    gemini: 'https://gemini.google.com',
    claude: 'https://claude.ai',
  }
  await playwright.openAgent(agentId, urls[platform])
  return { success: true }
})

// Trimite task cu context la agent
ipcMain.handle('send-task-to-agent', async (event, { agentId, platform, projectId, task }) => {
  const context = await fetchContext(projectId)
  const fullPrompt = context ? `[PROJECT CONTEXT]\n${context}\n[END]\n\n${task}` : task

  await playwright.injectPrompt(agentId, platform, fullPrompt)
  return { success: true }
})

// Colectează răspunsul
ipcMain.handle('collect-response', async (event, { agentId, platform }) => {
  const response = await playwright.waitForResponse(agentId, platform)
  return { response }
})

// La închiderea aplicației
app.on('before-quit', async () => {
  await playwright.shutdown()
})
```

---

## Flow complet: primul login al unui agent

```
1. User apasă "Adaugă agent" în Hydra UI
2. Alege platforma (ChatGPT) și dă un nume ("GPT cont #1")
3. Aplicația apelează openAgent(agentId, 'https://chat.openai.com')
4. Playwright deschide un context Chrome curat (fără sesiune)
5. O fereastră Chrome reală se deschide pe chat.openai.com
6. Userul face LOGIN MANUAL normal în acea fereastră
   → Turnstile vede Chrome real → trece
7. După login, Hydra detectează că e autentificat (verifică URL sau cookie)
8. Salvează sesiunea: context.storageState({ path: 'sessions/agent-X.json' })
9. Data viitoare când lansezi aplicația, sesiunea e restaurată automat
   → Userul nu mai trebuie să se logheze din nou
```

---

## Considerații importante

**Un singur proces Chrome, contexte multiple** — Playwright pornește un singur proces Chrome cu mai multe contexte izolate. E mai eficient decât N procese Chrome separate. Fiecare context are cookies/storage proprii, dar împart același proces.

**Ferestrele Chrome sunt separate de UI-ul Electron** — nu poți "embeda" o fereastră Chrome în Electron. Soluții:
- Aranjezi ferestrele alăturat (Hydra stânga, Chrome dreapta)
- Folosești screenshot-uri din Playwright și le afișezi în Electron (mai lent, mai complex)
- Accepți că sunt ferestre separate și gestionezi asta prin taskbar

**Detecție automată login** — după ce userul se loghează, verifici:
```javascript
// Verifică dacă userul e logat pe ChatGPT
async function isLoggedIn(page) {
  const url = page.url()
  return url.includes('chat.openai.com') && !url.includes('/auth/')
}
```

**Persistența sesiunii** — `storageState` salvează cookies + localStorage. Pentru ChatGPT, sesiunea durează de obicei câteva săptămâni înainte să expire.
