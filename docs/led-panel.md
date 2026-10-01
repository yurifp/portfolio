# LED Panel — a placa de LEDs

> Cena entre a hero e a tela verde. Commits: `panel: LED board rebuild` (placa)
> e `panel: single energy field, rain depth, cell bloom` (modelo vigente).
> Motor: `src/scripts/led-wall.ts`. Suítes: `ledpanel-accept.mjs` (17/17, round
> anterior) e `ledpanel-check.mjs` (**18/18 ×3**, round atual).

## 0. Modelo vigente — um campo de energia

A placa aprovada permanece (grade inteira, célula sólida, fresta na cor do
fundo, paleta fechada, janelas de scroll). O que mudou é COMO a célula acende:

```
E_total = 1 − (1 − E_amb)(1 − E_rain)     soma suave: UM buffer, UMA passada
E_amb   = manchas (pipeline de hoje, teto 0.40) + κ·ρ   (a mancha pega a luz)
E_rain  = pico·exp(−(t − t_passagem)/τ)   persistência física por gota
level   = round(11 · E^(1/γ)), γ = 1.6    LUT única (12 níveis)
bloom   = max(level, ⌊0.30·melhor ortogonal≥6⌋, ⌊0.20·melhor diagonal≥6⌋)
```

- **A mancha reage**: ρ = densidade local de chuva (máscara E_rain>0.2, caixa
  ±3 col × ±4 lin, soma separável), κ = 0.50. O feed só se aplica onde a célula
  NÃO carrega chuva — cabeças nítidas, rastros monotônicos. Medido: +0.65
  nível no conjunto de manchas a ≤3 colunas de gota ativa.
- **Chuva com profundidade** (3 classes): v = 0.6×/1.0×/1.7× de 0.432 c/tick,
  pico E = 0.52/0.75/1.00 (cabeças 7/9/11), τ = 6.5/6.2/5.3 ticks → rastro
  visível medido 4.4/8.1/12.8 células (∝ velocidade). Pesos de nascimento
  [0.21, 0.42, 0.37] compensam o tempo de vida → presença VISÍVEL 45/35/20.
- **Nasce acima (head < 0), morre abaixo** — zero eventos em célula visível
  (log da suíte). Mesma coluna: ≥8 células de folga. Densidade 51-56% das
  colunas com gota (alvo 45-60%).
- **Acoplamento**: taxa de nascimento ∝ média vertical de A0 da coluna,
  amplificada ×8 (a média vertical do ruído é estreita por construção) com
  piso 0.35× — nenhuma coluna seca. Pearson = 0.74, min/média = 0.39.
- **Função pura de (seed, driver)**: `hashAt(tick)` idêntico por qualquer
  rota; repintura só de células que mudaram; p95 de JS 2.7-3.7 ms a 2576×1300.

### Rampa (12 níveis, OKLCH H 142.5-142.8, literal)

| k | hex | k | hex |
|---|---|---|---|
| 0 | `#020602` | 6 | `#038409` |
| 1 | `#020f02` | 7 | `#02a00b` |
| 2 | `#011e01` | 8 | `#00be0e` |
| 3 | `#023502` | 9 | `#12dc1b` |
| 4 | `#034e04` | 10 | `#72f16d` |
| 5 | `#036806` | 11 | `#c9fbc4` (cabeça, L_OK 0.939) |

ΔE_OK consecutivo 0.042-0.143 (≥ 0.02), luminância monotônica. `?ramp=lime`
gera o equivalente a partir do `--lime` do site.

### Parâmetros finais (topo de led-wall.ts)

`SEED 0x9e37` · `TICK_MS 33.3` · `COLUMNS_PER_WIDTH 17` (36-120) ·
`FIELD_SCALE 0.22` · `FIELD_DRIFT 0.9` · `OCTAVE_GAINS [.62,.24,.14]` ·
`THRESH [.455,.555,.645,.725,.80]` · `HYST .03` · `AMB_CAP .40` ·
`MAP12 [0,2,4,7,9,11]` · `CLASSES v .6/1/1.7 · peak .52/.75/1.0` ·
`CLASS_WEIGHTS [.21,.42,.37]` · `BASE_SPEED .432` · `TAU_TICKS [6.5,6.2,5.3]` ·
`RAIN_DUTY .62` · `RATE_FLOOR .35` · `COUPLE_GAIN 8` · `SAME_COL_GAP 8` ·
`KAPPA .50` · `RHO_BOX ±3×±4` · `RHO_NORM 12` · `GAMMA 1.6` ·
`BLOOM_ORTH .30` · `BLOOM_DIAG .20` · `BLOOM_MIN 6` · `GAP_RATIO .06`.

