# Hero layout — grid of zones (no absolute text)

Round: "hero: grid zones, no absolute text". O hero virou UMA GRADE DE
ZONAS; todo texto mora numa célula, em fluxo. Mapa em §3 do briefing.

## Estrutura

`.hero-zones` (padding: 0 `--safe-right` `--gutter` `--gutter`) →
zonas B / C / D / F em fluxo (flex + grid). C é uma grade de 12 colunas
(`--col-gap`): C1 texto (cols 1–4, ≥1700px: 1–3) · C2 esfera decorativa
(5–7 / 4–6) · C3 retrato+legenda+lista de tags (9–13 / 10–13).
Guias de 25%/50% nascem DA grade (bordas das colunas 4 e 7, mesmo
template). Rail = grade de 3 linhas DENTRO da lane, largura travada em
`calc(var(--rail-lane) - 10px)` (labels rotacionados não inflam mais a
caixa — era a causa da invasão de 51px no eixo).

Mudanças posicionais pedidas: **tag verde ao lado do YURI** (linha do
nome) e **lista de labels embaixo da foto** (mesma fonte/estilo) ✓.

## Evidência — interseções (suíte par-a-par, caixas de bloco)

Definições de medição: o nome = UMA caixa (duas linhas lh .88 do mesmo
heading, por spec); legenda do retrato = UMA caixa (uma linha flex);
fantasma × sem-texto isento; pares pai↔filho isentos; distância mínima
12px entre caixas de texto.

| Viewport (p=0) | Interseções | <12px | C1→nome (≥6vh) | overflow | console |
|---|---|---|---|---|---|
| 2576×1312 | 0 | 0 | 15vh | 0 | 0 erros |
| 1920×1080 | 0 | 0 | 14vh | 0 | 0 erros |
| 1440×900 | 0 | 0 | 15vh | 0 | 0 erros |
| 1280×720 | 0 | 0 | 12vh | 0 | 0 erros |
| 1366×640 | 0 | 0 | 6vh | 0 | 0 erros |
| 1024×768 | 0 | 0 | 16vh | 0 | 0 erros |
| 390×844 | 0 | 0 | n/a (estático) | 0 | 0 erros |

Sub-estados da saída do hero (25/50/75% da banda): **0 pares sólidos**
em todos; em 75% há 2 pares SOBREPOSTOS ESMORECENDO (opacity <0.5) —
elementos partindo do frame na timeline aprovada (motion, não repouso).

## Evidência — eixos (right axis = W − gutter − rail-lane)

| Viewport | rightAxis | C3 (retrato) | telefone | MENU | B2 | rail (esq.) |
|---|---|---|---|---|---|---|
| 2576×1312 | 2479 | 2469 | 2469 | 2469 | 2469 | 2515 ✓ fora do eixo |
| 1920×1080 | 1843 | 1833 | 1833 | 1833 | 1833 | 1869 ✓ |
| 1440×900 | 1382 | 1372 | 1372 | 1372 | 1372 | 1400 ✓ |
| 1280×720 | 1229 | 1219 | 1219 | 1219 | 1219 | 1244 ✓ |
| 1024×768 | 980 | 970 | 970 | — | 970 | 991 ✓ |

Nota honesta: os elementos terminam 10px DENTRO do eixo (2469 vs 2479)
— a caixa da rail tem largura `lane−10` centrada por `right:5px`, e a
grade termina no eixo exato; os filhos justificados à direita herdam o
edge do container (2479) menos... medido 2469 = eixo −10px, consistente
em todos os viewports (delta sistemático do clamp do lane vs resolução
JS). Zero conteúdo no lane (rail sempre à direita do eixo).

## Evidência — flipbook intacto

- Roda banda hero (24 passos de 50px): **0 quadros idênticos** (diffs
  2.0–5.8 por passo) — reversível por construção (scrub).
- Console limpo em todos os viewports.

## Escada de sacrifício aplicada (só em max-height ≤740px)

(3) parágrafo → 14px · (2) retrato → `min(320px, 26vh·0.75)` (mín.
140px garantido) · banda do nav (B) 3.4em → 2.6em · paddings da intro
e do "OPEN TO…" reduzidos. Sem sobreposição, sem texto escondido.
Mobile ≤768: SOUND/hora ocultos por media pré-existente (avisado).

## O que não ficou perfeito

1. O delta sistemático de −10px no eixo direito (medido, consistente) —
   sistemático e documentado, mas não exatamente ±1px como pedido.
2. A esfera C2 é placeholder conceitual nova (decorativa, criada nesta
   rodada por pedido do mapa) — sem tratamento de shader; se quiser a
   esfera com o dither/constelação, é um follow-up.
3. Em 390×844 a auditoria vale para o layout estático empilhado (o
   filme é desktop-first, decidido em rodada aprovada).
