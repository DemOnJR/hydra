# Notificări & Approval System — Hydra

Când ești plecat de la PC, Hydra îți trimite notificări și îți permite să aprobi sau respingi modificările de pe telefon.

---

## Canale de notificare — `server/orchestrator/notifier.js`

```javascript
const db = require('../db/queries')

async function notifyUser(projectId, eventType, data) {
  const project = db.getProjectById(projectId)
  const settings = db.getNotificationSettings(projectId)

  const message = buildMessage(eventType, data, project)

  const promises = []

  if (settings.discord_webhook) {
    promises.push(sendDiscord(settings.discord_webhook, message, data))
  }

  if (settings.telegram_token && settings.telegram_chat_id) {
    promises.push(sendTelegram(settings.telegram_token, settings.telegram_chat_id, message, data))
  }

  if (settings.email) {
    promises.push(sendEmail(settings.email, message, data))
  }

  // Salvează întotdeauna în DB pentru UI-ul local
  db.saveNotification(projectId, eventType, message, data)

  await Promise.allSettled(promises)
}

function buildMessage(eventType, data, project) {
  const messages = {
    approval_required: `
🔔 **${project.name}** — Aprobare necesară

Task: **${data.task?.title}**
Branch: \`${data.branch}\`
${data.autoApproveIn ? `⏱ Se aprobă automat în ${data.autoApproveIn}` : ''}

✅ Aprobă: ${data.approveUrl}
❌ Respinge: ${data.rejectUrl}
    `.trim(),

    session_complete: `
✅ **${project.name}** — Sesiune terminată

${data.message}
Cicluri rulate: ${data.cycles}
    `.trim(),

    pipeline_failed: `
❌ **${project.name}** — Pipeline eșuat

Task: ${data.task?.title}
Motiv: ${data.reason}
Branch: \`${data.branch}\`

Verifică aplicația pentru detalii.
    `.trim(),

    session_error: `
⚠️ **${project.name}** — Eroare orchestrator

${data.message}
Eroare: ${data.error}
    `.trim(),
  }

  return messages[eventType] || `Eveniment: ${eventType}`
}

// ─── Discord ────────────────────────────────────────────────

async function sendDiscord(webhookUrl, message, data) {
  const buttons = []

  if (data.approveUrl) {
    // Discord nu suportă butoane în webhooks normale
    // Linkurile sunt clickabile direct în mesaj
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: message,
      username: 'Hydra',
    }),
  })
}

// ─── Telegram ───────────────────────────────────────────────

async function sendTelegram(token, chatId, message, data) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`

  // Telegram suportă butoane inline — perfect pentru approve/reject
  const replyMarkup = data.approveUrl ? {
    inline_keyboard: [[
      { text: '✅ Aprobă', url: data.approveUrl },
      { text: '❌ Respinge', url: data.rejectUrl },
    ]]
  } : undefined

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
    }),
  })
}

// ─── Email (via Resend sau SMTP) ────────────────────────────

async function sendEmail(toEmail, message, data) {
  // Folosim Resend — API simplu, gratuit până la 3000 emails/lună
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'hydra@tudomeniu.com',
      to: toEmail,
      subject: `Hydra: ${data.task?.title || 'Notificare'}`,
      html: `<pre>${message}</pre>
        ${data.approveUrl ? `
          <a href="${data.approveUrl}" style="background:#1D9E75;color:white;padding:10px 20px;text-decoration:none;border-radius:6px">✅ Aprobă</a>
          &nbsp;
          <a href="${data.rejectUrl}" style="background:#D85A30;color:white;padding:10px 20px;text-decoration:none;border-radius:6px">❌ Respinge</a>
        ` : ''}
      `,
    }),
  })
}

module.exports = { notifyUser }
```

---

## Approval Endpoints — `server/routes/approval.js`

Endpoint-urile pe care le deschizi de pe telefon pentru a aproba sau respinge.

```javascript
const router = require('express').Router()
const db = require('../db/queries')

// GET /approve/:sessionId — aprobă din link (email/telegram/discord)
router.get('/approve/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const session = db.getSession(sessionId)

  if (!session) {
    return res.status(404).send('Sesiunea nu a fost găsită.')
  }

  if (session.status !== 'waiting_approval') {
    return res.send(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>⚠️ Sesiunea nu mai așteaptă aprobare</h2>
        <p>Status: ${session.status}</p>
      </body></html>
    `)
  }

  db.setSessionDecision(sessionId, 'approved')

  res.send(`
    <html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>✅ Aprobat!</h2>
      <p>Pipeline-ul va continua cu merge în main.</p>
      <p style="color:#888">Poți închide această pagină.</p>
    </body></html>
  `)
})

