# Plano — YF.CLI (janela única na hero) + SHAFT RUNNER reformulado

> Decide a arquitetura final, o mapa referência→nosso e as remoções. Auditoria dos
> bugs atuais em `auditoria-atual.md`; técnicas da referência em `relatorio.md`.

## Arquitetura final

```
Hero (flip frame "hero")
└── YF.CLI  (CliWindow.astro)                    ← UMA janela
    ├── titlebar: status ● YF.CLI — TERMINAL v1  [SND ▮▮▮] [⛶] [CLOSE]   (arraste)
    ├── screen:                                   (área única, muda por modo)
    │     boot → idle → game(SHAFT RUNNER) → idle
    │     · boot: linhas BIOS YF (próprias) + barra de blocos
    │     · idle: logo YF pixel/dither + "PRESS ANY KEY" + 2 sparklines (MS/SCR)
    │     · game: canvas 216×384 do SHAFT RUNNER (motor atual reaproveitado)
    ├── footer: dicas por modo (mono-tiny)      ← já existia o padrão (HINTS)
    └── CRT: scanline + vignette + dot-grid (CSS, tokens --crt-*, verde)

src/scripts/cli-shell.ts     ← NOVO: casca (open/close/drag/fullscreen/foco/z-index),
                                boot sequencer, idle renderer (canvas 2D), mini player,
                                integração com o SOUND do site (o mesmo AudioContext)
src/scripts/game-host.ts     ← REESCRITO FINO: foco, captura de teclado, loop 60 Hz,
                                contratos GameModule (motor intacto), sem W2/W3
src/games/shaft-runner/*     ← MOTOR MANTIDO (data/layout/world/index) + correções:
                                dificuldade suave, fase concluída, sfx ligados ao host
```

- **Sem dependências novas** (vanilla + Canvas 2D). GSAP só na casca (open/close), fora
  do loop do jogo.
- **Jogo separado da UI**: o motor (`shaft-runner/`) não conhece DOM de janela; a casca
  fornece canvas/input/áudio/storage (contrato HostContext atual mantido).

## Máquina de estados da janela
`closed → boot → idle → game(idle↔menu↔play↔pause↔gameover↔hiscores) → idle`
- `boot`: ~1.6 s (6 linhas + barra em blocos), pulável (tecla/clique), 1× por sessão
  (`sessionStorage yf.cli-boot`) — reload quente cai direto no idle.
- `idle`: tecla qualquer → `game` (monta o motor); a janela GANHA altura (aspect 9:16
  do jogo) com transição animada de clip-path + altura (transform-only + height 1 passo).
- `game`: Q volta ao `idle` (motor destruído → sem listeners residuais).
- Foco: teclado capturado só em `game` focado; aviso visual (borda lime + "KBD CAPTURED"
  no titlebar); clique fora/ESC libera.

## Mapa referência → nosso

| Referência (bryangarage) | Nossa versão | Nota |
|---|---|---|
| Janela 530×443, drag, fullscreen, [CLOSE] | ~460px, drag com limites da viewport, fullscreen, [CLOSE] | chanfros lime, não laranja |
| Menubar macOS + ⠿ + relógio | titlebar única "YF.CLI — TERMINAL v1" + ●status | sem menubar (menos ruído) |
| Botão header "Hide terminal" | Botão `OPEN TERMINAL >_` no hero (fecha/reabre) | mono, chanfro, data-sfx |
| idle "press any key or click to boot" | idle "PRESS ANY KEY" + logo pixel | nosso boot é pós-clique no botão |
| BIOS multi-linha humorado | BIOS YF própria (6 linhas, ~1.6 s) | textos NOSSOS |
| CLI interpretador (play cave…) | SEM interpretador — idle direto | simplificação deliberada |
| Sparklines espalhadas na página | 2 sparklines DENTRO do idle (MS + SCROLL %) | migração da W3, agora com dados |
| [play]/[next] + barras SVG | botão [SND] + 5 barras animadas no titlebar | ligado ao toggle do site, sem faixas |
| Cave Runner 320×180 landscape | SHAFT RUNNER 216×384 vertical | nosso motor, mantido |
| BEST m + TOP10 + API /scores | HI top-5 localStorage (já existe) | sem backend |
| Q volta ao CLI | Q volta ao idle | idem |
| dt variável ≤2 frames | 60 Hz fixo determinístico (nosso, melhor p/ teste) | diferença assumida |

## Posicionamento na hero
- Desktop: canto inferior-direito da zona do bio (não cobre retrato à esquerda nem o
  nome); default `right: calc(var(--gutter) + var(--rail-lane)); bottom: 12vh;`;
  arrastável dentro da viewport (clamp por pointerup/move, não deixa sair).
- Botão `OPEN TERMINAL >_`: no bloco de tags/meta do hero (zona bio), mono-tiny com
  chanfro; `aria-expanded`, foco visível, `data-sfx`.
- Mobile (<900px): janela vira bottom-sheet fixa (sem arraste), abre por padrão FECHADA;
  botão continua no fluxo do hero. Touch no jogo: arrasto 1:1 + botões BOMB/PAUSE.
