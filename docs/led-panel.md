# LED Panel — a placa de LEDs (motor reconstruído)

> Cena entre a hero e a tela verde. Commit: `panel: LED board rebuild`.
> Motor: `src/scripts/led-wall.ts` (Canvas2D discreto). Suíte: `scripts/ledpanel-accept.mjs` (17/17).

## 1. Auditoria do motor anterior (WebGL2, commit 205e115)

**O que era**: um fragment shader de tela cheia com pipeline HDR (FBOs RGBA16F),
bloom gaussiano em meia resolução, tone map `1-exp(-x)`, vinheta e dither.
Visível no trecho de scroll p ∈ [0.056 (início da onda de ignição), 0.2705
(fim da varredura lime)]; pleno em ~15%. Driver do campo e das gotas: **tempo**
(rAF/uTime); scroll só scrubava ignição (entrada) e varredura lime (saída).

**Manchas**: fBm de 3 oitavas (value noise) com domain warp, escala 0.22 células⁻¹,
deriva 0.9 células/s para baixo, limiarizado por smoothstep — e multiplicado por
`0.35 + 0.55·hash(célula)` — **sorteio de tom por célula** (a incoerência dos prints).

**Gotas (os bugs)**: por coluna, um "slot" re-sorteado a cada 3.2 s;
`head = mod(t·spd + fase·period·3, period)` com **fase aleatória** →
nasciam em qualquer y da tela. Reproduzido em 30 quadros: nascimentos no meio
(col 11@y440, 24@y696, 27@798, 33@320…), morte+renascimento na mesma coluna
entre quadros consecutivos (col 27: y798 → y422), cabeças fora da grade
(y=46-58 ≠ múltiplos de 17.1), "cabeça" de ~2 células.

**Cabeça = sprite**: núcleo quadrado interno (inset 30%) na cor
`#d6ffd6` (branco-menta) sobre a célula — os "dois quadradinhos".
**Halo/borda macia**: bloom gaussiano + SDF com anti-alias de 1.25 px +
células em pixels flutuantes (17.1·dpr, não inteiros).

**Números de hoje (referência)**: célula 17.1 px CSS (17.1/34.2 device,
fracionários); 110×56 (1878×946); ~60% acesas; ~44 fios simultâneos;
velocidade média ~16 células/s; rastro médio 18 células; tons **contínuos**
(129 buckets de 4-bit num recorte 800×500); matiz OKLCH 142.8°, croma 0.25-0.28.

**Overlays sobre o canvas (só reporte)**: `.noise-layer` (grão SVG feTurbulence,
`global.css:197`, z 90, opacidade 5.5%) — o granulado fino; vinheta no shader
(0.16) — **removida** no motor novo (paleta fechada); sem scanlines.

## 2. O modelo novo — placa de LEDs

- **Grade**: `cellDev = round(17.1 × dpr)` px de dispositivo INTEIROS, ancorada
  no canto superior esquerdo; `cols = ceil(Wdev/cellDev)`, `rows = ceil(Hdev/cellDev)`.
  A última coluna/linha pode ficar cortada pela borda, mas existe.
- **Todas as células existem**: `level: Uint8Array(cols·rows)` (0-6); toda célula
  é desenhada com a cor do seu nível (inclusive a apagada). Uma escrita por
  célula por frame, `fillRect` em coordenadas inteiras,
  `imageSmoothingEnabled = false`. Sem filter/shadowBlur/globalAlpha/blend.
- **Fresta**: `gapDev = max(1, round(cellDev·0.06))` na cor exata do fundo
  `#070210`, pintada no próprio canvas (o substrato é opaco onde a placa está
  desenvolvida; durante a ignição, só a faixa atrás da frente).
- **Um LED por posição**: `final = max(base, gota)`. Nenhuma segunda camada.
- **Rampa (7 tons, literal)**: OKLCH com matiz 142.8° e croma de hoje, L
  equidistante 0.11→0.90, croma limitado ao gamut por nível. ΔE_OK entre
  consecutivos 0.13-0.16 (média 0.147, todos ≥ 0.05), luminância monotônica.
  `?ramp=lime` gera o equivalente a partir do `--lime` do site.

  | nível | hex | papel | Y (lin) |
  |---|---|---|---|
  | 0 | `#050f06` | apagado (1.16:1 vs fundo) | 0.0035 |
  | 1 | `#023902` | corpo escuro | 0.0291 |
  | 2 | `#036105` | corpo | 0.0853 |
  | 3 | `#048c07` | corpo | 0.1878 |
  | 4 | `#04ba0a` | corpo | 0.3506 |
  | 5 | `#02ea0e` | corpo claro | 0.5877 |
  | 6 | `#b8ffb2` | cabeça | 0.8612 |

