# curtisdesignr.me — Engenharia reversa de comportamentos (via REA)

> Método: REA 6.4.0 (`inspect-web-page` sobre CDP 9222, janelas de 10–20 s com interação
> conduzida por automação), fontes dos bundles (`--include-script-sources`), CSS público e
> sondas de estilos computados em runtime. Evidências brutas em `evidence/rea-curtis/`.
> Objetivo: entender a técnica para recriar do zero — nada aqui é cópia 1:1.

## Resumo da stack (10 linhas)

Next.js App Router (React 19, Turbopack, chunks `_next/static/chunks/*`), deploy Vercel.
Animação: **GSAP 3.15.0** com **ScrollTrigger** e plugin premium **scrambleText** (assinatura
`{version:"3.15.0",name:"scrambleText"}` no chunk `10q6p3rayb3r7.js`), mais **framer-motion**
(no bundle de 1 MB). Scroll suave: **Lenis 1.3.23** em modo wrapper (`#scroll-container.lenis`,
`window.lenisVersion="1.3.23"`), lerp exponencial. 3D/áudio: **Three.js** embutido
(`AudioListener/AudioAnalyser/WebGLRenderer` no chunk grande) — a seção de projetos tem
`data-webgl="on"`. Fontes via next/font (Rajdhani, DM Mono, DM Sans — módulos CSS no `<html>`).
Tailwind v4 (classes utilitárias + CSS custom). Áudio: música de fundo (mp3 Epidemic Sound,
`new Audio(...).loop`, vol 0.3) + SFX hover/click em WAV via buffers; ~45 elementos com
`data-sfx`. `prefers-reduced-motion` respeitado em vários pontos (guardas no JS + media queries).

| Alvo | Dificuldade de recriar | Nota |
|---|---|---|
| 1 Preloader | baixa | counter + linhas ∝ progresso real |
| 2 Odômetro | baixa | strip de dígitos + translateY por IntersectionObserver |
| 3 Hero split/scrub | média | máscara por linha + scrub linear com stagger |
| 4 Scroll/progresso | baixa | Lenis wrapper + ring SVG no cursor + chevrons CSS |
| 5 Menu overlay | média | slide 100vw + chips com overshoot + scroll lock |
| 6 Ícones default/hover | baixa | crossfade CSS de duas imgs empilhadas |
| 7 Snap-shots | média | seção verde + cards com máscara/frame + hover zoom |
| 8 Acordeão Worked At | média | palco pinado com dead-scroll + painel por linha |
| 9 Áudio | baixa | toggle + buffers hover/click + música loop |
| 10 Transição de página | média | estado data-exit + navband + RSC client-side |

---

### 1. Preloader / sequência de entrada
- **Comportamento visível** — tela cheia verde-neon; contador `0%`→`100%`; 4 linhas de 1px
  crescem das bordas; 4 chanfros SVG nos cantos; ao chegar em 100% tudo some e a hero revela.
- **Mecanismo (gatilho → estado → animação)** — na carga: `.preloader` (fixed, z-10000,
  `background: var(--primary-green-neon)`, `pointer-events:none`) monta 4
  `span.preloader-line` (v/h, left/right/top/bottom, inset 2rem, transform inicial
  `translate(±(2rem+2px))`), 4 `svg.preloader-chamfer` (stroke `#67b900`) e
  `span.preloader-percent`. O contador avança **proporcional ao carregamento real**; as
  linhas deslizam junto com o progresso. Ao 100%: segura ~230 ms e **remove o elemento do DOM**
  (sem fade). `.boot-cover` (z-9998, preto) colapsa de 806px→0 no começo. ~350 ms depois a
  primeira linha da hero anima `opacity 0→1` em ~740 ms (ease-out).
- **Evidência** — [OBSERVADO] DOM ao vivo (cold boot com cache desabilitado):
  `<div class="preloader" data-surface="green"><span class="preloader-line …-left">…<span
  class="preloader-percent">0%</span><svg class="preloader-chamfer …">`. Série temporal:
  counter 0%→78% em ~1,9 s, plateau 95% (~0,5 s) esperando assets, 82→100% até ~3,6 s;
  linhas `translateX(-37.2px)` no 0% → `(-684.8px)` no 100%; hero `opacity` 0→1 entre
  t≈4204–4945 ms. Em reload com cache: `display:none` aos ~166 ms (boot único por sessão
  — [INFERIDO] via regra CSS `…preloader{display:none}` acoplada a estado de boot).
  CSS: `.preloader{z-index:10000;background:var(--primary-green-neon);position:fixed;inset:0}`.
