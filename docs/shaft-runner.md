# SHAFT RUNNER — o mini game (Parte 2)

> Commits: `shaft-runner: engine + world` · `shaft-runner: screens, bot, audio, integration`.
> Suítes: `scripts/shaft-verify.mjs` — **13/13** (crasha no stub da Parte 1: `__game`
> ausente — teste do teste, itens 1/8/10/12); `scripts/sr-bot.mjs` — simulação do bot.

## 1. Arquitetura

- `src/games/shaft-runner/data.ts` — fontes bitmap (3×5 HUD, 5×7 menus, A–Z 0–9
  `. : - / ' ! ▶ ← →`), sprites em strings (≤11×11, ≤3 níveis, nave simétrica),
  tabela de estágios (clamp no 6).
- `src/games/shaft-runner/world.ts` — o poço: `c(i) = 54 + A·ruído(i/λ)` com A=8+3s,
  λ=34−2s; câmaras +18 / passagens −10 (piso 36) por segundo ruído lento;
  **gap suavizado ±2/linha e |Δc| ≤ slopeMax−0.55 (margem de arredondamento) —
  invariantes 3.1–3.3 valem por construção** (1000 seeds × 4000 linhas = 0
  violações, pior caso gap 48 / slope 0). `checkWorld(seeds, rows)` roda in-page.
- `src/games/shaft-runner/index.ts` — o GameModule: geometria fixa
  `sy = 180 − (wy − scroll)` (o poço DESCE a tela; terreno flui a v, drones a
  v+22), balas em espaço de tela, passo fixo 1/60 determinístico
  ((seed, script) → hash), telas ATTRACT→MENU→PLAY⇄PAUSE→GAMEOVER, HISCORES,
  bot, áudio WebAudio sintetizado (≤8 vozes, ganho 0.25, nenhum nó com SOUND
  OFF), persistência top-5 + RUNS em try/catch.
- Ligação na Parte 1 (`game-host.ts`): `createShaftRunner()` no lugar do stub
  (splash removido), `ctx.setLabel/setActivity`, telemetria pisca em
  stage/death, terminal recebe start/stage/low-fuel/death/game-over/hiscore,
  touch 1:1 (`input.px`) + auto-fire no toque + BOMB/PAUSE ≥44px no overlay.

## 2. Parâmetros finais

Nave 7×8 (hitbox 3×3, 70/48 px/s, y 112–170) · tiro 1×3 a 170 px/s, 8/s, ≤6 ·
bomba: onda quadrada 0→108 em 30 ticks, dano 5, 3→máx 5, +1/5000 pts ·
drone 7×7 HP1 100 pts (v+22, onda 10–20 px / 1.2–2 s, formações 3–5 ×20 px,
amplitude limitada à parede da própria fileira) · torre 9×6 HP3 250 pts (parede,
janela de tiro sy ∈ [14,120], intervalo da tabela, bala mirada 2×2 a 52 px/s) ·
mina 7×7 HP2 150 pts (câmaras, 14 px dispara/morre → 4 estilhaços diagonais) ·
tanque 9×8 HP1 50 pts (+25 fuel; reposicionado ao longo do poço se cair a
<24 px da nave — nunca descartado; cadência `0.9·25·v/dreno` ±25%) ·
combustível 100, dreno da tabela, 0 → −1 vida +60% · 3 vidas, invulnerável 90
ticks, respawn y=164 no centro · vidas extras 10000 + 20000/20000 ·
1 pt/4 linhas · bônus de estágio 1000 + fuel×10 · banner STAGE por 90 ticks.

Tabela (idêntica à spec; exposta por `__game.cfgFor(n)`): v 36/42/48/54/60/66 ·
gapBase 66/62/58/54/50/46 · drones/min 14/18/22/26/30/34 · torre 1.80/1.65/
1.50/1.35/1.20/1.05 s · minas 2/3/3/4/4/5 · dreno 3.2/3.5/3.8/4.1/4.4/4.7.

## 3. O que ajustei nos "valores iniciais" (jogando com o bot)

1. **Tanques**: nascer a <24 px da nave **reposiciona** ao longo do poço (a
   spec diz "nada nasce a <24 px"; descartar tanques sevava a economia —
   coleta caiu a 30%).
2. **Drones**: amplitude da onda limitada a `(largura/2 − 16)` no spawn **e**
   clamp por tick contra a parede da fileira corrente (o poço estreita ao
   descer; sem isso o drone entra na rocha — 1 violação/234).
3. **Torres**: janela de tiro EXATA da spec (sy ∈ [14,120]); meu intervalo
   anterior permitia tiro à queima-roupa (10 px) — indodgeável.
4. **Tanques são pickup no contato** (±5 px), não colisão mortal — a spec os
   define como fonte de combustível, não inimigo.
5. **Bot**: previsão de cruzamento de balas em espaço de tela (100 ticks,
   agregando todas as ameaças), dodge de inimigos só quando não há bala,
   alvo final clampado à INTERSEÇÃO das faixas seguras (linha atual ∩ 28 à
   frente), fome de tanque a <82 com seleção por tempo de interceptação
   mínimo, tiro prioritário em tanques, voo em y≈150–158.