### Debug e sonda

`?panel=base|drops|grid|ramp|nogap` · `?bloom=0` · `?depth=0` · `?feed=0` ·
`?ramp=lime` · `?t=N` (congela o driver; só teste).
`window.__panel = { layers, cols, rows, cell, gap, ramp, levels(), energy(),
drops(), birthsIn(t0,t1), rainDensity(), drawCount(), hash(), hashAt(t), tick() }`.

### Preservação medida

`?panel=base`: bandas 40.6/30.5/20.1/8.7 vs hoje (mapeado 7→12)
40.5/29.9/20.4/9.2 — ±0.5 pp; cobertura 59% vs 59.5%. Célula, grade, fresta,
matiz e janelas idênticos ao aprovado. Suíte atual: **18/18 ×3 rodadas**;
no commit anterior falha em 1/3/7/8/9/13 (teste do teste).

### Observações (só reporte)

1. **Contraste do HUD/trilho**: tinta `#f5f0eb` sobre a cabeça `#c9fbc4` =
   1.03:1 (nivel10 1.28:1 · nivel9 1.64:1 · lime 1.23:1). Sem máscara por
   regra da paleta fechada.
2. **Ponto branco no canto superior esquerdo do print (21%)**: o cursor
   customizado do chrome (`main.ts`, dot persistente) — não é célula (a
   célula (0,0) fica sob o logo, x≥31).
3. **Verde vs lime**: H 142.7° C 0.274 vs `--lime` H 131.4° C 0.224.

---

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

---

## 2. Motor da chuva (reescrito — "fios, não bolas")

O campo único permanece; o que mudou é a CHUVA (e o ambiente foi rebaixado):

- **Ambiente sutil e anisotrópico**: `AMBIENT_LEVEL 0.22` (era 0.40) e ruído
  amostrado com frequência vertical ÷`AMBIENT_ANISO 9` (feições ≥8:1 mais
  altas que largas, deriva 0.45 c/s) — nunca mais bolas: aspecto mediano dos
  componentes 0.75:1 → 2.95:1. Continua acendendo na passagem (κ·ρ).
- **Fios analíticos por coluna** (função pura de t_chuva): fase por coluna =
  fase da cortina (banda de 2-6 colunas, `BAND_COHERENCE 0.78`) + jitter;
  ciclo T = (rows+cauda+folga)/v; **cabeça contínua** `h = frac((t+fase)/T)·ciclo −
  cauda`; brilho por célula da distância contínua d = h − linha (sem
  arredondar) — movimento suave em qualquer frame rate. Antecipação fraca
  (0.10) 1 célula à frente.
- **3 camadas** (c/s · cauda · brilho · share do ciclo): longe 6-9 · 6-10 ·
  0.30 · 0.52 · ~25% das colunas; meio 10-16 · 10-18 · 0.60 · 0.28; perto
  18-28 · 14-30 · 1.0 (núcleo quente nível 11) · 0.22. ±15% de v por coluna.
  `LIVE_COLUMNS 1.25` (calibrado: ~50-51% das colunas em voo).
- **Spill** 0.22 para 1 coluna de cada lado (corpo de 2-3 colunas).
- **Persistência LED**: cabeça pino no pico; rastro `bright·(1−u)^1.15·e^(−0.8u)`;
  **brasas** (16% das células retêm 0.32 até 1.7× a cauda); **sparkle** ±6% a
  6 Hz com probabilidade decrescente para a ponta; quantização com banda
  suave de 40% (histerese temporal — bandas não marcham).
- **Ritmo**: respiração da densidade (ruído 1D, período 18 s, profundidade
  35%); **cometas** (nascimento a cada 5-9 s, altura 85% das rows, 34 c/s,
  núcleo quente, nunca dois juntos; desligados em reduced-motion).
- **Tempo**: `t_chuva += dt·mult` (dt ≤ 50 ms), nunca t×v; mult suavizado
  (τ 400 ms) com **acoplamento ao scroll** até +35% (`SCROLL_SPEED_COUPLING`);
  aba oculta retoma sem salto. Reduced: mult 0.3, sem cometas/acoplamento.
- **Integração**: chuva já viva na onda de ignição (warm-up 2.6 s); varredura
  lime inalterada; pintura suja mantida.

Verificação (`scripts/rain-verify.mjs`, **12/12**): densidade 50-51%;
monotonia das cabeças (0 retrocessos); aspecto das estruturas móveis ≥3:1;
brilho p95 ≤25%/frame fora do ataque; continuidade sob roda (pior avanço
≤2.5 células/frame); 60 s sem janela de 3 s repetida; p95 JS DPR1/DPR2;
onda com chuva viva; console limpo. Evidências: `evidence/rain-*`.

