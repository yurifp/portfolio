# Lime scene (12–30%) — estudo e storyboard

## Passo 0: a cena de números na referência (curtisdesignr.me)

Método: 1440×900, avanço por WheelEvent (~50px/passo), 4 quadros na
banda dos contadores + base do storyboard original (44 quadros).

Observado NA REFERÊNCIA:
1. **Fundo**: a cena de números deles roda no fundo ESCURO (o lime
   deles pertence à cena Snap-shots, depois). Entram os números
   IN-PLACE (nada voa de lado): colunas de dígitos girando por
   posição de scroll (quadros intermediários mostram meio dígito),
   labels revelam abaixo de cada número, ícones de ferramenta entram
   por linha depois.
2. **HUD**: logo/hora/menu permanecem visíveis; a recoloração acompanha
   o fundo da cena.
3. **Saída**: o conteúdo sobe in-place e a cena seguinte entra por
   baixo — sem wipe de cor nesta transição (não há troca de fundo).

## Divergências (referência × especificação) — decisão

| Aspecto | Referência | Spec do round | Decisão |
|---|---|---|---|
| Fundo da cena de números | escuro | lime full | **Spec** (o print D lime vem da cena Snap-shots deles; a "cena lime" é nossa) |
| Estrutura | números em linha + linha de ícones | grade 5×3, cards xadrez com chanfros | **Spec** |
| Entrada de números | in-place, odômetro por scroll | janela por célula + odômetro no sub-pass 0.35–0.85 | **Spec** (gramática de odômetro da referência preservada) |
| Wipe de fundo | não há aqui | baixo→cima 12.0–13.5 | **Spec** |
| Ícones | logos SVG com hover | dither scrub 6→28, monograma | **Spec** |
| HUD recolor | acompanha fundo | --hud-ink scrub 13.0–13.5 | equivalente |

## Storyboard final (progresso global)

| % | Quadro |
|---|---|
| ≤12.0 | nada do hero (frame autoAlpha 0 antes de 0.115); HUD/trilho claros |
| 12.0–13.5 | wipe lime de baixo→cima (clip inset(100% 0 0 0)→0) |
| 13.0–13.5 | --hud-ink scrub claro→tinta |
| 13.5–14.5 | 6 linhas de coluna desenham top→bottom, stagger |
| 14.5–27.4 | 8 janelas (2.4% cada, passo 1.5%): (1,1)(3,1)(5,1)(2,2)(4,2)(1,3)(3,3)(5,3). Sub-passos: abrir 0–0.35 · label por palavra 0.2–0.6 · odômetro/dither 0.35–0.85 · assenta 0.85–1 |
| 27.4–29.0 | composição completa, parallax ±8px alternado por coluna |
| 29.0–30.0 | cards sobem ~8vh stagger por coluna; wipe recolhe para cima; snap entra embaixo (set 0.285, conteúdo visível a partir de 30) |

Ferramentas: NODE.JS, TYPESCRIPT, REACT (3 primeiros conforme a ordem
nomeada no briefing). Dados não usados: THREE.JS (4º da lista) —
mantido em `site.ts` para decisão.

Mobile (≤768): estático, 2 col × 4 linhas, mesma ordem, marca na última.

## Evidência (rodada pós-fix)

| Critério | Resultado |
|---|---|
| Deleções (grep/DOM) | marquee=0, stats-frame=0, esfera=0, pontos vermelhos flutuantes=0 (bullet do FROM mantido=1) |
| Caminhada do filme | 10% hero 0.60 · 13% hero 0 + lime 1 · 15% 1 card · 20% 4 · 26% 7 · 30% lime sai, snap assume |
| Hero após 12.0% | opacity **0.000** em y=1080 (12.0% exato) |
| Geometria (@1440) | 7 colunas **270px spread 0** · grade left 23 = eixo · right 1372 = eixo−10 (delta sistemático) · topo 99 ≈ 11vh · base 846 ≈ 94vh · gap label↔número 87px (≥8) |
| Contraste | tinta/lime **14.7:1** · tinta/card **8.5:1** (ambos ≥7) |
| Trilho | SCROLL `writing-mode: vertical-rl` ✓ (na lane) |
| Roda 12–30 (wheel real) | **19/19 pares distintos** (diffs 1.0–3.7 por passo; wipe 192.8); pares idênticos só APÓS 30% (fora do escopo) |
| Console | 0 erros |

## Bugs herdados resolvidos

- 7a: SCROLL do trilho vertical e inteiro (fix da rodada anterior mantido e verificado).
- 7b: esfera já não existia (rodada hero); grep = 0.
- 7c: saída do hero agora termina em 0.118 (era 0.140) — nada do hero aos 12.0%.

## Achados extras e ambiente

1. **Race de load no IAB**: abas novas nascem com viewport estreita e o CSS/style
   assenta depois — o initFlipbook via mobile uma vez e travava no estático.
   Fixes: decisão de breakpoint agora re-carrega a página ao cruzar 700px; testes
   passaram a esperar o track medir >5000px antes de rodar.
2. **Seletor com aspas trocadas** (`[data-lime-marca"]`) quebrava o initFlipbook
   com erro de mensagem vazia — corrigido (o trap de erros agora captura stack).
3. **Dessincronia Lenis×scrollTo externo** em algumas instâncias de página no
   IAB (o ScrollTrigger congava no valor interno da Lenis). Com entrada REAL de
   roda (o caminho do usuário) o filme corre correto — é a evidência válida.
4. Ferramenta não usada nos cards: THREE.JS (4º da lista) — permanece em site.ts.
