# AGENTS.md — Contexto completo do projeto

> Este documento é a fonte única de verdade para qualquer sessão trabalhar neste portfólio.
> Leia inteiro antes de mexer em qualquer arquivo.

## O que é este projeto

Portfólio pessoal de Yuri Ferreira Paulo (software engineer, Salvador/BR).
Design de referência: curtisdesignr.me (Awwwards-level). Deploy: Vercel + GitHub.

- **URL produção**: https://yurifp-portfolio.vercel.app
- **GitHub**: https://github.com/yurifp/portfolio (branch `main`)
- **Deploy**: `npx vercel deploy --prod --yes` (CLI autenticado)
- **Servir local**: `npx serve -l 4322 dist/client` após `npm run build`
- **Dev**: `npx astro dev --port 4321` (instável, prefira o serve)

## Stack

Astro 7 + Tailwind CSS v4 + GSAP/ScrollTrigger + Lenis + Three.js (deletado, ver LED field) + Playwright para testes. React islands foram removidos.

## Arquitetura: O FLIPBOOK

O site inteiro é UM FILME de scroll. A home não tem scroll tradicional — é um stage sticky dentro de um track de 1100vh. O scroll é a manivela que avança uma timeline GSAP com scrub. Nada anima por tempo; tudo é posição de scroll.

### Progresso → cenas

| % | Cena | Componente |
|---|---|---|
| 0–12 | Hero | Hero.astro + LED field |
| 12–30 | Cena lime (stats + stacks) | LimeScene.astro |
| 30–72 | Snap-shots (grid de projetos) | Snapshots.astro |
| 72–90 | Worked At (accordion) | WorkedAt.astro |
| 90–100 | Footer | Footer.astro |

### Arquivos-chave do flipbook

- `src/scripts/flipbook.ts` — a master timeline (tudo acontece aqui)
- `src/scripts/main.ts` — chrome (Lenis, cursor, menu, sound, preloader, trilho, scramble)
- `src/scripts/led-field.ts` — campo de LEDs do hero (substituiu o Three.js/ConstellationGrid)
- `src/scripts/scramble.ts` — roleta de caracteres no scroll (verde→branco)
- `src/scripts/portrait.ts` — retrato com dither Bayer 8×8
- `src/scripts/dither.ts` — motor de dither (texto e ícones simple-icons via Path2D)

### Vocabulário de movimento (documentado em docs/motion-vocabulary.md)

Wipe (clip-path inset) · linhas de coluna (scaleY) · abertura de card (clip-path L→R) · label letra a letra (yPercent) · odômetro (translateY) · dither scrub (res 6→28) · parallax alternado (±px) · saída (yPercent + wipe recolhe)

## Design system

Tokens em `src/styles/global.css`:
- `--gutter: clamp(16px, 1.6vw, 44px)` — margem dos 4 lados
- `--rail-lane: clamp(28px, 2.4vw, 56px)` — coluna EXCLUSIVA direita do trilho
- `--safe-right = gutter + rail-lane` — borda segura direita
- `--z-ghost/content/hud/rail/menu/loader = 1/10/50/60/100/1000`
- `--hud-ink` — interpolada por scroll (clara no void → escura no lime)
- `--fs-hud: clamp(11px, 0.4vw+6px, 15px)`
- `--fs-body: min(clamp(16px, 0.5vw+12px, 28px), 2.7vh)`
- `--fs-name: min(8.2vw, 16vh)`
- `--fs-body: min(clamp(16px, 0.5vw+12px, 28px), 2.7vh)`

### Paleta

- Void: `#070210` · Ink: `#f5f0eb` · Lime: `#9df133` · Ember: `#f75049` · Violet: `#905cff` · Cyan: `#64e8ff`
- Cena lime usa tokens LITERAIS (não color-mix): fill `#7ec129`, stroke `#639a20`, line `#8ad42d`

### Tipografia

Rajdhani (display/nome/números) · DM Sans (corpo) · DM Mono (HUD/labels)
Todas via @fontsource, sem CDN.

## Hero (0–12%) — estado atual

- **LED field** (fundo): matriz de células quadradas 4px, duas camadas canvas (BASE estática + LIGHT dinâmica), dither Bayer 8×8. `LED_SCALE = 0.5` em led-field.ts:18. `?led=mint|demo|flood|gap` para debug.
- **Zonas** (grade de 12 colunas entre eixos): retrato à ESQUERDA (cols 1-5), bio à DIREITA (cols 9-13). `overflow: clip` na intro previne sobreposição com a tag.
- **Tag verde**: acima do nome "YURI FERREIRA" (fonte 300, 7.6rem, tracking -0.02em)
- **BR fantasma**: contorno (`-webkit-text-stroke`), baseline do FERREIRA
- **HUD**: logo, SOUND (switch), hora/coords, MENU — cor via `--hud-ink`
- **Trilho**: NASA ×2 · NN% · SCROLL · SALVADOR — BR (dentro da `--rail-lane`)
- **Barra nativa**: escondida (`scrollbar-width: none`)

