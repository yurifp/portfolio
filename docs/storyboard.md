# Storyboard — curtisdesignr.me (estudo em 1440×900, 44 screenshots)

Método: loader aguardado; micro-scroll via WheelEvent (tick = deltaY 100);
38 passos de 8 ticks na ida (filme completo ≈ 320 ticks ≈ 100%) + 6 saltos
de volta confirmando reversibilidade frame a frame. Abaixo, o que FOI VISTO
em cada faixa — não inferência.

## Descoberta de arquitetura (DOM)

- `document.documentElement.scrollHeight === 900` = viewport: **a página não
  rola nativamente**. `html` tem classe `scroll-locked`.
- A roda alimenta um progresso virtual (0–1) que avança UMA timeline — a tela
  é um frame fixo e o conteúdo só se move porque a timeline manda.
- 6 `<canvas>` (WebGL de fundo + efeitos), 86 elementos com transform inline,
  2 pin-spacers (ScrollTrigger presente), boot-cover fixo, cursor custom.
- Nosso build reproduz a MESMA experiência com a arquitetura especificada:
  stage fixo 100dvh + track alto + UMA master timeline (scrub + pin único),
  que mantém scroll nativo (acessível, reload no meio funciona).

## Tabela do filme (ida)

| Faixa | Tela | O que muda nessa faixa | Tipo |
|---|---|---|---|
| 0–3% | Hero completo (nome gigante, bio, retrato, coords, marca do país) | Loader termina; micro-drift; "Scroll down" pulsa | texto/canvas |
| 3–8% | Hero saindo EM QUELUGAR NENHUM — nada sobe | Nome: letras deslizam/tracking abre; bio sobe e esmaece; retrato encolhe; labels de canto somem | texto/transform |
| 8–12% | Transição hero→números | Fundo do hero esvazia; bloco de números entra por baixo (in place) | transição |
| 12–18% | Números/odômetros | Colunas de dígitos 0–9 rolando — frames intermediários mostram MEIO dígito; labels revelam abaixo | número |
| 18–24% | Números assentam + ícones de ferramentas | Dígitos param; linha de ícones aparece com stagger; hold com micro-animção | número/texto |
| 24–28% | Saída dos números; tema começa a virar lime | Crossfade de cor de fundo prende a transição | transição |
| 28–34% | Snap-shots (fundo lime) | Heading revela caractere a caractere; labels de canto surgem; PRIMEIRO card entra da lateral com rotação | texto/card |
| 34–55% | Snap-shots: colagem acumulando | Cards entram UM POR BEAT (x + rotação + máscara de imagem); conectores tracejados desenham entre cards pousados; vários frames com card em pleno voo | card/texto |
| 55–60% | Colagem completa | Últimos cards pousam; hold da colagem inteira com respiração sutil | card |
| 60–66% | Saída do lime; tema volta ao escuro | Crossfade reverso; heading Worked At revela | transição/texto |
| 66–80% | "I've been / Worked At" | Linhas numeradas 01–07 cascateiam com stagger; linhas ABRM por estágio de scroll (accordion dirigido pelo progresso: parágrafo desdobra) | texto/accordion |
| 80–90% | Rodapé | "Shoot a message" gigante revela por caractere; link CV; colunas de links entram com stagger espaçado | texto |
| 90–100% | Fim | Rodapé assenta; indicador de progresso fecha em 100%; hold final | estado |

## Volta (reversibilidade)

6 saltos de volta ao topo: o filme retraceia EXATAMENTE os mesmos frames na
ordem inversa — colagem desmonta card a card, dígitos rolam de volta, tema
lime↔escuro nos mesmos pontos, hero retorna ao estado inicial. Zero estados
presos. Conclusão: progresso puro, sem estados de "fired once".

## Leis extraídas (para o nosso build)

1. Scroll = manivela de progresso; NUNCA transporte de conteúdo.
2. Cada elemento tem banda própria no progresso; overlaps constantes entre
   saída de um frame e entrada do próximo — nenhuma zona morta percebida
   em nenhum dos 38 passos (todos os screenshots diferiram do anterior).
3. Números rolam por POSIÇÃO (meio dígito visível em frames intermediários).
4. Cards: um por beat, entrada lateral com rotação, acumulam em colagem.
5. Tema de página (escuro↔lime) é crossfade dirigido pelo progresso.
6. Accordion abre por estágio de scroll, não por clique (clique opcional).
7. Texto pequeno (labels, tags, legendas) tem animação própria (mask/y).
