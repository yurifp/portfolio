# bryangarage.dev — Terminal "Garage CLI" + Cave Runner (reação reversa via REA)

> Método: REA 6.4.0 (`inspect-web-page` sobre CDP 9222), automação Playwright over CDP,
> fontes dos bundles (`--include-script-sources`). Evidências: `evidence/rea-garage/`
> (G1 casca, G2/G3 boot, G5 sources, G8/G9 jogo, game-*.png, styles.css parcial).
> Objetivo: técnicas e acabamento — reescrita total na nossa estética (preto/lime/pixel).

## Resumo (stack)

Next.js (Turbopack) + React; o terminal/jogo são **componentes React com Canvas 2D puro**
(sem engine de jogo). GSAP presente no bundle (site), **não no loop do jogo**. Jogo:
rAF com dt variável clampado; som 100% WebAudio sintetizado (ondas quadradas);
leaderboard server-side (`/api/cave-runner/scores`) + localStorage; ranking local com
"pilotos da casa". CLI: interpretador de comandos com scrollback, fuzzy match
("did you mean cv?") e estado de janela arrastável com focus/ESC/Q.

| Alvo | Confiança | Destaque |
|---|---|---|
| 1 Casca da janela | [OBSERVADO] | 530×443, titlebar/menubar/scrollbar/CRT, drag, fullscreen |
| 2 Boot | [OBSERVADO] | idle "press any key" → BIOS em linhas com OKs humorados |
| 3 Tela idle | [OBSERVADO] | wordmark ASCII + sparklines 300×150 + prompt |
| 4 Camada CRT | [OBSERVADO/INFERIDO] | div `.gt-crt` dedicada; detalhes não confirmados |
| 5 Mini player/áudio | [OBSERVADO] | [ play ]/[ next ] + barras SVG no menubar |
| 6 Jogo | [OBSERVADO] | canvas 320×180, dt≤2 frames, estado rico, SFX square |

---

### 1. Casca da janela
- **Comportamento** — janela compacta (medido 530×443 css) com: menubar estilo macOS
  (File/Edit/Screen/Special/Help + relógio + indicador ⠿), titlebar (alça de arraste +
  título contextual "Garage CLI v1.8 · CAVE RUNNER" + botão [CLOSE]), scrollbar lateral
  própria (botões ↑/↓), knob de cor de tela, botão fullscreen, mini player [ play ][ next ].
- **Mecanismo** — abrir/fechar pelo botão do header da página (`aria-label="Hide
  terminal"`). Arraste move a janela (limites não travados — saiu da posição inicial
  livremente); classe `gt-window--picked-up` durante o drag (permaneceu após mouse.up
  via CDP — pequena falha deles ou artefato de automação [INFERIDO]).
