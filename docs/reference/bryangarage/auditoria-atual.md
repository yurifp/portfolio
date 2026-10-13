# Auditoria da implementação atual (3 janelas + SHAFT RUNNER)

> Método: leitura de código (`game-host.ts`, `windows-shell.ts`, `shaft-runner/*`) +
> partida ao vivo com automação (foco, teclas, aba oculta, resume, som).
> Estado base: commit 711aa53; suites shaft 13/13, layout 6/6.

## Estrutura hoje
- `Windows.astro` + `windows-shell.ts`: 3 janelas sobre a cena LED (W1 jogo, W2 terminal
  de eventos, W3 telemetria), scrub por progresso, W1 dimensionada pelo canvas.
- `game-host.ts`: foco/captura/loop 60 Hz fixo + overlay mobile + telemetria W3.
- `src/games/shaft-runner/`: motor determinístico 216×384 (data/layout/world/index).

## Bugs e lacunas reproduzíveis/verificáveis

| # | Achado | Causa provável | Onde |
|---|---|---|---|
| 1 | **SFX do jogo nunca tocam**, mesmo com SOUND ON do site | `module.mount({ audio: { enabled: false } })` e **ninguém nunca flipa** esse objeto quando o toggle do site muda | `game-host.ts:363` |
| 2 | **Tecla pode ficar presa após aba oculta/perder foco**: `visibilitychange` pausa mas **não zera `input`**; `keyup` não é entregue a página oculta em todos os SOs; o "pulse" de 100 ms do keyup não cobre blur | handler de pausa não limpa o estado de entrada | `game-host.ts:427`, `onKeyUp` `game-host.ts:88-94` |
| 3 | **Telemetria W3 incompleta**: os gráficos DROPS e SCROLL % ficam vazios — `dropSeries`/`scrollSeries` **nunca recebem push** (só `frameTimes` alimenta) | série declarada, sem produtor de dados | `game-host.ts:246-248, 304-307` |
| 4 | **rAF eterno**: `telemLoop` roda para sempre (mesmo janela fechada/fora da cena) — guarda `is-live` evita render, mas acorda a cada frame desde a carga | loop sem cancelamento | `game-host.ts:438-449` |
| 5 | **Pausa agressiva no resize**: qualquer resize (inclui mostrar/esconder barra de URL no mobile) pausa o jogo em foco | handler `resize` → setMode('paused') incondicional | `game-host.ts:428` |
| 6 | **Código morto/lógica nada operante**: `loopFrame` linha do `if (!module || state !== 'focused' && !open) {}` — statement vazio; `fitCanvas(screen)` + `void screen` no overlay | refatorações parciais | `game-host.ts:214, 172-173` |
| 7 | **Sem tela de "fase concluída"**: troca de fase só mostra o banner `STAGE` por 90 ticks; não há interstício de fase | não implementado | `shaft-runner/index.ts` (banner) |
| 8 | **Fase 1 não é lenta**: `STAGES` v = 36/42/48/54/60/66 — começa em velocidade média e salta +6 por fase (progressão dura) | tabela original da spec | `shaft-runner/data.ts` STAGES |
| 9 | **Listener de clique no document nunca removido** (montagem única, ok no atual, mas vaza na nova arquitetura) | sem teardown | `game-host.ts:414-419` |
| 10 | **UI inacabada das janelas**: terminal W2 apenas loga eventos (cap 200 linhas); W3 sem os 2/3 gráficos (bug 3); sem mini player; sem arraste; W1 não redimensiona | protótipo | `windows-shell.ts` |
| 11 | Restart após game over usa seed novo derivado do contador `runs` (comportamento aceitável, mas o teste antigo mostrava hash divergente se o script reiniciava) | design; documentado | `shaft-runner/index.ts startRun` |

## O que está BOM e fica
- Loop 60 Hz fixo com catch-up ≤5 e clamp 250 ms; determinismo (13/13).
- Captura de teclado instalada só em foco; ESC com latch; Tab nunca capturado.
- Auto-pausa por aba oculta + release ao sair do platô da cena LED (ao vivo: label
  "PAUSED" ✓, Space resume ✓).
- Touch: arrasto 1:1 (`input.px`) + auto-fire + overlay expandido ≤1199px.
- HUD em bandas com lint 6/6; telas menu/pausa/gameover/hiscores existem e passam.
- Save top-5 + RUNS em try/catch.

## Conclusão
A arquitetura de 3 janelas está correta no motor (host+jogo), mas a UI nunca foi
terminada (W2/W3 descartáveis) e há 2 bugs de integração sérios (1 e 2) que a
reformulação resolve por construção. Motor do jogo é reaproveitado.