- Pointer events: só na janela (`pointer-events:auto` nela, `none` no wrapper) — o
  canvas da hero (hold/rastro) segue recebendo eventos fora dela.

## Correções da auditoria (por construção ou diretas)
1. Áudio: `ctx.audio.enabled` espelha o SOUND do site (mesma fonte de verdade) — bug 1.
2. `clearInput()` em: pausa, blur, visibilitychange, release, troca de modo — bug 2.
3. Telemetria passa a medir de verdade (frame ms + progresso do flipbook) — bug 3.
4. Loop/rAF: só existe com a janela aberta; destruição total ao fechar — bug 4.
5. Resize: só pausa se a janela do jogo mudar de tamanho útil (>40px); senos re-fit —
   bug 5.
6. Código morto removido com a reescrita do host — bug 6.
7. Fase concluída: interstício "STAGE CLEAR +n" (~1.2 s, auto) entre fases — bug 7.
8. Dificuldade: `v 30/37/44/52/60/68` (começa lenta, curva suave), `gapBase` +2 nas duas
   primeiras fases; tabela e suite atualizadas — bug 8.
9. Sem listeners globais sem teardown — bug 9/10.

## Remoções (após a nova janela funcionando)
- `Windows.astro` (as 3 janelas) do `index.astro`; `src/data/windows.ts`;
  `windows-shell.ts` (W2 terminal, W3, scrub de janelas, splash);
  CSS `.win-*`/`[data-win]`/`--crt` legado que órfão ficar; `game-host` antigo
  (telemetria/overlay antigos). Suites `windows-verify.mjs` e partes de
  `layout-verify.mjs` que apontam às janelas antigas são substituídas por
  `cli-verify.mjs`. `rain-verify`, `scroll-fix-verify`, `shaft-verify` permanecem.
- A cena LED volta a só o canvas de chuva (o platô das janelas encurta no plano final
  só se necessário — não mexer na tabela de cenas nesta rodada).

## Lotes
1. **Lote 1** — Casca YF.CLI na hero (botão, open/close, drag, fullscreen, boot, idle
   com telemetria, CRT verde, mini player ligado ao SOUND).
2. **Lote 2** — Jogo na janela (transição idle→game, HUD ok, dificuldade nova, fase
   concluída, sfx no host, autopilot, touch).
3. **Lote 3** — Integração/limpeza (captura anunciada, clearInput, pausas, reduced
   -motion, remover 3 janelas + código morto + suites antigas, FPS/freeze check).

## Status (atualizado ao final)
- [x] **Lote 1** — YF.CLI na hero: botão OPEN TERMINAL >_ (chanfro lime, data-sfx),
  open/close com wipe, boot BIOS próprio (6 linhas + barra de blocos, pulável,
  1×/sessão), idle pixel (logo YF, PRESS ANY KEY, sparklines MS/SCR com dados reais),
  arraste com clamp de viewport, fullscreen, resize handle, SND espelhando o toggle do
  site (barras animam), CRT verde (scanline+vinheta+grade). Janela teleportada para o
  body (frames do film escalam — position:fixed lá dentro quebrava).
- [x] **Lote 2** — jogo na janela: game-host reescrito fino (captura só em foco, badge
  KBD CAPTURED, loop 60 Hz destruído junto), dificuldade v30→v68 com curva suave
  (fase 1 lenta), interstício STAGE CLEAR +1000 (72 ticks), **placar por linha
  corrigido** (floor por tick zerava — bug pré-existente), SFX ligados ao SOUND do
  site, Q volta ao idle, touch drag + faixa FIRE/BOMB/AUTO/PAUSE/CLI.
- [x] **Lote 3** — 3 janelas antigas + windows-shell/windows.ts/CSS morto removidos
  (~270 linhas de CSS); suites: `cli-verify.mjs` NOVO (16 itens), `shaft-verify.mjs`
  reescrito para a via CLI, `windows-verify`/`layout-verify` aposentados (o lint de
  HUD vive no cli-verify item 7). **Bugs de produção consertados de carona**: (a)
  `releaseGame` drenava os cleanups de mount — o host perdia click/Q/resize no
  primeiro release (split captureCleanups); (b) teclas soltas com jogo sem foco
  rolavam a página e a hero fechava a janela — agora qualquer tecla do jogo
  REFOCA (preventDefault); (c) mobile ≤700px renderizava em BRANCO desde sempre
  (`.flip-track{display:none}` escondia o stage que mora dentro dele) — agora o
  track fica com altura auto e a página empilha; (d) footer com nowrap (dica longa
  quebrava linha e a janela estourava a viewport após o fit).
- Suites finais: **cli-verify 16/16 · shaft 13/13 · rain 13/13 · scroll-fix 15/15**.
  `lime-pixels` falha 8 checks TAMBÉM na produção pré-mudança (drift pré-existente da
  suíte, fora do escopo — documentado).
- Pulado: interpretador de comandos no CLI (idle direto — simplificação deliberada);
  leaderboard server-side (mantemos top-5 local); mudanças na tabela de cenas.