- **Parâmetros medidos** — duração total do boot ≈ 3,6–3,9 s (cold) / ~0,7 s (warm);
  revelação da hero ~740 ms; counter em passos de texto (`"17%"`, `"23%"`…), não odômetro.
- **Biblioteca/técnica** — React (montagem/desmontagem condicional) + GSAP/Framer para a
  revelação; progresso vindo de carregamento de assets (network). Sem lib de preloader.
- **Estratégia para recriar em Astro** — componente `<Preloader>` vanilla: overlay fixo lime
  (`--lime`), 4 linhas com `transform: translateX/Y(±offset)` derivado de `progress`,
  counter textual, `progress` calculado de `PerformanceObserver`/promises de assets críticos
  (fontes + imagens above-fold); ao 100% → `remove()` e dispara a entrada da hero.
  Estado "já bootou" via `sessionStorage` para não repetir em reload.
- **Riscos** — bloquear conteúdo em conexão lenta (cap ~4 s e força 100%); LCP atrasado;
  remover do DOM (não só opacity) para liberar paint.
- **Dúvidas em aberto** — o percentual exato mistura Bytes vs. nº de recursos? O plateau
  em 78/95% sugere espera por assets específicos (mp3?) — não confirmado.

### 2. Contadores numéricos (odômetro de colunas)
- **Comportamento visível** — stats "30+", "10+", "70+" sobem dígito a dígito, colunas de
  0–9 rolando para cima, em cascata, ao entrar na viewport.
- **Mecanismo** — componente React gera por dígito:
  `span.odometer-digit` (overflow hidden, altura = `--odo-cell-h`) contendo
  `span.odometer-digit-strip[data-ticks=N]` (flex column, `will-change:transform`) com N+1
  `span` (texto `n%10`). A animação é um `translateY` de 0 → `−N × cellH`; sufixo separado
  `span.odometer-suffix` ("+"). Gatilho: entrada na viewport (IntersectionObserver + hook
  `usePageReady/layoutReady`).
- **Evidência** — [OBSERVADO] código do bundle (`0~vkdd-perhi3.js`):
  `"span",{className:"odometer-digit",children:[… "odometer-digit-strip","data-ticks":e,
  children:Array.from({length:e+1},(e,n)=>(… n%10 …`. CSS:
  `.odometer-digit{height:var(--odo-cell-h);overflow:hidden}`
  `.odometer-digit-strip{will-change:transform;flex-direction:column;display:flex}`.
  Runtime: strips com `ticks` 3/30/1/10/7 terminam em `matrix(1,0,0,1,0,-329.95)` etc.
  — célula ≈ 110px; cascata: colunas começam defasadas (~0/0/0/0/500 ms), settle ~0,8–1,1 s.
- **Parâmetros medidos** — célula = altura da fonte do dígito (~110px no desktop medido);
  curva fast-start/long-tail (expo-out); stagger entre colunas ~80–150 ms.
- **Biblioteca/técnica** — componente próprio + transform (GSAP/Framer `to`), CSS só estrutura.
- **Estratégia para Astro** — JS vanilla: função `odometer(el, value, suffix)` que monta a
  strip, `IntersectionObserver` dispara `el.animate([{transform:'translateY(0)'},{transform:
  \`translateY(-${ticks*cellH}px)\`}], {duration:900, easing:'cubic-bezier(.16,1,.3,1)',
  delay: col*100})` (WAAPI — sem dependência). Dígito por dígito, sufixo fora da strip.
- **Riscos** — altura da célula deve casar com line-height exato (usar `em`/var); medir
  `prefers-reduced-motion` → pular direto ao valor final; re-trigger ao voltar? (no original
  anima 1× por carga).
- **Dúvidas em aberto** — se reanima ao sair/voltar da viewport (não testado).