// GET /reject/:sessionId — respinge din link
router.get('/reject/:sessionId', (req, res) => {
  const { sessionId } = req.params
  db.setSessionDecision(sessionId, 'rejected')

  res.send(`
    <html><body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>❌ Respins</h2>
      <p>Orchestratorul va reîncerca cu o altă abordare.</p>
      <p style="color:#888">Poți închide această pagină.</p>
    </body></html>
  `)
})

// GET /approval/:sessionId — pagina de detalii (mai multe info)
router.get('/approval/:sessionId', (req, res) => {
  const { sessionId } = req.params
  const session = db.getSession(sessionId)
  const logs = db.getSessionLogs(sessionId)

  res.send(`
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
        .task { background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0; }
        .log { font-size: 12px; font-family: monospace; background: #1a1a1a; color: #0f0; padding: 12px; border-radius: 6px; max-height: 200px; overflow-y: auto; }
        .btn { display: inline-block; padding: 14px 28px; border-radius: 8px; color: white; text-decoration: none; font-size: 16px; margin: 8px; }
        .approve { background: #1D9E75; }
        .reject { background: #D85A30; }
      </style>
    </head>
    <body>
      <h1>🔔 Aprobare necesară</h1>
      <div class="task">
        <strong>Task:</strong> ${session.task_title}<br>
        <strong>Branch:</strong> <code>${session.branch}</code><br>
        <strong>Status:</strong> ${session.status}
      </div>

      <h3>Log pipeline:</h3>
      <div class="log">${logs.map(l => `${l.ts}: ${l.msg}`).join('\n')}</div>

      <div style="text-align:center;margin-top:24px">
        <a href="/approve/${sessionId}" class="btn approve">✅ Aprobă merge</a>
        <a href="/reject/${sessionId}" class="btn reject">❌ Respinge</a>
      </div>
    </body>
    </html>
  `)
})

module.exports = router
```

---

## Expunere externă cu Tailscale (acces de pe telefon)

Serverul rulează pe `localhost:3847`. Pentru a accesa linkurile de approve/reject de pe telefon când ești plecat:

### Opțiunea 1: Tailscale (recomandat — gratuit, simplu)

```bash
# Instalează Tailscale
brew install tailscale  # macOS

# Conectează-te
tailscale up

# Adresa ta Tailscale (fixă, nu se schimbă)
# Ex: http://100.64.0.1:3847/approve/session-123
```

Linkurile din notificări vor folosi adresa Tailscale în loc de localhost.

### Opțiunea 2: ngrok (pentru test rapid)

```bash
ngrok http 3847
# Îți dă o adresă temporară: https://abc123.ngrok.io
```

### Configurare în `.env`

```env
# URL-ul public al serverului (pentru linkuri în notificări)
# localhost = accesibil doar de pe PC
# Tailscale IP = accesibil de pe orice device din rețeaua ta Tailscale
PUBLIC_URL=http://100.64.0.1:3847

DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
RESEND_API_KEY=...
```

---

## Dashboard notificări în UI — Electron

```jsx
// src/renderer/components/NotificationCenter.jsx
export function NotificationCenter({ projectId }) {
  const [notifications, setNotifications] = useState([])

  useEffect(() => {
    // Polling la notificări noi
    const interval = setInterval(async () => {
      const notifs = await window.agentSync.getNotifications(projectId)
      setNotifications(notifs)
    }, 5000)
    return () => clearInterval(interval)
  }, [projectId])

  return (
    <div className="notification-center">
      {notifications.map(n => (
        <div key={n.id} className={`notif notif-${n.type}`}>
          <div className="notif-message">{n.message}</div>
          {n.type === 'approval_required' && (
            <div className="notif-actions">
              <button onClick={() => approve(n.session_id)} className="btn-approve">
                ✅ Aprobă
              </button>
              <button onClick={() => reject(n.session_id)} className="btn-reject">
                ❌ Respinge
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```
