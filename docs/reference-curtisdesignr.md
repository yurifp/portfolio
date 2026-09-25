# Referência mestre — curtisdesignr.me

Documento de referência técnica/visual levantado em 2026-09-25 para orientar a reconstrução
do nosso portfólio no mesmo nível de ambição. Serve como fonte única de verdade para
paleta, tipografia, escala, técnicas e composição. O conteúdo (textos, projetos, fotos) é
placeholder nosso — nada do conteúdo do site original é copiado.

## 1. Stack identificada (fatos)

| Camada | Biblioteca | Evidência |
|---|---|---|
| Framework | Next.js (App Router, Turbopack) | chunks `/_next/static/chunks/*` |
| Animação | GSAP 3 + ScrollTrigger + SplitText | 185/34/2 ocorrências nos chunks |
| Smooth scroll | Lenis | instâncias `Lenis` nos chunks |
| WebGL | Three.js | `WebGLRenderer`, `PerspectiveCamera`, `Points(`, `matcap`, shaders |
| Estilo | Tailwind (classes utilitárias) | `tracking-[0.0975rem]`, `top-1/2` etc. |
| Fontes | Rajdhani (display), DM Sans (texto), DM Mono (labels) | `@font-face` no CSS |

**6 elementos `<canvas>`** na home — WebGL usado como fundo do hero e acentos de seção.

## 2. Sistema de design

### Paleta
- Fundo mestre: `#070210` (preto-arroxeadado) — também usado `#000`
- Texto: `#f5f0eb` (off-white quente), branco puro nos headings
- Acentos (aparecem em tags, marcadores, linhas): lime `#9df133`/`#a5e043`-ish, vermelho `#f75049`, laranja `#ff3b00`, roxo `#905cff`, ciano `#64e8ff`
- Cinzas de suporte: `#b0b4c0`, `#747785`
- **Seção "Snap-shots" inverte o esquema**: fundo lime saturado (~`#a5e043`), texto preto — a transição de seção mais marcante do site (dark → lime → dark)

### Tipografia (medida @1600×900)
- Root fluida: body `17.78px` = `1.111vw` → escala tudo com viewport
- H1 (nome no hero): Rajdhani 400, **118.4px**, tracking **-7.1px**, line-height **0.8** (94.7px)
- H2 (títulos de seção): Rajdhani 500, 88.9px, lh 0.8, tracking -2.2px
- H3 (títulos de card): Rajdhani 500, ~19px
- Body: DM Sans 400, 17.78px, lh 1.5
- Microcopy/labels: DM Mono, uppercase, tracking ~0.1em, tamanhos 10–12px
- Números/contadores: colunas de dígitos (odometer caseiro) — cada dígito é uma coluna vertical que rola

### Motivos visuais recorrentes
- **Hairline central vertical** dividindo o hero (linha 1px clara, opacidade baixa)
- **Ticks de canto** — pequenas cruzas/marcas de registro tipo "artboard" nos cantos dos cards
- **Microcopy monoespaçada nos cantos** da viewport (coordenadas, hora local, "93'", labels de seção)
- **Retrato com dithering/halftone** no hero (tratamento Bayer/scanline sobre foto, mesclando com o fundo escuro)
- Grid editorial com linhas-guia visíveis; cards com borda 1px e corner marks
- Noise/grain sutil sobre tudo

## 3. Estrutura da home (ordem)

1. **Nav fixa**: logo (canto sup. esq.), sound toggle "Sound - On", local + hora ("Ho Chi Minh, VN / 5:07 AM"), coordenadas "10°48'32.0"N 106°46'55.2"E", botão Menu
2. **Menu overlay** full-screen: About, Work + coluna "Connect" com links numerados 01–06, copyright
3. **Hero**: nome gigante em display (H1 split-text), bio curta em 1ª pessoa com palavras-chave destacadas (`<technology/>`), tags em linha ("senior product designer", "a dad", "of a corgi and 5 cats"), "Scroll down" com seta, "93'" no canto, **campo de partículas WebGL** de fundo, retrato dithered à direita, hairline central
4. **Stats**: contadores animados (odometer de dígitos) + ícones de ferramentas (Figma, Claude, Photoshop, Illustrator) — headings grandes 88px
5. **Snap-shots** (grid de projetos, fundo LIME): título "Snap-shots" + link "View all", 9 cards assimétricos/espalhados com linhas conectoras tracejadas entre eles, imagens full-bleed dentro de molduras com corner ticks, tag de categoria ("Case Study", "Web Design", "App Design"), título + link "VISIT" com hover
6. **Worked At** (acordeão): "I've been" + "Worked At", 7 itens numerados 01–07 (empresa + cargo), cada um expande revelando descrição — hover muda cor do título
7. **Footer/Contact**: heading gigante "Shoot a message" (link mailto), "Download CV", colunas Portfolio/Photography/Social com links espaçados (D r i b b b l e — tracking largo), copyright, badge Awwwards, indicador de progresso de scroll

## 4. Páginas internas

- **/work**: grid `wi-card` de ~20 projetos (mesmo card da home, sem linhas conectoras), filtro implícito por categoria
- **/work/[slug]** (case study, ex. skymavis): hero com título grande + meta, seções `work-heading` (Overview, The context, The challenge, The design process por ano, Feature focus, Research & discovery...), `work-subheading`, listas `work-step-title` numeradas, imagens grandes entre seções, navegação prev/next

## 5. Interações/técnicas a replicar (categorias)

- Scroll-only storytelling: tudo revela/move via ScrollTrigger, sem clique
- Split-text reveal (chars/words com stagger + clip-path/translateY)
- Contadores odometer na entrada da seção
- Transição de tema de seção (body dark ↔ lime) sincronizada com scroll
- Campo de partículas 3D (Three.js Points + shader) reagindo ao mouse/scroll
- Retrato com shader de dithering
- Cursor customizado com estados (texto "VISIT" sobre cards, etc.)
- Preloader com progresso real (fontes + assets + primeiro frame WebGL) e contagem %
- Barra/indicador de progresso de scroll (0–100%)
- Sound toggle (drone ambiente)
- Lenis smooth scroll em tudo
- Menu overlay com stagger de links e social numerado

## 6. Decisões da nossa implementação

- Astro (projeto atual) + Tailwind 4 + GSAP + Lenis + Three (já no package.json)
- Fontes: @fontsource/rajdhani, @fontsource/dm-sans, @fontsource/dm-mono
- Todo conteúdo centralizado em `src/data/site.ts` + `src/content/projects/*.md` (troca fácil)
- Imagens placeholder geradas por script (`scripts/generate-placeholders.mjs`) — artboards geométricos com corner ticks, sem usar assets do site original
- Copy: placeholder em pt/en com os mesmos papéis estruturais (bio, tags, contadores, roles, CTA) — substituir pelo conteúdo real depois
