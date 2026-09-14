# PVP XP + Modos de Jogo (Treino / Ranked) — Planejamento

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Adicionar XP em batalhas PVP e dois modos de jogo: Treino (vs AI, herança PVE) e Ranked (PVP competitivo com MMR).

**Arquitetura:** Estender o sistema existente — `Battle.mode` já tem `pvp | pve`. O `processPvpBattle` (evaluator) e `persistAndAwardEnd` (routes) são os pontos de entrada. XP via `awardXp` já existe no PVE (`grantRewardsInTx`). Ranked usa MMR já existente (`computeMmrDelta`).

**Tech Stack:** TypeScript (shared + backend), Fastify routes, battle engine, pvp-quest system existente.

---

## Contexto atual

- `BattleMode = 'pvp' | 'pve'` — battle/types.ts:10
- `mode === 'pvp'` gating em `processPvpBattle` (evaluator.ts:271) e `persistAndAwardEnd` (routes.ts:384, 414)
- XP existe só no PVE: `grantRewardsInTx` (routes.ts:488) chama `xpFromDefeats` + `awardXp` — nunca chamado para `mode === 'pvp'`
- `initPveBattle` (engine.ts:253) cria side B com mons selvagens phantom — AI existente que pode ser reutilizada
- MMR já existe para PvP: `computeMmrDelta`, `MMR_START=1000`, `MMR_K_FACTOR=32`
- `PvpQuestReward` já tem `kind: 'xp'` (pvp-quest.ts:114) e `rewardFor` já gera (generator.ts:214-215)
- `claimQuest` NÃO aplica XP — só dá netcore/credits/item; os hooks `pvp_points/xp/cosmetic` são placeholder (repo.ts:265-266)

---

## Tasks

### Task 1: Compartilhar XP PVP entre participants (shared + backend)

**Objetivo:** `PvpBattleResult` carrega `xpAmount` (XP por jogador na vitória).

**Files:**
- Modify: `shared/src/pvp-quest.ts` — adicionar `xpAmount: number` em `PvpBattleResult`
- Modify: `backend/src/pvp-quests/evaluator.ts` — `deriveBattleResult` computa `xpAmount` baseado em kills/survivors/damage (mesma fórmula do PVE `xpFromDefeats` adaptada)

**Detalhes:** XP por jogador = `xpFromDefeats(defeated, 3, true)` onde defeated = inimigos downed. Adicionar campo `xpAmount` a `PvpBattleResult`, inicializado em 0 nos caminhos inválidos, computado no walk do log.

---

### Task 2: Aplicar XP na persistência do fim de batalha PVP

**Objetivo:** `persistAndAwardEnd` aplica XP nos mons do party do jogador quando `mode === 'pvp'`.

**Files:**
- Modify: `backend/src/battle/routes.ts` — `grantRewardsInTx` (ou nova função `grantPvpRewardsInTx`) aplica `awardXp` por mon participante

**Detalhes:** Replicar lógica de `grantRewardsInTx` (lines 488-542) mas para PVP:
- XP base = `battleResult.xpAmount` (do Task 1) × `xpRate`
- Bônus `xpMultOf(consumeXpMultBuffs(userId))` para vitória PVP
- Aplicar a cada mon no party (mesmo SQL_SELECT_PARTY + SQL_UPDATE_MON)
- Só para `battle.mode === 'pvp'` (inverter guarda atual que retorna para pvp)

---

### Task 3: Modo Treino — batalha PVE vs AI

**Objetivo:** Endpoint `POST /api/battle/training` cria batalha PVE com time AI controlado pelo servidor.

**Files:**
- Create: `backend/src/battle/training-engine.ts` — gera loadout AI (seleção aleatória de mons do catalog + level)
- Modify: `backend/src/battle/routes.ts` — novo endpoint `createTrainingBattle`

**Detalhes:**
- AI usa `initPveBattle` existente (engine.ts:253) com loadout do jogador como side A
- Side B: 3 mons aleatórios do catalog, level = level médio do jogador ±2
- `battle.mode = 'pve'` (herda PVE engine, AI é o phantom wild party)
- XP concedido normalmente via `grantRewardsInTx` (PVE path já existe)
- Retorna `matchId` + `viewA` pro client

---

### Task 4: Modo Ranked — PVP com MMR visível

**Objetivo:** Distinguir ranquedos de casuais. MMR visível no client.

