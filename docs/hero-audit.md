# Hero audit — Frame 1 layout & type pass

Produção auditada em 2576×1315 (scroll 0%), confirmada no DOM antes de
qualquer correção. Itens do print do usuário julgados um a um.

## 1. Julgamento dos 12 itens

| # | Item | Veredito | Evidência DOM |
|---|---|---|---|
| 1 | Barra de scroll coberta/recortada pelo BR e cruzada pelos textos verticais | **CONFIRMADO** | BR ocupava x2312→2576+ (sangrando); labels verticais do hero + "SCROLL" da rail compartilhavam a mesma coluna ~x2550 |
| 2 | Textos verticais colidem (SCROLL sobre SALVADOR; 0% no retrato; retrato sem respiro) | **CONFIRMADO** | retrato terminava a 12px da lane; labels do hero e da rail na mesma faixa x |
| 3 | Espaços perdidos ("whereengineering", "visual— the") | **CONFIRMADO** | Causa raiz: JSX/Astro remove whitespace de NEWLINE ao redor de elementos inline no fonte — os espaços não existiam no HTML servido. Corrigido na fonte (parágrafos como string única). Asserção automática agora compara texto renderizado × esperado nos 7 viewports: 100% ok |
| 4 | BR cortado na borda e atrás de 95'/SOFTWARE ENGINEER | **CONFIRMADO** | rect do BR cruzava o label do canto (y13–293 × y108) e a borda direita |
| 5 | Tudo pequeno (px fixo em vez de fluido) | **CONFIRMADO** | bio 18.4px e HUD 11.6px num viewport de 2576 (raiz fluida com teto de 20px); nome 152px ≈ 11.5vh |
| 6 | Nome menor que o vazio; centro vazio no 0% | **CONFIRMADO** | nome 152px vs 1315 de altura; centro do hero sem elemento |
| 7 | Margens inconsistentes (32/41/30/70) | **CONFIRMADO** | medidas no DOM: 32/42/~30/51 |
| 8 | Rodapé sem baseline/eixo comum | **CONFIRMADO** | tags/badge/telefone em flex items-end sem eixo comum |
| 9 | Grupo FROM + quadrado + parágrafo apertado | **CONFIRMADO** | quadrado decorativo absoluto a 34% espremido na coluna da bio |
| 10 | 4 cores de destaque em 3 linhas | **CONFIRMADO** | vermelho + ciano + roxo + lime no mesmo bloco |
| 11 | Traços soltos (ticks) | **CONFIRMADO — integrado** | são os colchetes de canto `.ticks` (moldura do retrato) e o índice lime do telefone — ambos mantidos como sistema |
| 12 | Rótulos verticais fracos | **CONFIRMADO** | text-faint (#747785) ≈ 3.4:1 — abaixo de 4.5:1 |

**Achados novos (não listados):**
- N1: o badge na linha de 50% colidia com o cue central (resolvido: cue
  mudou para o vão entre bio e retrato — posição do cue não era fixada
  pela spec).
- N2: em viewport baixo (1366×640) a linha de disponibilidade invadia as
  letras do nome e o label da lane batia no "0%" da rail — resolvido com
  cap de altura na fonte do corpo (2.7vh), aperto da zona média em
  max-height 740px e labels da lane fixados nas extremidades.

## 2. Tokens implementados (um bloco só, global.css)

`--gutter` clamp(16px,1.6vw,44px) · `--rail-lane` clamp(28px,2.4vw,56px)
(mobile 20px) · `--safe-right` = gutter+rail-lane · camadas `--z-ghost/
content/hud/rail/menu/loader` = 1/10/50/60/100/1000 · `--fs-hud`
clamp(11px,0.4vw+6px,15px) · `--fs-body` min(clamp(16px,0.5vw+12px,28px),
2.7vh) — o cap por altura é justificado pelo achado N2 · `--fs-name`
min(8.2vw,16vh); mobile 20vw (~90% da largura).

## 3. Evidência — colisões (script par-a-par, pai↔filho isento, ghost×sem-texto isento)

| Viewport | Colisões |
|---|---|
| 2576×1315 | **0** |
| 1920×1080 | **0** |
| 1440×900 | **0** |
| 1280×720 | **0** |
| 1366×640 | **0** (tinha 5 reais antes do fix) |
| 1024×768 | **0** |
| 390×844 | **0** (modo estático) |

## 4. Evidência — rail exclusiva

`document.elementsFromPoint` no trilho retorna apenas
`.progress-rail__track` → `.progress-rail` → camadas estruturais. Nada
cobre a barra; ela avança 0→100% com o filme (mesma timeline).

## 5. Evidência — margens medidas (±1px do sistema)

| Viewport | esq (=gutter) | dir conteúdo (gutter+lane+folga) | base (=max(3vh,gutter)) |
|---|---|---|---|
| 2576×1315 | 41 | 67 | 41 |
| 1920×1080 | 31 | 57 | 31 |
| 1440×900 | 23 | 49 | 23 |
| 1280×720 | 20 | 46 | 20 |

Topo = gutter por construção (nav fixa com padding-top gutter; o box da
nav mede 0 — conteúdo começa no gutter). Mobile: modo estático, margens
do documento não se aplicam.

## 6. Evidência — fontes computadas

| Viewport | corpo (16–28) | HUD (11–15) | nome |
|---|---|---|---|
| 2576×1315 | 24.9 | 15.0 | 210.4 |
| 1920×1080 | 21.6 | 13.7 | 157.4 |
| 1440×900 | 19.2 | 11.8 | 118.1 |
| 1280×720 | 18.4 | 11.1 | 105.0 |
| 1366×640 | 17.3 | 11.5 | 102.4 |
| 1024×768 | 17.1 | 11.0 | 84.0 |
| 390×844 | 16.0 | 11.0 | 78.0 |

Nada abaixo de 11px em nenhum viewport.

## 7. Flipbook intacto

- Roda na banda do hero: 24 pares de 50px → **0 quadros idênticos**
  (diffs 1.4–3.8 por passo)
- Console: **0 erros** (`window.__pageErrors`)
- Timeline intocada (apenas 1 seletor renomeado: `.text-ember` →
  `[data-avail]`, mesmo elemento, mesmo comportamento)

## 8. Decisões de design tomadas

- **BR fantasma**: opção (a) — inteiro na tela, 5% de opacidade,
  pointer-events none, z-ghost, ancorado na borda segura abaixo dos
  labels de canto (região sem texto).
- **Cores de destaque**: lime = marca (FROM, `<studio-lab/>`, badge,
  linha de disponibilidade); violeta = única secundária ("graphic art."
  itálico). "code" e o travessão voltaram a branco. Vermelho restou só
  nos dois quadrados decorativos.
- **Cue "Scroll down"**: mudou para o vão bio↔retrato (posição não
  fixada pela spec; colidia com o badge na linha de 50%).
- **Labels verticais**: duas slots fixas nas extremidades da lane
  (topo NASA ×2, base SALVADOR — BR), contraste `--color-dim` ≈ 7:1.

## 9. O que NÃO ficou perfeito (honestidade)

- A margem direita medida (67/57/49/46) inclui a folga de 16px do
  retrato além da borda segura — o sistema é gutter+lane+16; se a
  intenção era o conteúdo EXATAMENTE na borda segura, a folga do
  retrato é um desvio consciente (respiro pedido no item 2).
- O quadrado vermelho decorativo da bio foi movido para o eixo do
  gutter (esquerda), não mais "entre" FROM e o parágrafo — o aperto do
  item 9 foi resolvido por realocação, não por reposicionamento fino.
- Em 390×844 o filme é estático por design (aprovado em rodada
  anterior); a auditoria de colisão mobile vale para o layout estático.
