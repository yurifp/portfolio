# Vocabulário de movimento — cena lime (12–30%)

Base para aplicar a mesma linguagem nas outras cenas do flipbook.
Toda janela é fração do progresso GLOBAL (0–1 do filme). Tudo por
scrub (posição de scroll), fromTo explícito, ease none exceto onde
indicado. Arquivo: `src/scripts/flipbook.ts` (bloco LIME SCENE).

## 1. Wipe de entrada (12.0–13.5)
- Elemento: `[data-flip-frame="lime"]` (o frame inteiro)
- Propriedade: `clip-path: inset(100% 0% 0% 0%)` → `inset(0% 0% 0% 0%)`
- Direção: de baixo para cima (revela o lime do rodapé ao topo)
- Janela: 0.120 → 0.135, duração 0.015 — flipbook.ts:~160

## 2. Recolor do HUD (13.0–13.5)
- Elemento: `--hud-ink` no `:root` (nav + trilho)
- Propriedade: interpolação RGB clara(#f5f0eb) → tinta(#070210)
- No onUpdate do ScrollTrigger (função ramp), não é tween — flipbook.ts:~95

## 3. Linhas de coluna (13.5–14.5)
- Elemento: `.lime-line` (7x, uma por borda de coluna)
- Propriedade: `scaleY: 0 → 1`, origin top
- Stagger: 0.0008 entre linhas (cada uma 0.006 de duração)
- flipbook.ts:~168

## 4. Abertura do card (0–0.35 da janela)
- Elemento: `[data-lime-reveal]` (wrapper de clip, um por card)
- Propriedade: `clip-path: inset(0% 100% 0% 0%)` → `inset(0% 0% 0% 0%)`
  + `opacity: 0 → 1` (entra rápido, sem meio-tom)
- Direção: esquerda → direita; unidades % consistentes
- Janela local: at → at + 0.35 × windowDur — flipbook.ts:~186

## 5. Label letra a letra (0.2–0.6 da janela)
- Elemento: `[data-lime-label]`
- Propriedade: `yPercent: 60 → 0` + `opacity: 0 → 1`
- Janela local: at + 0.2×dur → at + 0.6×dur — flipbook.ts:~190

## 6. Odômetro / número (0.35–0.85 da janela)
- Elemento: colunas `.odo-digit__col` dentro de `[data-lime-odo]`
- Propriedade: `translateY(-N×10%)` por progresso p (0→1),
  proxy `{p}` animado, onUpdate aplica dígitos — flipbook.ts:~146
- Cards de ferramenta: em vez do odômetro, o dither resolve (item 7)

## 7. Dither scrub grosso→fino (0.35–0.85 da janela)
- Elemento: canvas `[data-dither-icon]` (via dither.ts mountDitherIcon)
- Propriedade: resolução `r: 6 → 28` (redesenho só quando muda o inteiro)
- Janela local: at + 0.35×dur → at + 0.85×dur — flipbook.ts:~200

## 8. Parallax alternado (27.4–29.0)
- Elemento: `[data-lime-card]` (14x)
- Propriedade: `y: +clamp(4-8px) → -clamp(4-8px)`, colunas alternam sinal
- Nunca parado: a composição completa respira durante o hold
- flipbook.ts:~213

## 9. Saída (29.0–30.0)
- Cards: `yPercent: 0 → -40` (sobem ~8vh), stagger por coluna i%7 × 0.0015
- Wipe recolhe: `inset(0% 0% 100% 0%)` (para cima), frame autoAlpha→0
- Entrega EXATA no quadro de entrada da cena snap (30%) — flipbook.ts:~220

## 10. Janelas de entrada (14 cards)
- 14 janelas de 2.0% cada, passo 0.84%, início 0.142
- Ordem: linha a linha, esquerda→direita (stats linha 1, stacks 2–4)
- Último card termina: 0.142 + 13×0.0084 + 0.02 ≈ 0.271 (antes do parallax)