### Checagem rápida (bloom/cantos/grade) — look intencional

- **Sem halo suave**: o bloom do motor atual é POR CÉLULAS (degrau de níveis
  em vizinhas, spec do round "board") — não existe blur/glow de pixel desde a
  paleta fechada (regra dos ≤14 tons, round aprovado).
- **Cantos quadrados**: o round "board" especificou fillRect inteiro sem
  sprite — cantos arredondados saíram com o motor WebGL.
- **Grade como linhas finas escuras**: é a fresta de 1 px na cor exata do
  fundo (spec). Nenhum tier caiu (o motor 2D não tem tiers; frame p95 ~3 ms).

---

## 3. Motor de CAMPO de LEDs (reescrita arquitetural)

Substitui o procedural por coluna (§2, removido sem código morto). A placa,
paleta, bloom, transições e tiers seguem idênticos.

### Estado por LED
Typed arrays (E, Gin, G, shim, gain/atkT/decT por hash do índice). A cada
frame: entrada = soma suave `1−Π(1−c)` dos diretores; ataque rápido
(τ≈12ms±20%); decaimento de fósforo não-linear (τ 0.2s no alto, ~2× mais
lento no baixo → brasas); spill 5% para os 8 vizinhos; ganho ±8%;
glints Poisson independentes (0.02/s, τ 120ms); shimmer random-walk
MULTIPLICATIVO ±4%. Substeps ≤33ms ⇒ 10/60/144 fps idênticos (medido 0.6%).

### Diretores (interface comum: escrevem em Gin, coordenadas contínuas de LED)
- **RainDirector**: gotas livres (pool SoA 1500, x/y contínuos, NADA por
  coluna) — kernel anisotrópico gaussiano σx + cabeça quente + cauda
  exponencial + antecipação fraca; 3 camadas (6-9/10-16/18-28 LED/s,
  brilho 0.45/0.95/1.15, σx 0.45/0.6/0.9, ±15% v); ease-in nos primeiros
  20% da altura; vento curl-noise ±1.2 LED/s com rajadas (9s); nascimentos
  por ruído azul 1D (mapa de resfriamento, offset sub-coluna completo);
  fusão (<1 LED, mesma camada, a rápida absorve) e divisão rara; saída pela
  borda e o rastro apaga sozinho no campo.
- **CometDirector**: 1 cometa por 5-9 s (85% da altura, 34 LED/s, núcleo
  quente), nunca dois juntos; desligado em reduced-motion.
- **ExposureController**: malha fechada na luminância de EXIBIÇÃO média
  (nível/11) → alvo 0.27 com τ≈3s, ajustando a taxa de nascimento (0.5-2.2×).
- Futuros (interface pronta, NÃO implementados): cursor, texto/logo, imagem.

A onda de ignição e a varredura lime seguem na camada de render (paint),
lendo `level[]` — visualmente idênticas. A máscara de UI e tiers do motor
WebGL não existem desde a paleta fechada (reportado). O acoplamento ao
scroll (≤+35%, τ 400ms) agora multiplica a INTEGRAÇÃO (posições
incrementais — mudança de velocidade nunca pula).

### Tempo e robustez
`t += dt·mult` com dt real (cap 250ms anti-freeze; substeps 33ms);
`?fps=N` coalesce frames para testes; pausa fora da viewport preserva o
estado (t0 resetado ao retomar); aquecimento rápido de 8s em fatias de 50ms
(a cena nasce chovendo em todas as alturas); reduced: 30% da velocidade,
sem cometas/fusão/acoplamento. `?tune=1`: painel leve de sliders + copy JSON.

### Verificação (`scripts/field-verify.mjs`, headed, **13/13**)
χ² nascimentos 13.5 (crit 16.9) — nada preso a coluna · 0 retângulos
uniformes 5×10 · aspecto por gota 4.36:1 · 0 retrocessos/saltos em 55k
amostras por frame · estabilidade p95 9.7%/frame · luminância 0.269
[0.23-0.30] com picos 3.1% · sim/real 60 vs 10fps = 0.6% · aquecimento com
gotas nas 4 bandas · 60s sem repetição · p95 frame 2.0-2.1ms (sim
1.4-1.5ms) DPR 1 e 2 · console limpo. Evidências: `evidence/field-*`.

**Desvios reportados**: células apagadas ~1% (alvo 35-45%) — incompatível
fisicamente com a banda de luminância 0.22-0.32 sob chuva contínua; o
equilíbrio se move com UMA constante (EXPOSURE_TARGET). Amostragem por
gota no teste de aspecto (cortinas legítimas fundem componentes conectados).
