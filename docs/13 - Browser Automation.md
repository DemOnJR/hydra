# 13 - Browser Automation

Hydra controls real browsers using Playwright over CDP.

## Why this model

- Better login compatibility than embedded webviews
- Persistent session profiles per agent
- More robust selectors/actions for prompt injection and response capture

## Primary files

- `src/main/playwrightManager.js` - launch/connect/manage browser sessions
- `src/main/chromeFinder.js` - locate local browsers
- `src/main/platformUrls.js` - platform URL mapping
- `injectors/chatgpt.js` - ChatGPT interaction adapter
- `injectors/claude.js` - Claude interaction adapter
- `injectors/gemini.js` - Gemini interaction adapter
- `injectors/registry.js` - provider registration map

## Common edit paths

- Selectors broke after site update -> edit matching file in `injectors/`
- Browser not found -> check `src/main/chromeFinder.js`
- Session lifecycle bug -> `src/main/playwrightManager.js`

## Related notes

- [[10 - Electron Main Process]]
- [[20 - Core Flows]]
