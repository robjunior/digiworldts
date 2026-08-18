# Spike: Dungeon Multiplayer (ver e interagir com jogadores)

> Status: **spike** — proposta de design, nada implementado.
> Data: 2026-08-18 · Branch: `development`

## 1. Objetivo

Transformar a dungeon (hoje single-player) num espaço multiplayer:

1. **Ver** outros jogadores no mapa (avatar + nome, movimento suave).
2. **Interagir** por menu de contexto ao clicar num jogador:
   - **PvP** — convidar para batalha direta
   - **Trocar** — trade direto de itens/recursos
   - **Amigo** — adicionar/bloquear
   - **Chat** — abrir DM
   - **Seguir** — acompanhar o jogador no mapa

## 2. O que já existe (reutilizável)

| Recurso | Estado | Onde |
|---|---|---|
| WS lobby + presence global | ✓ `welcome/ping/chat/queue/act/spectate`, presence `presence:user:{id}` (TTL 30s, snapshot 3s) | `backend/src/lobby/ws.ts` |
| Pub/sub cross-node | ✓ `wsdeliver:{userId}` + `chat:global` | `backend/src/lobby/ws.ts`, `backend/src/cluster/` |
| Amigos | ✓ request/accept/remove/block (**sem notificação WS ao alvo**) | `backend/src/social/friends.ts` |
| Chat global + rooms + DM | ✓ | `backend/src/chat/routes.ts` |
| PvP direto entre 2 usuários | ✓ `createBattleForPair(userA, userB)` com guards (in-match via `battle:user:{id}`, loadout/party validada) | `backend/src/battle/routes.ts` |
| Escrow (base do trade) | ✓ market escrowa o asset no post; cancel devolve só o não-preenchido | `backend/src/market/routes.ts`, `backend/src/market/coins.ts` |
| Movimento autoritativo | ✓ servidor valida `not-adjacent`/`not-walkable`; runs por usuário | `POST /api/dungeon/:id/move` |
| Render Phaser dungeon | ✓ tilemaps + party dots + tween de glide (180ms) | `frontend/src/phaser-dungeon/` |
| Frontend WS store | ✓ casos `welcome/presence/chat/queue/match/battle/event/end/spectate/...` | `frontend/src/state/wsStore.ts` |
| Identidade do avatar | ✓ dot do digimon líder (`catalogId` da party[0]) | renderer atual |
| **Retorno pós-batalha** | ✗ hoje o Combat termina com link fixo "Back to lobby" | `frontend/src/routes/Combat.tsx:27` |

**Conclusão:** PvP invite, amigo e DM são majoritariamente *wiring*. O trabalho real é **presença na dungeon** e **trade direto**.

## 3. Decisões de design

### D1 — Só avatares são compartilhados (sem sync de tile state)
Tiles, portas, baús, encounters e loot continuam **por instância** (cada jogador tem seu próprio `user_dungeon_runs`). Compartilhamos apenas **posição + identidade + facing**. É o modelo clássico de MMO "vejo os outros, o mundo é meu".

- Elimina dupes de loot e corrida por baú.
- Elimina sync de estado de mapa (triggers/doors por jogador hoje).
- Presença = payload pequeno, sem transações de jogo.

### D2 — Movimento continua autoritativo por tile
O cliente continua emitindo `POST /api/dungeon/:id/move` (validado no servidor). A presença é **derivada** do move: o servidor publica a posição depois de validar. Anti-teleport de graça, zero trust.

### D3 — Fanout por canal de dungeon, não por usuário
Presença publica em `dungeon:presence:{dungeonId}` (hash no cluster). Broadcast de movimentação = publish no canal da dungeon. Escala: N jogadores → N mensagens, não N².

### D4 — Blocklist respeitada no mapa
Jogadores bloqueados não aparecem e não podem interagir (checagem barata de friendship `blocked` no servidor ao montar o payload de presença).

### D5 — Identidade visual mínima
Dot do digimon líder (mesma pipeline `ensureDigimonDotsLoaded`) + nome acima (Phaser `Text`, fonte pequena, estilo PSX). Sem sprite completo — perf e estética.

### D6 — Interação à distância (viewport)
Sem requisito de proximidade: qualquer jogador **visível** no mapa pode ser clicado para abrir o menu de contexto. A célula clicada identifica o avatar (raycast canvas → célula → presença), então o alvo é sempre explícito. Densidade alvo: **40 players** por dungeon.

## 4. Arquitetura

### 4.1 Backend — presença na dungeon

**Cluster (memória ou Redis, via `getCluster()`):**

```
dungeon:presence:{dungeonId}          → hash   {userId} → JSON
JSON = { userId, displayName, x, y, gridX, gridY, facing, leaderCatalogId, ts }
TTL por entrada: 15s (renovada em cada move + heartbeat do WS)
```