## Cena lime (12–30%) — estado atual

- Grade 7×4, 14 cards em xadrez (col+row par)
- 4 stats (06+, 170+, 02, 10x) linha 1 cols 1/3/5/7
- 10 stacks (Node.js, TypeScript, React, Three.js, Astro, GSAP, Next.js, Tailwind, PostgreSQL, Docker) — ícones real simple-icons via Path2D em dither
- `src/data/stacks.ts` — stacks 7-10 têm `// TODO confirmar`
- 14 janelas de 2.0%, passo 0.84%
- Copy imutável

## Cena snap (30–72%)

- Cards de projetos reais (Impacts, GlobeExplorers, This Site, etc.)
- Wipe lime de baixo→cima, cards entram um por beat, conectores desenham
- Snap oculto até 30% (tl.set em 0.285 esconde tudo)

## Cenas finais (72–100%)

- Worked At: accordion abre por estágio de scroll (variável --wa-rows)
- Footer: "Shoot a message" gigante, colunas, prev/next nos case studies

## Testes e evidências

- `scripts/lime-pixels.mjs` — suíte por pixel (fill/stroke/chanfro/linhas/texto)
- `scripts/lime-check.mjs` — checkpoints + 3 rotas de chegada
- `scripts/lime-diag.mjs` — diagnóstico da cena
- `evidence/` — screenshots, JSONs, contact sheets
- Playwright instalado como devDependency

## Content

- `src/data/site.ts` — nome, bio (3 parágrafos), tags, stats, roles, socials
- `src/data/stacks.ts` — stacks da cena lime
- `src/content/projects/*.md` — case studies (Impacts, GlobeExplorers, This Site, Aurora, Nordwind)
- `public/images/work/*.webp` — artboards gerados por `scripts/generate-placeholders.mjs`
- `public/images/portrait.jpg` — foto 3x4 do Yuri (dither aplicado em runtime)
- `public/cv/yuri-ferreira-en.pdf` — CV

## Regras de desenvolvimento

1. **Tudo é scrub** — nada anima por tempo, IntersectionObserver ou setTimeout
2. **CSS base = estado final** — se a timeline falhar, a cena aparece composta
3. **fromTo explícito** — valores from e to declarados, unidades consistentes
4. **qs() fail-loud** — seletores que não resolvem lançam erro
5. **try/catch por cena** — uma cena falha, as outras continuam
6. **overflow: clip** na intro do hero — previne vazamento visual
7. Sem position:absolute para texto (exceto o que a grade usa)
8. Sem `!important`, sem px mágicos em top/left
9. Preferir o `serve` local ao dev server (mais estável para testes)
10. Deploy manual: `npx vercel deploy --prod --yes`

## Graphify MCP

Configurado em `.zcode/config.json` como servidor SSE para `https://api.graphify.com/mcp`.
**Precisa da variável de ambiente `GRAPHIFY_TOKEN`** com o token da API do Graphify.
O projeto está em `app.graphify.com/yfp/` — o Graphify indexa o repositório GitHub e serve contexto via MCP.

## Pendências conhecidas

- [ ] Pearson ≥0.6 dos ícones dither (correlação formal não executada)
- [ ] Tabela antes/depois nos viewports restantes para a cena lime
- [ ] Não-regressão (hash 0-12%/30-100%) entre commits
- [ ] Stacks 7-10 confirmar com o usuário (Next.js, Tailwind, PostgreSQL, Docker)
- [ ] Suíte led-check.mjs completa (16 critérios por pixel)

## Histórico de commits relevante

```
ca1a33b fix(hero): portrait dither no longer overlaps tag
00de96b hero: swap left/right groups
4c8c7fb chrome: hide native scrollbar
db05459 fix: remove stale constellation-grid usage
b92ec37 fix: remove stale constellation-grid import
5cb775c hero: LED field, half size, no safe mask
b9a9fb4 hero: LED field — square dither cells replace the constellation
6e7242b fix(snap): hide next-scene content during lime exit
eba14fa lime: 7x4 density — 14 cards, same motion vocabulary
a4481e9 fix(lime): paint with literal tokens
2f252ea fix(lime): cards stuck at opening clip in real Chromium
7b4e8b7 fix(lime): hero must be fully gone before 12.0%
1e77d07 feat(flipbook): the scroll is a crank
```