### 3. Animação dos textos da hero (split + máscara + scrub)
- **Comportamento visível** — parágrafo intro aparece por linhas com máscara; ao rolar, as
  linhas somem deslizando para cima com fade, em sequência.
- **Mecanismo** — texto dividido em palavras: `span.split-line-mask` (block,
  `overflow:hidden`, `[clip-path:inset(0)]`) › `span.split-line-inner` (block) › um
  `span.inline-block` por palavra (+ espaço). Entrada: IntersectionObserver → anima de
  `yPercent:110, opacity:0` para visível. Saída: **scrub por scroll** — o código calcula por
  linha `i = clamp((t − n/r·0.5)/0.5)` e aplica `gsap.set(e,{yPercent:-110*i, opacity:1-i})`.
- **Evidência** — [OBSERVADO] bundle: função `b(e,t){…querySelectorAll(".split-line-inner")…
  n.forEach((e,n)=>{let i=Math.min(1,Math.max(0,(t-n/r*.5)/.5));a.gsap.set(e,{yPercent:-110*i,
  opacity:1-i})}`; estrutura `split-line-mask … [clip-path:inset(0)]` com words em
  `inline-block`. CSS: `split-line-mask:not(:last-child) .split-line-inner{text-align-last:justify}`
  (linhas justificadas). Runtime: fade linear medido — opacidade 100→0 entre 0 e ~400px de
  scroll (linhas 1/2/4) e ~600px (linha 3, atrasada). Reduced-motion:
  `gsap.set(n,{clearProps:"all"})` [OBSERVADO] bundle + runtime (opacity 1, sem transform).
- **Parâmetros medidos** — entrada ~740 ms ease-out; scrub: linha n começa em
  `t = n/r × 0.5` e dura 0.5 do range (progresso do scroll da seção); janela prática ~600px.
- **Biblioteca/técnica** — split próprio (palavras como spans inline-block) + GSAP set no
  callback de scroll (Lenis/ScrollTrigger) — nada de SplitText plugin aqui.
- **Estratégia para Astro** — `splitLines(el)`: agrupa palavras em spans dentro de máscara
  por linha (CSS justify-last para esticar); entrada com WAAPI/GSAP; saída no nosso
  flipbook: mesma fórmula `(t − n/r·0.5)/0.5` aplicada no scrub da timeline.
- **Riscos** — split por linha exige cuidado com hifenização/resize (recalcular linhas);
  `text-align-last:justify` pode quebrar em textos curtos; mobile: fontes menores mudam as
  quebras — recalcular no resize.
- **Dúvidas em aberto** — se o texto "duplicado no HTML" que o usuário viu é o par
  mask/inner (dois wrappers, mesmo texto) — o markup renderiza o texto uma vez por span;
  duplicação visual vem do SSR do split (sem JS, texto já vem splitado do servidor).

### 4. Comportamento de scroll (smooth, indicadores, progresso)
- **Comportamento visível** — scroll muito suave e "pesado"; cue "Scroll down" com 3
  chevrons piscando; um anel verde ao redor do cursor marca o progresso da página.
- **Mecanismo** — Lenis 1.3.23 em **wrapper**: `#scroll-container.lenis` com
  `overflow:hidden auto` é o scroller real (window não rola); scrollbar escondida
  (`scrollbar-width:none` + `::-webkit-scrollbar{width:0}`). Suavização por lerp exponencial
  (classe Animate interna: `value=(1−e^(−s·t))·from+to`). Cue:
  `div.home-layer.home-scroll-cue` (label + SVG com 3 grupos `home-scroll-chevron-1/2/3`,
  cada chevron = 3 rects 2.4px rx .6 — pixel art) com keyframes defasados de opacity.
  Progresso: `div.cursor-progress-ring` (fixed 60×60) com SVG de 2 círculos; o de cima
  neon com `transform:rotate(-90)` e `stroke-dashoffset` da circunferência (185.35 = 2π·29.5)
  até 0.
