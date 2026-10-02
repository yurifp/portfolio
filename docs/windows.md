# WINDOWS — as caixas sobre a placa + host do jogo (Parte 1)

> Commits: `windows: shell + scrub open` · `windows: host, focus, stub`.
> Suíte: `scripts/windows-verify.mjs` — **27/27**; no commit anterior ela
> crasha em `__host` ausente (teste do teste, itens 1/4/7-9+).

## 1. Auditoria (Fase A)

- **Cena do painel**: `src/scripts/led-wall.ts` (motor de campo), janela de
  scroll 10.15%–25.54% (era 200vh do track de 1300vh; agora a cena `led`
  vale **300vh** de 1420vh — só ela cresceu, as outras mantêm os vh e portanto
  os px). z-index: canvas em `--z-ghost` (1) dentro do frame led. Rampa
  literal de 12 níveis (`#020602…#c9fbc4`), matiz OKLCH ~142.8°.
- **Driver da chuva**: **tempo** (t_rain += dt·mult; o scroll só acelera até
  +35%). Logo o item 1.7 não se aplica: durante o foco o Lenis para, o
  progresso congela, e a chuva CONTINUA (rAF próprio do painel, ativo enquanto
  o frame está visível). Verificado: p95 0.2ms/frame com janelas abertas.
- **motion-vocabulary.md**: wipe inset, linhas scaleY, abertura de card por
  clip L→R, label letra-a-letra (yPercent), odômetro, dither 6→28 — a
  abertura das janelas reusa linha → clip vertical → letras → conteúdo.
- **Lenis**: instância módulo-scoped em `main.ts` (lerp 0.1, ticker GSAP).
  Adicionados `lockScroll()`/`unlockScroll()` exportados. Listeners globais
  relevantes: wheel do Lenis, keydown (captura só durante o foco), mousemove
  do cursor customizado (`.cursor-root` — escondido via
  `html.game-focused`).
- **Sobra de scroll**: 140vh livres após a onda de ignição — insuficiente
  para abertura (3×35%−overlaps) + platô ≥60vh. Cena estendida 200→300vh;
  linha do tempo local: onda 0–0.30 · abertura W2@0.310 / W1@0.442 /
  W3@0.574 (35% cada, 15% de sobreposição) · **platô 0.729–0.955 (62.1vh)**
  · saída 0.955–1.00 (inversa acelerada).
- **Fonte/tokens**: DM Mono (`--font-mono`), `--color-lime #9df133`,
  `--gutter clamp(16,1.6vw,44)`, `--rail-lane clamp(28,2.4vw,56)`, z 1/10/50/60.
- **__panel**: cols/rows/cell/gap/ramp/levels()/… (usado pelo boot da W2 e
  pelo histograma da W3).

## 2. Tokens e forma

`--crt-bg #011403` · `--crt-edge #036806` (rampa 5) · `--crt-dim #038409`
(6) · `--crt-fg #12dc1b` (9) · `--crt-hi #c9fbc4` (11) ·
`--win-chamfer 10px` · `--z-win 30` · `--crt-intensity 1`.

Forma 100% quadrada: chanfro 45° via `clip-path` polygon (o mesmo dos cards
lime), "borda" de 1px por duas camadas (externa `--crt-edge`, interna 1px
menor). Zero `border-radius`/`arc`/`circle`/`ellipse` no código das janelas
(grep da suíte). Ponto de status = quadrado 8px. Alça = 6 quadradinhos 2×3.

CRT (CSS puro, `?crt=0` desliga): scanlines 1px/3px ~50%, vinheta radial,
brilho superior 5%, text-shadow ≤4px nos textos. Sem flicker.

## 3. As janelas

Dados em `src/data/windows.ts` (id/title/role/cols/topVh/maxHVh/openAt/
openDur/stateLabel) — trocar papéis é editar o array. Geometria espelha a
grade de 12 colunas (`--gutter`/`--rail-lane`/`--col-gap` lidos do
computedStyle). W2 cols 1–3 (1–4 ≥1700px), W3 cols 10–12 (9–12), W1
centralizada em 50vw ±2px (retrato: a altura 80vh define a largura pela
tela 9:16). <1200px: só a W1, centralizada, largura limitada a
100%−2·gutter. Nenhuma cobre o HUD (faixa 0–12vh) nem a lane do trilho;
≥12px entre janelas; base ≥4vh.

**Abertura por scroll** (função pura do progresso local P): cada janela tem
`openAt`/`openDur`; q = clamp((P−openAt)/openDur). q<0.25: linha clara de 2px
desenha do centro às pontas; 0.25–0.60: abre na vertical até o polígono
chanfrado; 0.45–0.75: título entra por letra; 0.60–1.00: conteúdo (boot
n linhas = f(q), barra enche, splash dither 14→3). `is-live`
(pointer-events) só com q ≥ 0.98; antes `pointer-events:none` +
`aria-hidden`. Saída em P∈[0.955,1]: a mesma função invertida, 4.5× mais
rápida. Estado idêntico por 3 rotas (devagar, recarregar, voltar de baixo).

