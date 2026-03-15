# AI Caller — Abstracție pentru GPT, Claude, Gemini — Hydra

Un layer care unifică API-urile de la OpenAI, Anthropic și Google. Poți folosi orice model pentru orice agent din pipeline.

---

## Caller unificat — `server/ai/caller.js`

```javascript
const OpenAI = require('openai')
const Anthropic = require('@anthropic-ai/sdk')

/**
 * Apelează orice model AI cu o interfață unificată.
 *
 * @param {object} options
 * @param {string} options.model - 'gpt-4o' | 'claude-opus-4-5' | 'claude-sonnet-4-6'
 * @param {string} options.systemPrompt
 * @param {Array}  options.messages
 * @param {Array}  options.tools - tool definitions (format OpenAI)
 * @param {string} options.responseFormat - 'text' | 'json'
 */
async function callAI({ model, systemPrompt, messages, tools = [], responseFormat = 'text' }) {
  if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) {
    return callOpenAI({ model, systemPrompt, messages, tools, responseFormat })
  }

  if (model.startsWith('claude')) {
    return callClaude({ model, systemPrompt, messages, tools, responseFormat })
  }

  throw new Error(`Model necunoscut: ${model}`)
}

// ─── OpenAI ─────────────────────────────────────────────────

async function callOpenAI({ model, systemPrompt, messages, tools, responseFormat }) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const params = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    max_tokens: 4096,
  }

  if (tools.length > 0) {
    params.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: t.parameters,
          required: Object.keys(t.parameters),
        },
      },
    }))
    params.tool_choice = 'auto'
  }

  if (responseFormat === 'json') {
    params.response_format = { type: 'json_object' }
  }

  const response = await client.chat.completions.create(params)
  const choice = response.choices[0]

  return {
    text: choice.message.content || '',
    toolCalls: choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      params: JSON.parse(tc.function.arguments),
    })) || [],
    usage: response.usage,
    finishReason: choice.finish_reason,
  }
}

// ─── Anthropic Claude ────────────────────────────────────────

async function callClaude({ model, systemPrompt, messages, tools, responseFormat }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Convertește tool definitions din format OpenAI în format Claude
  const claudeTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      properties: t.parameters,
      required: Object.keys(t.parameters),
    },
  }))

  const systemContent = responseFormat === 'json'
    ? systemPrompt + '\n\nRăspunde DOAR cu JSON valid. Fără text în afara JSON-ului.'
    : systemPrompt

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemContent,
    messages,
    tools: claudeTools.length > 0 ? claudeTools : undefined,
  })

  const textBlocks = response.content.filter(b => b.type === 'text')
  const toolBlocks = response.content.filter(b => b.type === 'tool_use')

  return {
    text: textBlocks.map(b => b.text).join(''),
    toolCalls: toolBlocks.map(b => ({
      id: b.id,
      name: b.name,
      params: b.input,
    })),
    usage: response.usage,
    finishReason: response.stop_reason,
  }
}

module.exports = { callAI }
```

---

## Configurare modele per agent — `server/ai/modelConfig.js`

Fiecare agent din pipeline poate folosi un model diferit. Configurabil din UI.

```javascript
// Configurare implicită — poate fi schimbată din Settings
const DEFAULT_MODELS = {
  orchestrator: 'gpt-4o',          // Cel mai bun la planificare
  builder: 'claude-opus-4-5',      // Excelent la scriere cod
  reviewer: 'claude-sonnet-4-6',   // Rapid și precis la review
  tester: 'gpt-4o',                // Bun la interpretare output teste
}

function getModelForAgent(agentType, userConfig = {}) {
  return userConfig[agentType] || DEFAULT_MODELS[agentType]
}

module.exports = { DEFAULT_MODELS, getModelForAgent }
```

---

## Gestionarea API keys — `server/ai/keyManager.js`

```javascript
const keytar = require('keytar')  // OS keychain — securizat

const SERVICE_NAME = 'hydra-ai'

async function saveApiKey(provider, key) {
  await keytar.setPassword(SERVICE_NAME, provider, key)
}

async function getApiKey(provider) {
  return await keytar.getPassword(SERVICE_NAME, provider)
}

async function deleteApiKey(provider) {
  await keytar.deletePassword(SERVICE_NAME, provider)
}

// La pornire, setează variabilele de mediu din keychain
async function loadApiKeys() {
  const openaiKey = await getApiKey('openai')
  const anthropicKey = await getApiKey('anthropic')

  if (openaiKey) process.env.OPENAI_API_KEY = openaiKey
  if (anthropicKey) process.env.ANTHROPIC_API_KEY = anthropicKey

  return {
    hasOpenAI: !!openaiKey,
    hasAnthropic: !!anthropicKey,
  }
}

module.exports = { saveApiKey, getApiKey, deleteApiKey, loadApiKeys }
```

---

## Care model pentru ce task

| Agent | Model recomandat | Motiv |
|-------|-----------------|-------|
| Orchestrator | GPT-4o sau Claude Opus | Planificare complexă, raționament |
| Builder | Claude Opus 4.5 | Scriere cod de calitate, urmărire instrucțiuni |
| Reviewer | Claude Sonnet 4.6 | Rapid, precis, bun la identificat probleme |
| Tester | GPT-4o | Interpretare output teste, debugging |

---

## Cost estimativ per ciclu pipeline

Un ciclu complet Builder → Reviewer → Tester pentru un task mediu:

| Agent | Tokeni input | Tokeni output | Cost estimativ |
|-------|-------------|--------------|----------------|
| Builder (Claude Opus) | ~8,000 | ~2,000 | ~$0.12 |
| Reviewer (Claude Sonnet) | ~4,000 | ~1,000 | ~$0.01 |
| Tester (GPT-4o) | ~2,000 | ~500 | ~$0.01 |
| **Total per ciclu** | | | **~$0.14** |

Pentru un proiect cu 10 task-uri/zi → ~$1.4/zi → ~$42/lună.

Dacă folosești modele mai mici (GPT-4o-mini, Claude Haiku) pentru task-uri simple, costul scade semnificativ.