- **Evidência** — [OBSERVADO] runtime: `window.lenisVersion="1.3.23"`, `#scroll-container`
  scrollHeight 10997 vs clientHeight 805; curva de 1 notch de roda (120px): 12→24→33→…→89px
  ao longo de >1,5 s (decaimento exponencial). CSS keyframes `home-scroll-chevron-a/b/c`
  (opacity .5↔1, `cubic-bezier(.5,0,.5,1)`). Ring HTML com `stroke-dashoffset:185.354;
  stroke-dasharray:1…` [OBSERVADO]. `html.scroll-locked` quando o menu abre (scroll lock).
- **Parâmetros medidos** — lerp ≈ 0.1 (padrão Lenis), resposta ~1,5 s por notch;
  chevrons: ciclo ~1.8 s, 3 fases defasadas.
- **Biblioteca/técnica** — Lenis (wrapper) + CSS keyframes + SVG dashoffset.
- **Estratégia para Astro** — nosso flipbook já tem Lenis; adicionar (a) cue de scroll com
  3 chevrons CSS-only sumindo após N% de progresso, (b) ring de progresso fixo seguindo o
  cursor com `stroke-dashoffset = C·(1−progress)` no tick do Lenis.
- **Riscos** — Lenis wrapper + posição sticky exigem cuidado (o original posiciona seções
  com transform!); ring no cursor só faz sentido com pointer fino (`@media (hover:hover)`);
  lerp pesado pode incomodar em páginas longas (o site é ~13.7 viewports).
- **Dúvidas em aberto** — o ring também reage a hover (cresce?) — não capturado.

### 5. Menu overlay ("/ menu")
- **Comportamento visível** — botão "Menu" abre painel dockado à direita com chips
  (About/Work + "Connect" com 6 socials numeradas 01–06); scroll trava; "Close" fecha.
- **Mecanismo** — `MenuProvider` (context `isOpen/open/close/toggle`). Painel:
  fixed à direita (`sm:right-3.125rem, w-23.75rem, max-h-47.5rem`), **entra com
  `translate-x-100vw → 0`** (`will-change-transform`), clip-path octogonal chanfrado
  (`w=1.0625rem`), camada dupla (frame stroke + fundo `inset-0.5px`). Ao abrir:
  Lenis `stop()` + `html.scroll-locked`. Itens `.menu-hover-item`: chip com pill de fundo
  `scale .85→1 + opacity` no hover/ativo, **180 ms `cubic-bezier(0.34,1.56,0.64,1)`**
  (back-out com overshoot), bolinha indicadora com `delay-40ms`, crosshairs (linhas h/v
  absolutas) nos cantos.
- **Evidência** — [OBSERVADO] bundle `0xn5yk79yysjm.js`: `w="1.0625rem",b=\`polygon(${w} 0,
  calc(100% - ${w}) 0, 100% ${w}, …\`` e classe `…translate-x-[100vw]…will-change-transform
  sm:right-[3.125rem] sm:w-[23.75rem]`; `MenuProvider` com `isOpen`. Runtime: `html.scroll-locked`
  ao abrir; DOM do chip com span de fundo `transition-[opacity,transform,background-color]
  duration-[180ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-100…`.
- **Parâmetros medidos** — slide do painel ≈ 400–600 ms ([INFERIDO] framer/GSAP, curva não
  amostrada frame a frame); hover do chip 180 ms com overshoot; dot +40 ms.
- **Biblioteca/técnica** — React context + framer-motion/GSAP para o slide; hover 100% CSS
  (group-hover).
- **Estratégia para Astro** — nosso menu atual pode ganhar: entrada `translateX(100%)→0`
  com clip octogonal, chips chanfrados com overshoot CSS (`transition transform/opacity
  180ms cubic-bezier(.34,1.56,.64,1)`), e lock do Lenis ao abrir.
- **Riscos** — overshoot em `scale` estoura o clip-path (o pill é clipado junto — testar);
  foco/teclado (Esc fecha? no original fecha via botão; garantir Esc); mobile: painel full-width.
- **Dúvidas em aberto** — easing exato do slide do painel (não capturado em frames).

### 6. Ícones de ferramentas com troca default/hover
- **Comportamento visível** — ícones das ferramentas (Figma, Claude, Photoshop, Illustrator)
  trocam de versão (default → hover) com fade rápido + um notch verde chanfrado acende.