- `moveRun()` ganha um hook: após `kind === 'ok'`, `setPresence(...)`.
- WS `dungeon:join {dungeonId}` / `dungeon:leave` mantém o TTL vivo e assina o canal.
- Saída (navegação/desconexão) → `hdel` + publish de remoção.

**Novas mensagens WS (client → server):**

```jsonc
{ "type": "dungeon:join",  "dungeonId": "dun_..." }
{ "type": "dungeon:leave", "dungeonId": "dun_..." }
{ "type": "pvp:invite",    "toUserId": "usr_..." }
{ "type": "pvp:response",  "inviteId": "pvp_...", "accept": true }
```

**Novas mensagens WS (server → client):**

```jsonc
{ "type": "dungeon:players", "dungeonId": "dun_...",
  "players": [ { "userId", "displayName", "x", "y", "gridX", "gridY", "facing", "leaderCatalogId" } ] }
{ "type": "dungeon:player-update", "dungeonId": "dun_...", "player": { ... } }   // move do vizinho
{ "type": "dungeon:player-left",   "dungeonId": "dun_...", "userId": "usr_..." }
{ "type": "pvp:invite", "inviteId": "pvp_...", "fromUserId": "usr_...", "fromName": "..." }  // recebido pelo alvo
{ "type": "pvp:invite-expired", "inviteId": "pvp_..." }
{ "type": "social:notify", "kind": "friend-request", "fromName": "..." }   // amigos hoje não notificam
```

**Invite PvP (servidor):**
1. Guard: alvo online (presence), sem match ativo (`battle:user:{id}` já existe), `blocked` friendship negado.
2. `pvp:invite:{id}` no cluster com TTL 30s (single-use) → entregue ao alvo via `wsdeliver:{userId}`.
3. `pvp:response accept` → `createBattleForPair` (já valida loadout/party) → ambos recebem `{type:'match'}`.
4. Fim da batalha → frontend precisa de `returnTo` (ver 4.3).

**Trade (servidor):**

- Itens do catálogo ganham flag **`can_trade`** (`shop_items.can_trade`, migration nova, default `0`) — só itens com a flag entram em trade de jogador. Digimon com flag equivalente fica pra v2 (mesma ideia, escrow de roster).
- v1 = **itens apenas** (sem NetCore, sem digimon).

```sql
-- migration: 0XX_shop_items_can_trade.sql
ALTER TABLE shop_items ADD COLUMN can_trade INTEGER NOT NULL DEFAULT 0;

CREATE TABLE trades (
  id          TEXT PRIMARY KEY,
  user_a      TEXT NOT NULL,
  user_b      TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'open',      -- open | confirmed_a | confirmed_b | done | cancelled
  slots_a     TEXT NOT NULL DEFAULT '[]',        -- JSON: [{kind:'item', itemId, qty}] (v1: só item can_trade)
  slots_b     TEXT NOT NULL DEFAULT '[]',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
```

- Fluxo: A abre trade com B → ambos editam slots (somente itens `can_trade`) → **confirm** (estado `confirmed_x`) → quando ambos confirmam → `tx()` única: valida posse atual de cada slot e transfere (padrão escrow do market: asset sai da posse no *confirm*, não no done — evita gastar duas vezes).
- Cancel/timeout → devolve o que aquele lado tinha confirmado (igual `market cancel`).
- Escopo da v1: **itens `can_trade`** (flag no catálogo). Digimon/NetCore ficam pra v2.

**Endpoints REST novos:**

```
POST /api/trades                { targetUserId }                  → cria ou retorna trade aberto
POST /api/trades/:id/slots      { slots }                         → atualiza o meu lado (estado open)
POST /api/trades/:id/confirm                                      → confirmo meu lado
POST /api/trades/:id/cancel                                       → cancela + devolve
GET  /api/trades/mine                                              → trades ativos
```

### 4.2 Frontend

**Camada "outros jogadores" no Phaser scene** (`DungeonPhaserScene`):
- Estado: `Map<userId, { sprite, nameText, lastCell, from, to, tween }>`.
- `dungeon:players` → spawn; `dungeon:player-update` → tween de 180ms célula→célula (mesmo glide do movimento próprio); `player-left` → remove.
- Dots via `ensureDigimonDotsLoaded(leaderCatalogId)` (dedupe já existe).
- Filtro: bloqueados não chegam (servidor já filtra).
- Interpolação por célula (nada de física contínua — coerente com o movimento por tile).

**Menu de contexto** (`Dungeon.tsx`):
- Click no canvas → `scene.getState()`/handler retorna célula clicada → match com a presença **naquela célula, a qualquer distância visível** → painel de contexto (componente React fora do canvas):
  - **PvP (x1)** → `pvp:invite` → aguarda resposta (toast "convite enviado").
  - **Trocar** → abre painel de trade (fase 3).
  - **Amigo** → `POST /api/friends/request` (+ toast).
  - **Chat** → overlay in-game (global + local da dungeon, ver abaixo).
  - **Seguir** → modo follow (ver 4.4).
