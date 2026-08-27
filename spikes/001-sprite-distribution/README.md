# SPIKE 001 — Usar os sprites 32×32 / 4 frames (células 16×16) sem o bug de "volta às 4 frames"

## Pergunta
Melhor forma de usar os ficheiros de sprite que eu tenho (32×32, 4 frames
layout `1 2 / 3 4`, um arquivo por digimon) sem o bug recorrente de "volta às 4
frames na exibição" e alinhando o sistema para manipular pixels em habilidades /
status.

## Verdade confirmada por execução (não especulação)
- No disco (`backend/public/assets/sprites/*.png`) há **542 sheets, TODOS 64×64**
  (2×2 de 32×32). Os teus ficheiros de 32×32 / 16×16 **não estavam no repo** —
  são os fontes que queres usar diretamente.
- O pipeline (`sprite-rig.ts`, `tilesets.ts`, `DigimonSprite.tsx`) tinha o
  tamanho da CÉLULA **hardcoded em 32**. Para um sheet de 32×32 isso colapsava
  para 1 frame (`floor(32/32)=1` coluna) → congelado.
- **Causa 2 (independente do asset):** `DungeonPhaserScene.renderParty` fazia
  `partyGroup.destroy(true)` em CADA `recompose`. Como o sprite tem guarda de
  nome, era recriado do zero e a anim walk reiniciava no frame 0 a cada move →
  parecia estático mesmo com asset correto.

## Correção aplicada (validada por testes reais)
1. **Célula derivada das dimensões reais do sheet** em vez de hardcoded 32:
   - `tilesets.ts` → extraído para `sheet-frames.ts` (`computeSheetFrames(w,h)`):
     `cellW = floor(w/2)`, `cellH = floor(h/2)`. Funciona para 32×32 (16×16) E
     64×64 (32×32) E 48×48 (24×24).
   - `DigimonSprite.tsx` → `cellSizeOf(img)` deriva a célula de
     `naturalWidth/Height` (antes `CELL_W=32` hardcoded).
   - `sprite-rig.ts` (combat 3D) **já derivava** `cellW=floor(w/SHEET_COLS)` —
     confirmado por smoke test que um sheet 32×32 produz células 16×16 e o walk
     avança 0→1, attack pousa no cell 3.
2. **Bug do destroy no dungeon corrigido:** `renderParty` agora preserva os
   sprites entre recomposes (só recria quando o SET de catalogIds da party muda;
   em moves normais apenas reposiciona). A anim walk não reinicia mais.

## Testes de regressão (correm no CI)
- `frontend/src/phaser-dungeon/sheet-frames.test.ts` — valida `computeSheetFrames`
  para 32×32 / 64×64 / 48×48 (4 frames, rects corretos, índices walk/hit/attack).
- `scene3d/src/sprite-rig.32x32.test.ts` (vitest) — SpriteRig com sheet 32×32:
  cell 0 em (0,0,16,16), walk→cell 1, attack→cell 3.
- `pnpm run typecheck` passa em todos os pacotes.

## Convenção do teu sprite: 4 cores, 1 por frame
O sprite de teste `data/sprites/dot000.PNG` é **32×32, 4 células 16×16, cada
célula UMA cor** (amarelo-verde / vermelho / azul / ciano), em padrão xadrez
cor+preto. Ou seja: **cada frame é uma cor só**, não uma pose de digimon.

Isto mudou a semântica do walk: o ciclo tem de percorrer **todas as 4 frames**
(0→1→2→3) para mostrar o ciclo completo de 4 cores. Antes o walk usava só
`[0,1]` (top row) e só mostrava 2 cores. Corrigido em:
- `sprite-rig.ts`: `WALK_FRAME_INDICES = [0,1,2,3]` (rig 3D cicla as 4 cores;
  `playAttack`/`playHit` continuam a usar células 3/2 como poses de cor).
- `tilesets.ts` `buildDigimonSheet`: walk anim = `layout.walkFrameIndices`
  (`[0,1,2,3]`), frameRate 4.
- `sheet-frames.ts` `computeSheetFrames`: fonte única da verdade, retorna
  `walkFrameIndices: [0,1,2,3]`.
- `DigimonSprite.tsx` (2D/status): já aceita `frameIndex` 0-3.

Validação: `scene3d/src/sprite-rig.32x32.test.ts` prova rig 3D com sheet 32×32
cicla 0→1→2→3 e attack→cell 3. `sheet-frames.test.ts` prova a matemática.

> Nota: NÃO uses `tools/gen-spritesheets.py` para estes sprites — ele espera
> `dotNNN.PNG` de 1 frame e faz bob + red-tint, perdendo as 4 cores. Coloca o
> sheet de 4 cores diretamente em `backend/public/assets/sprites/<id>.png`.

## Manipular pixels em status / habilidades (passo 2)
A mecânica de recolor runtime (provei no spike anterior em `src/recolor.ts`) opera
sobre o buffer RGBA da textura/canvas — aplica tint só nos pixels opacos, nunca no
fundo transparente. Ponto de aplicação:
- **3D (combat):** em `sprite-rig.ts` `drawSheetFrame` (canvas por frame).
- **Phaser (dungeon):** em `buildDigimonSheet` / textura da anim.
- **2D (status/roster):** em `DigimonSprite.tsx` `trimCenterExport` (já mexe no
  `getImageData`).
Assim mostras frozen/poison/burn ou o glow de skill SEM baked sheets.

## Ficheiros tocados
- `frontend/src/phaser-dungeon/sheet-frames.ts` (NOVO — lógica pura de fatia)
- `frontend/src/phaser-dungeon/tilesets.ts` (usa `computeSheetFrames`)
- `frontend/src/components/common/DigimonSprite.tsx` (célula derivada)
- `frontend/src/phaser-dungeon/DungeonPhaserScene.ts` (preserva sprite no recompose)
- `frontend/src/phaser-dungeon/sheet-frames.test.ts` (NOVO teste)
- `scene3d/src/sprite-rig.32x32.test.ts` (NOVO teste)