- **Tom = campo**: `I(x,y,t)` = value noise 3 oitavas (ganhos 0.62/0.24/0.14),
  escala 0.22 células⁻¹ (= hoje), deriva 0.9 células/s. Quantização em 0-5 por
  limiares fixos `[0.455, 0.555, 0.645, 0.725, 0.80]` com histerese ±0.03.
  Pós: filtro de moda 3×3 + duas varreduras de Lipschitz (|Δ|≤1 vs vizinhos)
  — coerência medida: **0 isoladas, 0 pares Δ≥3, 0% Δ2**.
  Cobertura: 60% (base) / 65% (com gotas) — hoje ~60% ±5 pp.
- **Gotas = estado de célula**: `{col, head (linha INTEIRA), p, TRAIL}`; passo
  discreto de 1 célula a cada p∈{2,3,4,6} ticks de 33.3 ms (acumulador,
  catch-up ≤5). Escada determinística: `d=0 → 6; d≥1 → max(0, 5−⌊(d−1)·5/TRAIL⌋)`.
  Ciclo por coluna via PRNG com seed: nasce com head<0, morre inteira abaixo;
  ≥4 células de intervalo na mesma coluna; duty 0.34. Pré-aquecimento:
  meio-tabuleiro de histórico no primeiro quadro (gotas já em voo).
  Medido: **46 gotas** (hoje ~44 ±20%), rastro 16.8 (18 ±20%),
  velocidade média 12.9 células/s (hoje 16; **limite estrutural** de p≥2 com
  tick de 33.3 ms — modal 15 células/s a p=2, −6%).
- **Função pura de (seed, driver)**: `hashAt(tick)` idêntico por recarga/rota
  (suíte #10). O quadro exibido avança só quando o tick avança; repintura
  só em mudança (tick/scrub/resize) — p95 de JS **2.3 ms**, avg 0.4 ms.
- **Scroll preservado**: onda de ignição (células à frente da frente ficam
  transparentes; crista no nível 6) e varredura lime (fileiras viram `#9df133`
  exato, frente quantizada com jitter por coluna) — mesmas janelas, reversíveis.

## 3. Debug e sonda

`?panel=base|drops|grid|ramp|nogap` · `?ramp=lime`.
`window.__panel = { cols, rows, cell, gap, ramp, levels(), drops(), drawCount(),
hash(), hashAt(t), tick() }` — somente leitura.

## 4. Constantes (topo de led-wall.ts)

`SEED 0x9e37` · `TICK_MS 33.3` · `MAX_CATCHUP 5` · `COLUMNS_PER_WIDTH 17`
(min 36, máx 120) · `FIELD_SCALE 0.22` · `FIELD_DRIFT 0.9` ·
`OCTAVE_GAINS [.62,.24,.14]` · `THRESH [.455,.555,.645,.725,.80]` · `HYST .03` ·
`DUTY .34` · `P_CHOICES [2,3,4,6]` · `P_WEIGHTS [.72,.18,.06,.04]` ·
`TRAIL 10-24` · `MIN_GAP_CELLS 4` · `WAVE_JITTER 3` · `SWEEP_JITTER 4` ·
`GAP_RATIO .06` · `RAMP_GREEN/LIME` · `COLOR_BG #070210` · `COLOR_LIME #9df133`.

## 5. Observações (só reporte, NÃO alterado)

1. **Contraste do HUD/trilho**: tinta `#f5f0eb` sobre o nível 6 `#b8ffb2` =
   **1.03:1**; sobre o nível 5 = 1.45:1; sobre o lime = 1.23:1. A máscara de
   luminância do motor anterior foi removida pela regra da paleta fechada
   (cores intermediárias violariam os ≤9 tons). Se precisar de 4.5:1 de volta,
   as opções são: escurecer `--hud-ink` nesta cena, reintroduzir zonas
   apagadas (nível forçado 0) atrás da UI, ou aceitar (texto grande/HUD).
2. **Granulado**: `.noise-layer` (chrome global) — continua sobre a placa.
3. **Verde vs lime do site**: placa OKLCH H **142.7°** C 0.274 vs `--lime`
   H **131.4°** C 0.224 — a placa é ~11° mais fria/azulada e mais cromática,
   fiel às referências. `?ramp=lime` compara ao vivo.

## 6. Aceite por pixel

`scripts/ledpanel-accept.mjs` — 17/17 PASS no build novo; **falha em 1/2/5/7**
no commit anterior (teste do teste ✓). Evidências: `evidence/panel-*`.
Mobile 390: placa 1×1 — página estática ≤700 px continua em branco
(**preexistente**, documentado desde a Task A).