- Toast de convite recebido: aceitar/recusar → `pvp:response`.

**Chat overlay in-game** (`Dungeon.tsx`, aba sobreposta ao mapa):
- Dois canais: **global** (reusa `chat:global` existente) e **local** (por dungeon — nova scope no handler de chat: `{ type:'chat', dungeonId }` → fanout para a presença da dungeon, sem tabela nova).
- Reusa o rate limit existente (4 msgs/8s) e o histórico do lobby (ou overlay leve só com mensagens recentes do WS).

**Return-to-dungeon após batalha:**
- `Combat.tsx` hoje tem "Back to lobby" fixo. Mudar para respeitar `location.state.returnTo` (padrão já usado pelo `/loading` → dungeon). O invite PvP navega `/loading → /combat` com `returnTo: '/dungeon/...'`.

### 4.3 Fluxo PvP completo

Regras idênticas à arena/ranked (3v3 com a party atual, mesmas validações de loadout do `createBattleForPair`) — a diferença é só o **convite direto** substituir a fila.

```
A clica em B → PvP (x1)
  → WS pvp:invite {toUserId: B}
  → server: guards (online, sem match, não bloqueado) → pvp:invite:{id} TTL 30s
  → B recebe {type:'pvp:invite'} → toast aceitar/recusar
  → accept → server createBattleForPair(A, B)   // mesmas regras da arena
  → A e B recebem {type:'match'} → ambos navegam /loading → /combat (returnTo dungeon)
  → fim → "Voltar pra dungeon" (returnTo)
  → presença na dungeon é restaurada no rejoin
```

### 4.4 Seguir

- 100% client-side: modo follow guarda `targetUserId`; a cada `dungeon:player-update` do alvo, emite o mesmo `POST /move` (BFS local no walkable mask para o próximo passo). Servidor inalterado.
- Cancela em qualquer input do jogador ou perda de presença do alvo.
- Rate: 1 move por update de presença (o endpoint já valida adjacent — spam vira erro, não vantagem).

## 5. Fases e critérios de aceite

| Fase | Escopo | Critérios de aceite | Est. |
|---|---|---|---|
| **1 — Presença + render** | hash de presença, hook no move, WS join/leave/players/update/left, camada de sprites + nomes + interpolação | Dois clientes na mesma dungeon se veem andar suave; sair remove o fantasma ≤ TTL; bloqueado não aparece; **todos os players do grupo visíveis** (viewport = mundo inteiro, densidade alvo 40) | ~1-2d |
| **2 — Contexto + PvP + amigo + chat overlay** | menu de contexto (interação a qualquer distância visível), invite PvP (regras da arena, convite direto), `social:notify` de amigo, overlay de chat global + local (dungeon) | Batalha 3v3 começa por convite e termina voltando pra dungeon; request de amigo notifica o alvo; chat local só ecoa pra quem está na dungeon | ~2-3d |
| **3 — Trade** | migration `can_trade`, tabela `trades`, endpoints, painel de trade, escrow em `tx` | Confirm duplo transfere itens `can_trade` sem dupe; cancel/timeout devolve; itens sem flag recusados | ~2d |
| **4 — Seguir** | modo follow | Follow acompanha por mapa cruzando seams | ~1d |

## 6. Riscos e mitigações

- **Fantasma/teleport**: posição só entra na presença via move validado → sem teleport; TTL remove offline.
- **Fanout**: canal por dungeonId; hash enxuto; broadcast só do delta (player-update), snapshot só no join. Densidade alvo 40 players/dungeon: N² de interações na UI é confortável nesse teto.
- **Colisão de interação**: target explícito — a célula clicada identifica o avatar (qualquer distância visível), sem ambiguidade.
- **Trade duplicado**: escrow no confirm + `tx` com guarda de posse (mesmo padrão do market).
- **Perf do render**: N players = N dots (sprites leves, já deduped).
- **Instância vs mundo**: mundo compartilhado é só visual — sem mudança de gameplay single-player (decisão D1).

## 7. Decisões fechadas (dono do produto)

1. **PvP (x1)** — mesmas regras da arena (3v3, party atual), iniciado por convite direto do menu de contexto. ✅
2. **Trade** — v1 só itens; flag `can_trade` no catálogo (`shop_items`); digimon com flag equivalente fica pra v2. ✅
3. **Chat** — overlay in-game com **global + local (por dungeon)**. ✅
4. **Raio de interação** — viewport: interação a qualquer distância visível (sem requisito de adjacência). ✅
5. **Densidade** — 40 players por dungeon (teto de escala alvo; sem cap de render, o mapa inteiro do grupo é o viewport). ✅

