# Spike 001 · Dungeon Modo Definitivo — HUD de RPG (com portal + saída)

**Data:** 2026-08-28
**Objetivo:** Validar a transformação do dungeon no "modo definitivo" com HUD de RPG estilo MMO
clássico, mover o histórico de andar para o chat, e sair do dungeon **caminhando por um portal** que
leva à cidade (a cidade 3D é futuro distante — por ora volta ao mundo aberto).

## O que foi pedido
- HUD de RPG com ícone (☰) que abre as funções: Roster, DigiDex, Quests, Inventário, Personagem,
  Mapa Mundi (+ Amigos, Guilda como placeholders "EM BREVE").
- Remover o histórico de andar (run-log rail) e colocá-lo no chat, estilo MMO clássico (lateral baixo-esquerdo).
- Menus no topo direito; roster (lista de Digimons) na esquerda.
- Saída do dungeon = portal caminhável -> cidade (sem botão "Complete Dungeon").
- Amigos/Guilda não precisam funcionar ainda (placeholders).

## Formato do spike
Mockup HTML **standalone** interativo (sem build, sem Phaser/WS/queries do app real) que usa os
design tokens reais de `frontend/src/styles/tokens.css`. O grid é fake; o foco é provar *layout*,
*interação* e o *fluxo de saída pelo portal*. A aplicação real é um passo de build (ver abaixo).

## Arquivos
- `hud.html` — mockup interativo (grid fake + HUD completo + portal + modal de saída + JS de interação).
- `shoot.mjs` — Playwright headless: renderiza, abre drawer/painel, caminha até o portal, confirma a
  saída, tira screenshots e roda checagens estruturais (0 erros de console, modal abre, tela de saída abre).
- `shot-desktop.png`, `shot-drawer.png`, `shot-fnpanel.png`, `shot-portal.png`, `shot-exit-modal.png`,
  `shot-leftscreen.png` — evidência visual.

## Checagens estruturais (Playwright)
```
{"errors":[],"globalVisible":true,"addShown":true,"reopened":["dm","global","system"],
 "minimized":{"chatHidden":true,"iconShown":true},"reopenedAll":true,"modalOpen":true,"leftOpen":true}
```
- Roster fixo na esquerda ✅
- Chat estilo MMO no baixo-esquerdo (4 abas: DM/Local/Global/System) ✅
- **Cada aba tem X para fechar (fecha só aquela aba)** ✅
- **Botão "+" reabre a aba fechada específica (LIFO)** ✅
- **Minimizar tudo vira ícone de mensagem no canto interior esquerdo** (ao lado do roster) ✅
- **Badge de não-lidas no ícone de reabrir** (soma das abas) ✅
- Ícone de funções no topo direito ✅
- Drawer com 8 funções (6 reais + Amigos/Guilda "EM BREVE") ✅
- Histórico de andar como mensagens de sistema (na aba System/Local) ✅
- Portal de saída (oval vermelho pulsante + badge CIDADE) ✅
- Fluxo de saída: ao pisar no portal abre "Usar o portal para a cidade?"; "Atravessar" -> "Retornando à Cidade" ✅

## Verdict: VALIDATED

### What worked
- O shell MMO cabe no palco do dungeon: roster esquerda (230px), chat baixo-esquerdo, stats+☰ topo-direito,
  d-pad baixo-centro, encontro baixo-direito, grid central.
- Mover com WASD/setas OU d-pad gera `» Moveu para X,Y. Passos N · Encontros M/3.` como msg de sistema
  no chat — substitui 1:1 o `DungeonRunLog` do rail.
- O portal no canto oposto ao spawn é claro (oval pulsante + badge CIDADE) e o fluxo de saída reproduz
  exatamente o `exitConfirm` do app real ("Atravessar"/"Ficar" + aviso de descarte de itens).
- Tokens Persona-5 (--signal vermelho, clip-paths notch) combinam com o resto do app.

### What didn't
- Nada bloqueou. Grid é DOM fake — no app real o grid é o `DungeonPhaserView` (Phaser), então
  chat/roster/drawer ficam `fixed`/`absolute` por cima do canvas.

### Surprises
- No app real já existe `DungeonChatOverlay` (chat opcional) e `DungeonPartyBar` (roster no rail); a
  aplicação é re posicioná-los como HUD fixo, não criar do zero.
- O spike confirma que **remover o "Complete Dungeon"** e usar portal de saída é viável e mais MMO-like.

### Recommendation for the real build
1. **Chat como HUD always-on**: `DungeonChatOverlay` `fixed; left:16px; bottom:16px`; `pushLog()` vira
   mensagem de sistema `<b>»</b> …`. (Já parcialmente assim — `chatOpen` vira `true` por padrão.)
2. **Roster fixo esquerdo**: `DungeonPartyBar` em `fixed; left:0; top:0; height:100vh; width:230px`.
3. **Drawer ☰ topo-direito**: novo `DungeonFunctionsDrawer` com as 8 funções; 6 reais navegam para painel
   inline (não rota, p/ não perder o run), Amigos/Guilda = placeholder "EM BREVE".
4. **Portal**: já implementado no backend (`createDungeon` cria warp de saída; `moveRun` resolve
   `warpToDungeonId === null` -> navega `/world`) e desenhado na cena Phaser (`renderWarps`). O spike
   validou a *experiência* desse portal.
5. **Encounter card** (`DungeonEncounterCard`) mantém no baixo-direito.

> Spike é descartável: o `hud.html` prova layout+fluxo, mas NÃO é o app. A aplicação real do HUD é outro
> ticket. O backend do portal de saída JÁ foi implementado e testado (commit `dbcbc9b` +
> `test:dungeon-exit-portal`).
