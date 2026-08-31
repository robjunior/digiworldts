# Spike: Otimização de CSS — DigiWorld

**Data:** 2026-08-29 · **Branch:** development · **Autor:** Hermes
**Pergunta:** Qual lib/framework de CSS otimiza o CSS do jogo, e vale a pena?

## Contexto do codebase

- CSS **100% vanilla** (~18.5k linhas, ~1.2 MB) em `frontend/src/styles/*` + `admin/src/styles/*`.
- Tokens de design = CSS custom properties (`tokens.css`), lidos via `var(--signal)`, `color-mix(in oklab …)`, `clip-path` polygons, `drop-shadow` como border.
- Build: Vite 6.4 + esbuild (minify default). Sem PostCSS, sem Tailwind, sem preprocessor.
- `App.tsx` importa **14 rotas eager** no topo do módulo; só `World`/`Combat` são `lazy()`. Cada rota importa seu próprio `extensions-*.css`.

## Método

1. Baseline real: `pnpm build` em frontend + admin (artefatos capturados em `*.baseline.css`).
2. Spike 001 — bake-off de minificadores drop-in: Lightning CSS (via `vite.config.lc.mjs`) e cssnano (via PostCSS API) sobre os mesmos bytes.
3. Spike 001b — code-splitting por rota: converter todas as rotas pra `lazy()` (padrão já existente p/ World/Combat) e medir o chunk `index` de CSS.
4. Spike 002 — framework estrutural: portar fielmente `.page-strip` (o caso mais difícil: chamfer + drop-shadow + oklab) pra **vanilla-extract** (`ve-demo/`), medir e checar fidelidade de tokens.
5. Harness: `measure.mjs` (raw/gzip/brotli + probes de preservação de sintaxe moderna).

## Resultados — Spike 001 (minificadores drop-in)

Chunk CSS `index` do frontend (primeiro paint):

| Estratégia | raw kB | gzip kB | brotli kB | color-mix/oklab | clip-path |
|---|---|---|---|---|---|
| esbuild baseline (atual) | 291.54 | 44.95 | 35.06 | 300 / 300 | 350 |
| **Lightning CSS** | 293.40 | 45.06 | 35.14 | 293 / 293 | 350 |
| **cssnano** | 289.53 | 44.96 | 35.25 | 300 / 300 | 344 |
| **route-split (lazy)** ✅ | **53.87** | **9.78** | **8.61** | 83 / 83 | 59 |

admin `index`: baseline 148.25/24.04/20.20 → Lightning 149.09/24.43/20.46 (pior), cssnano 146.64/24.04/20.28 (≈0).

**Conclusão 001:** Lightning CSS e cssnano **não melhoram nada** (Lightning CSS até piora ~0.2% no gzip). O esbuild já minifica bem. Trocar o minificador adiciona dependência + risco de quebrar `color-mix`/`clip-path` sem ganho. **INVALIDADO** como otimização principal.

## Resultados — Spike 001b (code-splitting por rota) ✅

Convertendo `App.tsx` pra `lazy()` em todas as rotas, o CSS por rota vira chunk próprio:

- `index` CSS: **298.54 kB → 55.17 kB raw**; **46.49 → 10.06 kB gzip** (−78% no first paint).
- CSS passa a ser buscado por rota (ex.: Roster 63.66/11.64, Dungeon 30.97/5.37, Market 21.92/3.98, Combat 49.78/9.33).
- **Zero dependências novas.** Build caiu 12.78s → 7.95s (chunks menores).
- Risco: FOUC mínimo durante o Suspense fallback (já existe `SuspenseFallback`). Tokens globais ficam no `index` (carregado sempre), então não pisca.

**Recomendação 001b:** ADOTAR. É a única otimização com ganho real mensurável e custo ~trivial (já é o padrão do projeto p/ World/Combat).

## Resultados — Spike 002 (framework estrutural: vanilla-extract)

- ✅ `color-mix(in oklab …)`, `clip-path` polygon, `drop-shadow` **sobrevivem** à extração (sintaxe moderna OK).
- ❌ **Quebra o contrato de tokens:** `createGlobalTheme` renomeia `--signal` → `--wq03f45` (hashed). Qualquer `var(--signal)` literário **para de resolver**. São **3.583 callsites** de `var(--…)` no frontend + ~1.727 no admin.
- Custo de migração: reescrever TODOS os `var(--x)` pra `tokens.x`, OU manter tokens globais legados em paralelo (híbrido). Esforço alto, risco de regressão visual em todo o jogo.
- Tamanho do demo: 1.07 kB emitido (irrelevante — o ponto é o custo de migração, não o byte).
- Tailwind v4: ainda pior p/ esse aesthetic — o `.page-strip` depende de `clip-path`/drop-shadow custom que não vira utilitário sem `@apply`/arbitrary values, e reintroduziria os 3.583 token refs como `theme()`.

**Conclusão 002:** Factível, mas **custo de migração proibitivo** vs. ganho ~0 (o minificador continua sendo o esbuild). **INVALIDADO** como spike de otimização — só faria sentido se houvesse dor de manutenção em CSS (não é o caso pedido).

## Verdict (consolidado)

| Spike | Veredito | Ganho real |
|---|---|---|
| 001 minificador (Lightning/Cssnano) | INVALIDADO | ~0% (Lightning piora) |
| 001b route-split CSS | **VALIDADO** | **−78% CSS no first paint, 0 deps** |
| 002 framework (vanilla-extract/Tailwind) | INVALIDADO | custo alto, ganho ~0 |

**Próximo passo recomendado (fora do spike):** aplicar 001b de verdade —
1. `App.tsx`: todas as rotas `lazy()` (já revertido p/ não sujar a árvore).
2. `frontend/vite.config.ts`: considerar `build.cssCodeSplit: true` (default já é true; o gating real é o `lazy()`).
3. Opcional: servir brotli no nginx/CDN (gzip→brotli leva 35→8.6 kB no index já splitado).
4. Opcional: `build.rollupOptions.output.manualChunks` pra separar `three`/`scene` (js, não css).

## Como reproduzir

```bash
cd /mnt/sdc/digiworld
pnpm --filter @digiworld/frontend build          # baseline
node spikes/css-optimization/measure.mjs <arquivo>.css "label"
# minificadores:
pnpm exec vite build --config frontend/vite.config.lc.mjs   # Lightning CSS
node spikes/css-optimization/minify-cssnano.mjs in.css out.css  # cssnano
# route-split: editar App.tsx p/ lazy() e rebuildar
```

## Artefatos (mantidos)

- `spikes/css-optimization/measure.mjs` — harness de medição.
- `*.baseline.css`, `*.lightningcss.css`, `*.cssnano.css`, `*.lazy.css` — capturas.
- `ve-demo/` — protótipo vanilla-extract (prove o custo de migração).
- `App.tsx.bak` — App.tsx original (o spike o reverteu; árvore limpa).
