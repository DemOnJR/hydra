# Context Injection - Playwright Adapters

Contextul nu mai este injectat prin `executeJavaScript` in `webview`.

Acum folosim adaptoare Playwright per platforma.

## Principiu

```text
1. Deschide pagina agentului in browser real
2. Gaseste editorul platformei
3. Umple promptul cu Playwright locator/fill
4. Apasa butonul Send
5. Asteapta terminarea raspunsului
6. Citeste ultimul raspuns din DOM
```

## Fisiere

```text
injectors/
|-- chatgpt.js
|-- claude.js
`-- gemini.js
```

Fiecare adaptor exporta:
- `inject(page, prompt)`
- `waitForResponse(page, timeoutMs)`
- `isLoggedIn(page)`

## ChatGPT

Strategie:
- cauta `#prompt-textarea` sau fallback-uri
- foloseste `locator.fill(prompt)`
- incearca butonul Send
- fallback la `Enter`
- asteapta disparitia butonului Stop

## Claude

Strategie:
- cauta editor ProseMirror sau alte variante
- injecteaza prin `fill`
- trimite prin submit sau Enter
- asteapta disparitia butonului Stop

## Gemini

Strategie:
- cauta editorul rich text
- injecteaza prin `fill`
- trimite prin buton sau Enter
- asteapta disparitia indicatorului de generare

## Login detection

`isLoggedIn(page)` este o euristica bazata pe URL-ul curent.

Este suficienta pentru MVP:
- ChatGPT: fara `/auth` sau `/login`
- Claude: fara `/login` sau `/signup`
- Gemini: fara `/signin` sau `/auth`

## Cand se strica selectorii

Actualizezi adaptorul platformei afectate din `injectors/*.js`.

Nu mai exista manager separat de `webview` si nici `executeJavaScript` brut in renderer.