- **Evidência** — [OBSERVADO] DOM: `.gt-window > .gt-mac-menubar, .gt-titlebar, .gt-body,
  .gt-mac-scrollbar, .gt-crt`; botões `gt-ctrl--close`, `gt-ctrl--room` (aria "Show
  terminal fullscreen"), `gt-ctrl--knob` (aria "Change screen color"); janela moveu de
  (543,418) → (745,229) com mouse steps.
- **Parâmetros** — janela ~530px; canvas de jogo css 502×358 dentro dela; z-index/foco:
  cliques fora não roubam teclado do jogo enquanto ativo (preventDefault nas teclas do
  jogo) [OBSERVADO no handler keydown].
- **Técnica** — React + CSS (sem lib de janela); pointer events nativos.
- **Riscos para nós** — arraste livre conflita com hero sticky: limitar à viewport e
  não sobrepor retrato/nome.

### 2. Boot
- **Comportamento** — pós-carga a janela fica **idle** ("press any key or click to
  boot"); tecla/clique dispara o BIOS: linhas aparecem em duas colunas (tarefa +
  resultado), ritmo irregular (~0.2–1.9 s entre linhas), humor próprio ("installing AGI —
  it's here, now"); termina no prompt do CLI.
- **Mecanismo** — [OBSERVADO] série temporal: "GARAGE BIOS v1.8 · 640K context OK" →
  "opening the garage door → OK" (204ms) → "orchestrating 3 agents → OK" (621ms) →
  "calling a specialized agent → on it" (1.36s) → "running the evals → on my machine"
  (2.5s) → "installing AGI → it's here, now" (3.2s) → CLI. Boot NÃO repete em reload
  (estado de sessão) [OBSERVADO — reload caiu direto no idle/CLI].
- **"Press D for debug"** — não confirmado no Garage (não vimos; o boot pula por
  tecla/click qualquer).
- **Parâmetros** — total do BIOS ~3.5–5 s; atraso inicial ~600 ms.
- **Técnica** — linhas como elementos DOM no corpo do terminal (não canvas).
- **Riscos** — para nós: boot longo atrapalha; faremos ~1.2–2 s e pulável.

### 3. Tela idle / CLI
- **Comportamento** — wordmark **ASCII-art** (blocos `█`) + linha de saída + prompt
  `bryan@garage ~ %`; dica "Type help…"; gráficos de telemetria: ~10 canvases 300×150
  (sparklines) espalhados na página (seção garage), não dentro da janela; cursor de
  texto no input.
- **Mecanismo** — histórico de linhas `.gt-line--in/--out` com scrollback; comandos com
  fuzzy match; `help` lista tudo (about/whoami/stack/projects/social/screen/fullscreen/
  **play**/coffee/panic/help) [OBSERVADO lista completa no bundle]; `play` abre o
  fliperama ("pick one: cave | sky"), `play cave` lança o jogo [OBSERVADO ao vivo].
- **Evidência** — [OBSERVADO] lista: `{cmd:"play",blurb:"there's a game in here"}` e
  dispatch `case"play": /^(cave|runner|cave runner)$/.test(d) → i7()`.
- **Parâmetros** — input é `<input.gt-input>` real (foco por clique); resposta <300 ms.
- **Técnica** — interpretador JS + render de linhas React.
- **Riscos** — nenhum para nós; nossa versão será mais enxuta (sem interpretador geral).

### 4. Camada CRT
- **Comportamento/mecanismo** — [OBSERVADO] existe um `div.gt-crt` como camada dedicada
  dentro da janela (width 0 no estado CLI — ativa no jogo [INFERIDO]). Scanlines/grade/
  vinheta/flicker específicos: **não confirmados** (o CSS travou na captura); trata-se
  de overlay CSS sobre o canvas [INFERIDO pela arquitetura].
- **Custo** — camada estática CSS ≈ custo nulo; nossa versão já tem scanline+vignette
  aprovada nas janelas antigas — reutilizar.

### 5. Mini player e áudio
- **Comportamento** — botões `[ play ]` / `[ next ]` (aria "play music"/"next track")
  no rodapé da titlebar + **barras de áudio animadas (SVG rects)** no menubar; "click
  to play" como dica — música só após gesto [OBSERVADO aria-labels + hint].
- **Mecanismo** — [INFERIDO] WebAudio (o jogo sintetiza tudo com WebAudio; o player
  deve compartilhar o AudioContext). Faixas: não confirmado (sem network de áudio
  observada na janela).
- **Para nós** — manter o nosso toggle SOUND (off por padrão) e integrar o mini player
  a ele; sem faixas de terceiros (bips/drone sintetizados que já temos).

### 6. Jogo (Cave Runner)
- **Arquitetura** — componente React + **Canvas 2D 320×180** esticado via CSS para
  ~502×358 (`imageSmoothingEnabled` gerenciado; pixel art). [OBSERVADO] canvas
  `.gt-game-canvas` 320×180.
- **Loop** — [OBSERVADO] `rAF` + `n = Math.min(2, (e - ex) / 16.667)` — **dt variável
  em unidades de frame, clamp de 2 frames** (33ms máx); `ex = e` por tick.
- **Input** — [OBSERVADO] keydown global com guarda `e.target.closest("input,textarea")`
  (não captura teclado do CLI), graça de 250 ms pós-monte (`performance.now() < eb`),
  `preventDefault` nas teclas do jogo (Set de keys), Escape → exit/pause via ref,
  touch: `touchY` (arrasto vertical controla a nave) + botões touch na moldura
  ("▲▼ CLI ❚❚ AUTO BOMB FIRE"). Titlebar muda para "· CAVE RUNNER"; Q retorna ao CLI.
- **Estado da run** — [OBSERVADO] objeto com `spawnIn:1.2, fireIn:0, pulseIn:0,
  invincible:1.4, bombs:3, nextLifeAt:5e3, shake:0, flash:0, fuelWarnIn:0, touchY,
  shots, pulses, enemies, bolts, sparks, popups, sounds` — **shake, flash de dano,
  partículas (sparks), popups de pontos e fila de sons** nativos do estado.
- **SFX** — [OBSERVADO] função de blip `(ctx, ..., fA, fB, dur, wave, vol)`: fuel =
  2 blips quadrados 196→180 Hz; vida extra = arpejo 523/659/784; tudo WebAudio.
- **HUD** — [OBSERVADO] desenhado NO canvas (fonte monospace bold 10–11px, stroke
  escuro + fill claro, textAlign right/center): "BEST {n}m" (profundidade em METROS,
  4 dígitos), telas de ranking "TOP 10 SCORES / RANK · PILOT · …" com DOM overlay para
  "NEW HIGH SCORE / RANK #n" (classe `gt-game-result-*`).
- **Scores** — [OBSERVADO] chaves `garage-cave-runner-best`, `…-scores-v1`,
  `…-callsign`, `x-garage-pilot-token`, `…-pilot-v1` + `GET/POST /api/cave-runner/
  scores` (leaderboard server com "pilotos da casa" MAY/JUL/SOF/DAN/MIN/LEO de
  600–6400 m).
- **Game feel** — invencibilidade 1.4 s pós-hit; warning de fuel a cada 1.1 s;
  nave clampada y∈[118,164] (faixa de jogo), vx inicial 7.2 (frame units).
- **Dificuldade** — não confirmado em detalhe (curva não extraída; terreno vertical
  procedural com RNG sementeado `0x5b1b0a4d` determinístico por run [OBSERVADO]).
- **Pausa/foco** — [OBSERVADO] Escape pausa (título instrui "Escape to pause");
  pausa por aba oculta: não confirmado.

---

## Mapa referência → nossa versão (resumo; detalhes no plano)

| Referência | Nossa versão |
|---|---|
| Janela 530×443 arrastável + menubar + titlebar + [CLOSE] | Janela YF.CLI ~460×~420 na hero, chanfros lime, titlebar "YF.CLI — v1", [CLOSE] |
| Botão header "Hide terminal" | Botão "OPEN TERMINAL >_" no hero |
| Idle "press any key or click to boot" | Idle com "press any key" + logo pixel/dither |
| BIOS humorado multi-linha | BIOS YF próprio (~6 linhas, ~1.6 s, pulável) |
| CLI interpretador (help/play/cv…) | CLI mínimo: boot → idle → jogo (sem interpretador) |
| Sparklines 300×150 | Telemetria FRAME MS / DROPS / SCROLL % (a nossa já existe — migra) |
| [play]/[next] + barras SVG | Toggle SOUND integrado + barras de nível no titlebar |
| play cave → jogo na mesma janela | "press ENTER" → SHAFT RUNNER na mesma janela (vertical) |
| Canvas 320×180, dt≤2 frames | Nosso canvas 216×384 já 60 Hz fixo determinístico (mantém) |
| BEST {m} + TOP 10 + API | HI top-5 local (localStorage, já existe) — sem API |
| Q volta ao CLI | Q volta ao idle do YF.CLI |