## 4. Verificação (13/13 + bot)

Determinismo (3×3000 ticks idênticos; seeds diferentes diferem) · invariantes
1000×4000 = **0 violações** (pior gap 48, slope 0) · spawn: 0 na parede em 234
entidades, ≤64 ents, ≤6 balas · tabela vs `cfgFor` exata · fuel ≤100 · bomba
custa 1 / parede mata / respawn 164 / gameover · máquina de estados por teclado
real (menu→play→pause→PAUSED→play→release→hiscores→menu→Q) · paleta: **7 cores,
0 fora da rampa** · áudio guardado por `ctx.audio.enabled` · persistência
try/catch · eventos no terminal (start/pause/release) · p95 JS **2.4ms** ·
console limpo. Screenshots: `evidence/sr-sheet/` (attract→menu→play→mid→
enemies→pause→gameover→hiscores) + `evidence/sr-bomb-seq/` e `sr-boom-seq/`
(24 quadros cada).

**Bot (20 seeds × 180 s simulados)**: distribuição de mortes parede 10% /
bala 40% / inimigo 42% / fuel 8% — **nenhuma > 60% ✓**; zero softlocks ✓;
coleta de tanques 64%. **NÃO ATINGIDO**: estágio 2 em ≥85% (medido 60%) e
estágio 4 em ≥40% (medido 0%) — o bot morre as 3 vidas dentro de ~90 s
médios. As 6 iterações acima levaram s2 de 5%→60%; os gargalos restantes são
densidade simultânea de balas miradas + formações de drones nos estágios 3+.

## 5. Problemas notados e NÃO alterados

1. Os alvos de progresso do bot (85%/40%) —.reportados acima como não
   atingidos; ajustes adicionais de spawn/densidade podem ser necessários.
2. `runs` incrementa no start de cada run (inclusive retry após game over) —
   spec diz "só ao iniciar partida"; um retry É uma nova partida.
3. A sonda `input()` do host devolve cópia (readonly) — os testes de fluxo
   usam teclado real por isso.

---

## 6. Passada visual (fósforo v2)

**Causa raiz dos inimigos pretos**: `spr()` (index.ts) mapeava os dígitos dos
sprites para `PAL[1..3]` = índices 1/3/5 da rampa antiga do painel
(`#020f02/#023502/#036806`) — verde-escuro sobre terreno igualmente escuro.

**Rampa de fósforo v2** (index.ts `GAME_PAL`, única fonte): L0 `#020a04` ·
L1 `#07240d` · L2 `#0f7a2a` · L3 `#2cff4a` · L4 `#d6ffd9` + acento limão
`#9df133` (pickups/CTA/alertas) e violeta `#905cff` (reservado, raro).
Papéis: L1/L2 só decoração (paredes, grades, frestas); INFORMAÇÃO sempre
L3/L4/acento. Sprites re-nivelados (1=sombra L2, 2=corpo L3, 3=claro L4,
4=acento). Blit direto por hex (sem passagem pela rampa do painel).

**CRT**: scanlines/máscara só ESCURECEM (piso L0 intacto), vinheta amainada
(45%), bloom aditivo sutil no topo (`mix-blend-mode: screen`), `--crt-intensity`
+ `?crt=0`.

**HUD**: placas L0 com borda L2 (topo 0–11, base 181–191); SCORE/HI números
2× em L4, rótulos L3; FUEL barra larga gradiente L2→L3, piscando em limão
abaixo de 25% com ícone; BOMB/LIVES como ícones (nada de letras soltas);
telas (menu/hiscores/gameover/banner/pause) sobre placa, CTA piscando em
limão. Balas inimigas = losango pulsante L4 (distintas por FORMA das
traços da nave); booms/bomba L4; borda do terreno L3.

**Cromo**: título em L4, bisel superior em limão 35%, LED com glow, CTA
"CLICK TO PLAY" piscando em limão, foco com borda+glow lime, janelas sem
foco escurecidas 22%, keycaps borda L3/texto L4. TERMINAL ancorado no topo
com prompt `yf@portfolio:~$` + cursor piscando, níveis OK (limão) / EVENT /
WARN; TELEMETRIA com 3 mini-gráficos (FRAME MS / DROPS / SCROLL %) — linha
L4, área L2, grade L1, valor atual destacado.

**Medido (pixels finais, com CRT)**: preto da tela `#020a04` (≤ #031208 ✓) ·
HUD número 18.29:1 · HUD rótulo 14.8:1 · nave 14.8:1 · drone 14.8:1 ·
pickup 14.8:1 · tiro inimigo 18.29:1 · cromo título 18.29:1 · rótulo estado
14.8:1 · terminal 18.29:1 · terreno (decoração) 1.21:1 — tudo ≥ alvo.
Evidências: `evidence/vis-after/`. Suíte: `shaft-verify` 13/13 (rampa v2),
`rain-verify` 13/13.