**Files:**
- Modify: `shared/src/battle.ts` — adicionar `BattleMode = 'pvp' | 'pve' | 'ranked'` (ou manter pvp e sinalizar via `sceneId`/flag)
- Modify: `backend/src/battle/routes.ts` — `createBattleForPair` aceita modo ranked; `persistAndAwardEnd` aplica MMR só para ranked
- Modify: `backend/src/battle/routes.ts` — endpoint `GET /api/battle/ranked-status` retorna MMR do usuário

**Detalhes:**
- Opção A: `BattleMode = 'pvp' | 'pve' | 'ranked'` — limpo, type-safe
- `createBattleForPair(userA, userB, mode?)` — default 'pvp', 'ranked' para queued
- MMR só atualiza em modo 'ranked' (linha 435-436 já condiciona a `pvpMmr !== null`, que já é só pvp)
- XP base PVP × 1.5× no ranked (reward multiplier via novo campo `rankedXpMultiplier`)
- Guard: não permite ranked se MMR não inicializado (default MMR_START)

---

### Task 5: Recompensas PVP com XP (quest reward claim)

**Objetivo:** `claimQuest` efetivamente granta XP ao jogador quando recompensa `kind: 'xp'`.

**Files:**
- Modify: `backend/src/pvp-quests/repo.ts` — `claimQuest` bloco `pvp_points/xp/cosmetic` (lines 265-266) aplica XP ao roster

**Detalhes:**
- Para `kind: 'xp'`: UPDATE `player_roster` SET `xp = xp + ?` para cada mon do party (analogia ao `grantRewardsInTx`)
- Ou melhor: XP vai para `player_wallet` como 'xp_credits' e o frontend aplica no loot screen
- Decisão de design: XP direto no roster vs moeda XP — recomendo direto no roster (consistente com PVE)

---

### Task 6: Regressão — verify script

**Objetivo:** Script `.mts` que importa `deriveBattleResult` + `applyBattleResult` com fixtures, rate=1, 50-300 iterações, assert invariantes.

**Files:**
- Create: `backend/test/pvp-xp-ranked-smoke.mts`

**Invariantes:**
- `xpAmount >= 0` sempre
- `xpAmount = 0` quando `valid = false`
- MMR delta positivo na vitória, negativo na derrota, 0 em draw
- XP PVP > 0 quando vitória com kills > 0
- Quest `xp` reward claim não duplica (idempotency)

---

## Files prováveis de mudar

- `shared/src/pvp-quest.ts` — `PvpBattleResult.xpAmount`
- `shared/src/battle.ts` — `BattleMode` (opcional, se adicionar 'ranked')
- `backend/src/pvp-quests/evaluator.ts` — computa xpAmount
- `backend/src/pvp-quests/repo.ts` — claimQuest aplica XP
- `backend/src/battle/routes.ts` — persistAndAwardEnd XP PVP + ranked gating + novo endpoint
- `backend/src/battle/engine.ts` — opcional: `initBattle` mode typed
- `backend/src/battle/training-engine.ts` — NOVO (AI loadout)
- `backend/test/pvp-xp-ranked-smoke.mts` — NOVO

## Tests / Verificação

```bash
pnpm --filter @digiworld/shared build
pnpm typecheck
DATABASE=sqlite DB_PATH=/tmp/dw-xp-ranked.db npx tsx test/pvp-xp-ranked-smoke.mts
```

## Riscos / Tradeoffs

- XP em PVP pode farmar com contas múltiplas — mitigar com `daily_window` cap (já existe pvp-quests)
- MMR em ranked requer queue matchmaking — fora do escopo deste plano (manual pair por enquanto)
- `BattleMode` adicionar 'ranked' quebra `mode !== 'pvp'` checks em evaluator — ajustar para `mode !== 'ranked'` nos lugares certos
- Treino vs AI: `initPveBattle` usa phantom slots para side B até 6 mons — 3 mons AI funciona direto
- `grantRewardsInTx` atualmente retorna para `pvp` — inverter lógica pode quebrar PVE; extrair função separada

## Open Questions

1. XP PVP: fórmula exata? (sugestão: `xpFromDefeats` + bonus sobreviventes, mesma base PVE)
2. Ranked: novo `BattleMode` ou flag no existing `pvp`? (recomendo modo separado pra não quebrar `metaFor` em evaluator)
3. Treino AI: level do AI = nivel do jogador ou fixo? (sugestão: jogador level ±2)
4. XP reward de quests: aplicar no claim ou no battle end? (recomendo claim — consistente com netcore/credits)