- **Mecanismo** — dois SVGs `<img>` empilhados dentro de `.stat-box--icon`:
  `.tool-logo--default` (opacity 1) e `.tool-logo--hover` (opacity 0). No hover do
  `.stat-box`: default → 0, hover → 1. `.stat-box-notch` (triângulo 16×16,
  `clip-path:polygon(0 0,100% 0,0 100%)`) acende no hover. Os pares são **preloaded**
  (`figma-default.svg` + `figma-hover.svg` etc.).
- **Evidência** — [OBSERVADO] CSS: `.tool-logo--hover,.stat-box:hover .tool-logo--default
  {opacity:0}.stat-box:hover .tool-logo--hover{opacity:1}`;
  `.stat-box-notch{…transition:opacity .15s…}`; `img{transition:opacity .15s}`;
  `<link rel=preload as=image href="…/figma-hover.svg">` no HTML.
- **Parâmetros medidos** — crossfade 0.15 s linear-ish (transition padrão); notch idem.
- **Biblioteca/técnica** — CSS puro (group-hover + opacity), zero JS.
- **Estratégia para Astro** — nos stacks da cena lime: sprite duplo por ferramenta (a arte
  dither já é canvas — desenhar as duas versões e alternar alpha 150 ms), ou duas `<img>`
  empilhadas com preload. Nota: nosso dither runtime pode gerar a versão "hover" com mais
  brilho em vez de dois arquivos.
- **Riscos** — dois assets por ícone (peso); hover em touch não existe — usar toque como
  toggle ou ignorar.
- **Dúvidas em aberto** — nenhum.