## 4. Host, foco e captura

Estados IDLE→FOCUSED. `focusGame()`: `lockScroll()` (lenis.stop), captura em
FASE DE CAPTURA de wheel (não-passivo, preventDefault) e das teclas de
rolagem+do jogo (setas/WASD/Espaço/X/P/Enter/Q/Esc); **Tab nunca é
capturado**; `touch-action:none`; cursor customizado oculto
(`html.game-focused`); ESC é *latching* (o keyup não o apaga antes de um
 passo fixo consumir). `releaseGame()`: remove listeners,
`unlockScroll()`, devolve o foco à janela, rótulo "CLICK TO PLAY".
Liberações: ESC (via módulo), clique fora, ✕, `ctx.release()`, e auto-pausa
por `visibilitychange`/resize/sair do platô.

**InputState** unificado (left/right/up/down/fire/bomb/pause/autopilot/
esc/ok/quit). **Loop** 60Hz com acumulador, catch-up ≤5 (5s = 300±3 ticks;
aba oculta = 0 ticks). **Escala**: canvas 108×s × 192×s device px,
s = max(2, floor(min(Wdev/108, Hdev/192))); moldura simétrica; fresta de 1
device px na cor exata do fundo quando s ≥ 4 (grade desenhada por cima).

**Contrato** (`GameModule` em `game-host.ts`): id/logical/capturesEsc/
mount(ctx)/update()/render()/setMode/destroy; ctx = canvas2d, input,
palette (rampa), seed, audio, storage, emit(evt), release(), scale.
**Stub** (`makeStub`): grade 108×192 com borda+cruz+dither e um quadrado
8×8 quente que obedece às entradas — prova o pipeline inteiro.

**Sonda** `window.__host = { windows(), state(), focused(), locked(),
tick(), module(), input() }`. `?debug=layout` contorna as janelas.

## 5. Conteúdo

- **W2 boot** (f(q)): YF·BIOS v1.0 — 640K OK · mounting /var/www/portfolio ·
  `linking led-panel [{cols}×{rows} cells]` (valores REAIS de __panel) ·
  loading shaft-runner.bin · warming up the phosphor · READY. Depois:
  `emit(evt)` → linhas com timestamp; buffer circular de 200.
- **W3 telemetria**: histograma de 12 barras com a contagem real de
  `__panel.levels()` (4Hz) + linha FRAME-MS dos últimos 120 quadros
  (Bresenham, células 2px, sem anti-aliasing), paleta fechada.
- **W1**: stub + splash DOM "SHAFT RUNNER / CLICK TO PLAY" sobre dither
  que afina com o scroll (a Parte 2 remove).
- **Mobile**: tap na W1 → modo foco em overlay 100dvh com ✕ de 44px;
  EXPANDIR (desktop) usa o mesmo overlay. Rodapé W1: keycaps ←→ MOVE,
  SPACE FIRE, X BOMB, P AUTOPILOT, ESC PAUSE.

## 6. Verificação (27/27)

Layout (6 viewports, eixos ±1px, W1@50vw±2, sem HUD/lane, ≥12px, base
≥4vh) · grep sem círculos · contraste UI 100:1 · f(p) pura por 3 rotas ·
platô 62.1vh · roda muda quadros · pré-foco teclado rola (+945px) ·
FOCUSADO: progresso Δp=0.000000, scroll idêntico, 3 teclas simultâneas
capturadas (defaultPrevented), loop 60Hz · ESC/clique-fora soltam ·
auto-pausa (hidden=0 ticks, resize, sair do platô) · escala inteira
(432×768 DPR1 / 864×1536 DPR2) · boot com cols×rows reais (113×64) ·
linhas = f(p) (0→1→6) · telemetria viva · p95 JS 0.2ms · heap estável ·
console limpo · mobile (só W1, overlay, ✕).

## 7. Observações (seção 9 — só reporte)

1. **Cursor customizado × foco**: o cursor é `position:fixed` global com
   transform por ticker GSAP; durante o foco ele fica `visibility:hidden`
   via `html.game-focused` — o ticker continua rodando (custo ~0). Ao
   soltar, ele reaparece na última posição do ponteiro.
2. **Platô**: 62.1vh medidos (alvo ≥60vh) entre os pontos de scroll
   global 0.2451 e 0.2927 do track de 1420vh.
3. O teste-do-teste crasca na primeira leitura de `__host` (motor antigo) —
   contando como falha dos itens 1/4/7-9 e seguintes.
