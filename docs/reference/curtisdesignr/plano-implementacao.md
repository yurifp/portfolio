# Plano de implementação — técnicas do curtisdesignr.me no nosso site

> Baseline: auditoria de `src/` (flipbook + chrome atual). Referência:
> `docs/reference/curtisdesignr/relatorio.md`. Estética local manda: preto #070210,
> lime #9df133, pixel/dither/LED, mono, chanfros, CRT. Zero cópia de assets.

## Stack já existente (auditoria)

- Scroll: **Lenis 1.3.26 já integrado** (`main.ts`, lerp 0.1 — mesma suavidade medida
  no referência), GSAP 3.15.0 + ScrollTrigger, film = timeline scrub (`flipbook.ts`)
  sobre a tabela de cenas (`scenes.ts`). **Nenhuma dependência nova é necessária.**
  - ScrambleText (plugin): DISPONÍVEL no pacote npm do GSAP 3.15 (todos os plugins
    são públicos desde 3.13), mas **não usaremos** — o `scramble.ts` próprio (roleta
    verde→branco por velocidade) já cobre e é mais "nós". Nada a instalar.
- Chrome (`FieldChrome.astro` + `main.ts`): nav c/ SOUND + relógio + Menu, menu overlay
  (clip-path inset 0.8s, stagger, Esc), cursor (dot/label/magnético), preloader
  (**progresso falso**: 0→86% em 2.4s cronometrados), trilho de progresso
  (pct + track + SCROLL), som = drone WebAudio sem SFX, wipes de navegação interna.
- Home (film): hero (retrato dither + nome split), LED wall (chuva + sweep lime
  bottom-up já existente em `led-wall.setSweep` L 0.12→0.135), lime (14 cards +
  odômetros scrub + ícones dither Path2D), snap (colagem pinada), worked at
  (acordeão por estágio de scroll `--wa-rows`), footer.

## Tabela — 10 alvos

| # | Alvo | Já temos? (onde) | Ação | Adaptação à nossa estética | Risco |
|---|---|---|---|---|---|
| 1 | Preloader | Sim, mas fake (`main.ts initPreloader`) | **substituir** | Boot de terminal: log de boot mono lime, pct gigante, linha de progresso 1px inferior, marcas de chanfro nos cantos; contador atrelado a progresso REAL (fontes + retrato + load) com creep lento; 1× por sessão (`sessionStorage`) | Baixo — manter contrato `is-loading`/`field:ready`/remove() e o backstop CSS de 7s |
| 2 | Odômetro | Sim — lime (scrub no film) e `[data-odo]` (outras páginas) | **pular** (equivalente) | Nosso gatilho é scroll-position (regra "tudo é scrub"), não IO — mantém reversibilidade | — |
| 3 | Hero split/scrub | Sim — film (`flipbook.ts`) + `scramble.ts` | **pular** (preservado) | Hero é área protegida | — |
| 4 | Scroll/progresso | Sim — Lenis + trilho | **refinar** | Chevrons pixel (3 setas de quadrados 3px) piscando sob o "SCROLL" do trilho, some após ~5% de filme; nada de anel no cursor (cursor dot/label já é nossa assinatura) | Baixo — só CSS + um data-attr |
| 5 | Menu overlay | Sim (`clip-path inset`, stagger) | **adaptar** | Canto chanfrado no painel via `clip-path polygon`; aresta lime na frente do wipe; hover dos itens com overshoot curto (`cubic-bezier(.34,1.56,.64,1)` 220ms); lock via `lenis.stop()` (+overflow) e foco gerenciado | Baixo — Entrar/Esc/aria já existem |
| 6 | Ícones default/hover | Parcial — stacks dither estáticos | **adaptar** | Técnica do par: 2º canvas dither com tinta lime montado lazy no 1º hover; crossfade de opacidade 150ms + card do stack inverte (lime→void) — "CRT invert", nada de SVG de terceiros | Médio — tocar LimeScene/flipbook com try/catch e sem quebrar as 13 checagens |
| 7 | Snap-shots | Sim — colagem pinada | **refinar** | Zoom 1.04 na arte no hover (`transform .6s cubic-bezier(.16,1,.3,1)`), desligado em reduced-motion; cantos `.ticks` já existem | Baixo |
| 8 | Acordeão Worked At | Sim — por estágio de scroll | **pular** (preservado) | Abrir por crank é a versão aprovada; trocar por painel-clicável mudaria o comportamento aprovado | — |
| 9 | Áudio | Parcial — drone só | **estender** | SFX sintetizados (bip quadrado 40ms hover, 2 tons 60ms clique, ganho ≤0.04) via delegação `[data-sfx]`; só soam com SOUND ON (off por padrão); nada de arquivos | Baixo — mesmo AudioContext do drone |
| 10 | Transição de página | Parcial — wipe genérico + sweep lime existe | **refinar** | LED→lime: hoje o sweep pinta lime bottom-up; adicionar **faixa de "apagão"** (3 linhas de LEDs forçadas a 0 logo acima da frente lime) = parede morrendo linha a linha enquanto o lime consome; wipes internos já cobrem /work | Médio — paint do `led-wall.ts` é quente; manter default idêntico quando sweep=0 (suites) |

