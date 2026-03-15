# Task Manager - AgentSync

Task Manager-ul opereaza acum peste sesiuni Playwright, nu peste `webview`.

## Concepte

- `Task` - prompt trimis catre un agent, cu contextul proiectului atasat
- `Broadcast` - acelasi task catre mai multi agenti
- `Queue` - task-uri in asteptare per agent
- `ResponseCollector` - raspunsurile complete colectate dupa executia Playwright

## Flux

```text
User scrie task
  -> selecteaza agentii
  -> renderer cere main process sa trimita task-ul
  -> main process construieste promptul complet
  -> Playwright injecteaza promptul
  -> Playwright asteapta raspunsul
  -> task-ul este marcat complete
  -> renderer afiseaza raspunsul
```

## Hook-ul principal

`src/renderer/hooks/useTaskManager.js`

Responsabilitati:
- tine cozi per agent
- marcheaza agentii ca `working`, `done`, `error`
- adauga raspunsurile in `responses`
- trimite urmatorul task din coada

## Componente

### TaskBroadcast

- selecteaza agentii tinta
- trimite acelasi task la unul sau mai multi agenti

### ResponseCollector

- afiseaza raspunsurile colectate
- permite `Save to KB`

## Diferenta fata de modelul vechi

Vechiul model:
- injectie in `webview`
- detectie raspuns prin observer in renderer

Modelul nou:
- injectie si asteptare raspuns in main process prin Playwright
- renderer primeste doar rezultatul final si statusurile