### 7. Seção "Snap-shots" (cards de projetos)
- **Comportamento visível** — seção verde-neon "Snap-shots"/"Selected Work" com grid de
  cards (artboard + título + "+"" nos 4 cantos); hover dá zoom sutil na imagem; clique
  navega para `/work/<slug>`; label "Keep Scrolling" acena.
- **Mecanismo** — `.selected-work-outer` (bg `--primary-green-neon`, inicial
  `visibility:hidden` até a transição da seção anterior ativar). Cards `.work-card` ›
  `.work-card-thumb` (aspect-ratio `--ratio:1.236`, sombras duplas) ›
  `.work-card-frame`/`.work-card-mask` (absolute, overflow hidden) › `img.work-card-img`
  (object-fit cover). Hover: `scale(1.04)` na img. Cantos decorativos:
  `work-card-plus-{tl,tr,br,bl}` (SVG plus 8×8). Link via Next `<Link data-sfx>`. A seção
  ainda tem `data-webgl="on"`, `shared-grid-lines` (linhas verticais compartilhadas) e é
  **posicionada via transform** (`translate(0px, 5858px)`) — layout orquestrado por JS.
- **Evidência** — [OBSERVADO] CSS: `.work-card-img{transition:transform .6s
  cubic-bezier(.16,1,.3,1)}`, `@media (hover:hover){.work-card-thumb:hover .work-card-img
  {transform:scale(1.04)}}`, `@media (prefers-reduced-motion:reduce){.work-card-img
  {transition:none}}`; bundle: `["tl","tr","br","bl"].map(… "work-card-plus-${e}" …)`;
  runtime: `data-webgl="on"`, `--box-w/-h/-x` inline, `transform: translate(0px, 5858px)`.
- **Parâmetros medidos** — hover zoom 0.6 s `cubic-bezier(.16,1,.3,1)` (expo-out);
  ratio 1.236 (≈ B5/golden-ish).
- **Biblioteca/técnica** — CSS para hover; GSAP/JS para entrada/orquestração das seções
  (frame/mask prontos para wipe — nossa versão já faz wipe lime).
- **Estratégia para Astro** — manter nosso Snapshots com wipe lime; adicionar zoom 1.04/
  0.6 s no hover da arte, plus nos 4 cantos do card, e "Keep Scrolling" como cue text.
- **Riscos** — transform na seção + sticky interno conflitam (no original resolveram
  posicionando tudo por JS — complexo); hover zoom custa pouco (GPU), mas `will-change`
  só no hover.
- **Dúvidas em aberto** — a entrada dos cards é scrub ou one-shot (na visita já estavam
  assentados a 900px de distância — não capturado); o que o WebGL renderiza na seção
  (possível campo/partículas — não inspecionado a fundo).

### 8. Acordeão "Worked At"
- **Comportamento visível** — 7 linhas numeradas (01–07) chanfradas com empresa + papel e
  marca +/−; a selecionada fica destacada e revela descrição; a seção trava na tela
  enquanto você rola ("dead scroll").
- **Mecanismo** — `.worked-at` (min-height 100dvh) com `.worked-at-stage`: no desktop com
  motion, `--worked-at-dead-scroll:35dvh; margin-top:calc(35dvh − 143dvh)` — **palco com
  scroll morto de 35dvh** (o conjunto fica pinned enquanto o scroll "gasta" esses 35dvh).
  Cada `.worked-at-row` tem clip chanfrado 20px, fundo duplo (bg + `::after` inset 1px),
  botão de 4.25rem com índice/título/papel/mark, e um `.worked-at-row-panel › -inner ›
  p.worked-at-row-description` (altura 0 quando colapsado). Seleção via
  `data-selected` (transições bg .2s, título color .3s). Badge lime chanfrada no heading.
- **Evidência** — [OBSERVADO] CSS: `.worked-at-stage{--worked-at-dead-scroll:35dvh;
  margin-top:calc(var(--worked-at-dead-scroll) - 143dvh)}` sob `@media (min-width:1025px)
  and (prefers-reduced-motion:no-preference)`; `--row-shape:polygon(0% 20px,20px 0%,…)`;
  runtime: clique troca `data-selected="true"` e o mark "+"→"−" (textContent do botão);
  DOM `worked-at-row-panel` com descrição real (h=0 colapsado). Reduced-motion:
  `margin-top:0` (palco desativado) [OBSERVADO runtime].
- **Parâmetros medidos** — linha 4.25rem; chanfro 20px; dead-scroll 35dvh; transições de
  cor .2–.3 s ease-out.
- **Biblioteca/técnica** — CSS (pinning por margin negativa + sticky implícito do fluxo) +
  estado React; painel abre (provavelmente) dirigido pelo scroll do palco.
- **Estratégia para Astro** — nosso WorkedAt já abre por estágio de scroll; adotar o
  dead-scroll como truque de pinning barato (margin-top negativa + altura extra) em vez de
  pin de ScrollTrigger, e o visual de linha chanfrada com fundo duplo + mark +/−.
- **Riscos** — pinning por margin depende de alturas fixas (143dvh calculado para o
  conteúdo!); mobile fica sem pin (media query) — replicar; acessibilidade: botão real
  (é `<button>` — bom) com aria-expanded faltando.
- **Dúvidas em aberto** — a curva de abertura do painel (não amostrada — na visita o painel
  da linha selecionada media 0; a revelação acontece no fluxo do scroll pinado).

### 9. Áudio ("Sound – On")
- **Comportamento visível** — botão "Sound - On/Off" no header; ligar toca música ambiente
  em loop; hovers/clicques produzem sfx curtos; desligar pausa tudo.
- **Mecanismo** — toggle React (`aria-pressed`). Ao ligar 1ª vez: cria a música com
  `new Audio("/sound/ES_Rhythmania 2 - August Wilhelmsson.mp3")`, `loop=true`,
  `volume=.3`, `preload="auto"`, `play().catch()`. SFX: `/sound/sound-hover.wav` e
  `/sound/sound-click.wav` carregados como buffers (helper `i()`), disparados pelos
  elementos `[data-sfx]` (~45) em hover/click; WAVs chegam com Range/206 (streaming de
  buffer). Ao desligar: `pause()`.
- **Evidência** — [OBSERVADO] bundle `0xn5yk79yysjm.js`:
  `o={hover:i("/sound/sound-hover.wav"),click:i("/sound/sound-click.wav")},
  (n=new Audio("/sound/ES_Rhythmania 2 - August Wilhelmsson.mp3")).loop=!0,n.volume=.3,
  n.preload="auto"…e?n?.play().catch():n?.pause()`; rede (janela REA): 4× `sound-hover.wav`
  206, 4× `sound-click.wav` 206, mp3 206; DOM: 45 `[data-sfx]`, **nenhum `<audio>`** no DOM
  fora da música → SFX via WebAudio ([INFERIDO] pelo AudioContext no bundle Three.js).
- **Parâmetros medidos** — volume música 0.3; sfx buscados sob demanda (206 = ranges).
- **Biblioteca/técnica** — HTMLAudio para música + WebAudio para sfx; attribution por
  atributo `data-sfx`.
- **Estratégia para Astro** — nosso chrome já tem SOUND; padronizar: música como
  `<audio loop>` criada lazy no 1º toggle, sfx como buffers WebAudio pequenos, atributo
  `data-sfx` em elementos interativos com delegation de eventos (1 listener para o site
  todo, hover + click).
- **Riscos** — autoplay policy (só tocar pós-gesto — o toggle é o gesto); peso do mp3
  (usar versão curta/loop de ~1 Bar); licença da faixa (a original é Epidemic Sound —
  para o seu site, gerar música própria ou licenciar).
- **Dúvidas em aberto** — se o sfx de hover tem throttle (4 fetches 206 na janela sugere
  buffer único com retries de range, não throttle).

### 10. Transição entre páginas (/ → /work)
- **Comportamento visível** — clicar num card: a página continua no ar por uns instantes
  (estado de saída), o header dá lugar a um navband, e o case study entra sem reload.
- **Mecanismo** — Next.js App Router client-side (fetches `?_rsc=`). Na home, a seção
  tem estado `data-exit`: `[data-exit=active]` → fundo verde vira transparente, links de
  card continuam clicáveis, `.selected-work-navband` (display none → altura
  `calc(var(--nav-height,5rem) + 1px)`) substitui o header. Medição: clique → URL muda
  ~4,2 s depois (espera RSC/animação) → `/work/skymavis` renderiza (título "Ronin Market —
  Curtis Nguyen"), mesmo chrome, sem preloader novo (boot é único).
- **Evidência** — [OBSERVADO] CSS: `.selected-work-outer[data-exit=active]{pointer-events:
  none;background:0 0}… .selected-work-navband{display:none}…[data-exit=active]
  .selected-work-navband{height:calc(var(--nav-height,5rem) + 1px);z-index:1…}`; runtime:
  URL "/" por 4,0–4,2 s pós-clique, depois `/work/skymavis`; rede: 3 fetches `?_rsc=…` 200
  na janela (janela REA F, `evidence/rea-curtis/F-transition.json`). O gap de 4,2 s com
  `data-exit=idle` é [INFERIDO] como animação de saída + prefetch (não capturado o elemento
  que anima nesse intervalo).
- **Parâmetros medidos** — navband = altura do header + 1px; sem preloader na navegação.
- **Biblioteca/técnica** — App Router (RSC over fetch) + estados CSS `data-exit`.
- **Estratégia para Astro** — Astro é MPA: usar View Transitions API
  (`document.startViewTransition` / `transition: view-transition`) para o morph do card →
  case study, com um overlay lime curto no meio; ou Swup/mini router se quisermos SPA-like.
  O padrão "navband substitui header durante a saída" é só estado CSS + tempo.
- **Riscos** — View Transitions: suporte (Chromium ok, Safari 18+, Firefox em curso) —
  fallback = fade simples; o delay de 4 s do original parece exagerado (usar <1 s).
- **Dúvidas em aberto** — o que exatamente anima nos 4 s (wipe? scroll para o topo?);
  `data-exit=active` apareceria no **voltar** (back) — não testado.

---

## Notas de método
- Janelas REA: A (reload/preloader), C (menu), D (seções/hovers), E (worked-at/áudio),
  F (transição), G (`--include-script-sources`). Sondas de runtime via Playwright over CDP
  (mesma página que o REA observava).
- Amostragens: preloader 20–30 ms; odômetro/hero 40–80 ms; curva de roda 25 ms.
- Limitações: dumps DOM do REA não trazem valores de atributo (complementados com
  runtime); curvas frame a frame do slide do menu e do painel do acordeão não capturadas
  (marcado nos alvos 5 e 8); conteúdo do WebGL da seção de projetos não inspecionado.
- Conformidade: apenas front-end público entregue ao navegador; trechos de bundle citados
  ≤10 linhas como evidência; nenhum asset/fonte/texto/áudio copiado.