## Decisões registradas

- **Lenis**: já integrado desde antes; nada a mudar (lerp 0.1 = feel medido no alvo 4).
- **ScrambleText plugin**: não usado — `scramble.ts` próprio cobre (e é dependência a menos).
- **Hero/LED/windows/lime-core**: intocáveis (lista de preservação). Toda mudança em
  cena passa por estado default idêntico + try/catch por cena.
- **IO vs scrub**: mantemos scrub (regra nº 1 do projeto) — odômetros não migram pra IO.
- **Placeholders `TODO:`**: nenhum necessário — stats, socials, projetos e experiências
  já existem em `src/data/site.ts` / `src/content/projects`. Nada inventado.
- **Mobile**: chevrons/cue só decorativos (ok), menu/hover com fallback (hover não
  requisito), zoom de arte usa `@media (hover:hover)`; teste 390/768/1440.
- **Reduced-motion**: preloader pula direto (já), chevrons sem animação, zoom/hover
  invert sem transição, sweep off-band idêntico (é scrub, inerentemente ok).

## Lotes

- **Lote A** — preloader boot real + cue de scroll + SFX sintetizados (alvos 1, 4, 9).
- **Lote B** — menu chanfrado com overshoot + lock Lenis + foco (alvo 5).
- **Lote C** — apagão no sweep LED→lime + zoom hover nos cards + invert hover dos
  stacks + `data-sfx` nos cards (alvos 6, 7, 10 refinamento).

## Status (preenchido ao final)

- [x] **Lote A** — preloader CRT com progresso real (fontes + load; retrato é canvas e
  não pode ser sinal — registrado acima), creep lento, 1×/sessão (`sessionStorage
  yf.boot`, reload quente sem cortina), barra 1px lime, chanfros, boot log mascarado;
  cue de scroll (3 chevrons pixel, aposenta a 4%); SFX hover/clique sintetizados por
  delegação `[data-sfx]` (6 itens no chrome + cards/view-all no snap), aria-live no
  toggle. **Correção de bug encontrada pelas suites**: `readyState === 'complete'`
  cobre loads quentes em que o evento `load` dispara antes do módulo.
- [x] **Lote B** — menu com 4 cantoneiras chanfradas, hover com overshoot
  `cubic-bezier(.34,1.56,.64,1)` 220ms (desligado em reduced), lock duplo
  (overflow + `lenis.stop()`), foco entra no diálogo e volta ao trigger no close.
- [x] **Lote C** — sweep LED→lime com faixa de apagão (3 linhas de LEDs forçadas a 0
  acima da frente lime; desligada em sweep≥0.9999 para o handoff flat exato —
  verificada por pixels a p=0.3215); stacks com invert CRT no hover (2º canvas dither
  lime montado lazy no 1º hover, crossfade 150ms, card vira void + stroke lime);
  zoom de arte refinado para `0.6s cubic-bezier(.16,1,.3,1)`; `data-sfx` nos cards.
  **Pulados** (já aprovados/intocáveis): odômetro por IO (regra scrub), hero split
  (preservado), acordeão por clique (abre por crank).
- [x] **Não-regressão**: rain 13/13 · scroll-fix 15/15 · windows 27/27 · layout 6/6 ·
  shaft 13/13 · console limpo · preloader some em ~0.8s cold / imediato warm.
