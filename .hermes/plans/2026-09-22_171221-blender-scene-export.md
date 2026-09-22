# Exportar Cena do Blender → DigiWorld sem edição manual no sistema

> **Para Hermes:** use `subagent-driven-development` para implementar tarefa por tarefa.

**Meta:** um artista modela/faz a cena no Blender, exporta um `.glb` + um `scene.json` de acompanhamento, solta no repo e o sistema registra a `SceneEntity` automaticamente (modelFile, useGlbSettings, kind, elements, atmosfera, palco do lobby) — zero CRUD manual, zero edição de código.

**Arquitetura:** o metadata da cena é **nato do arquivo** (o add-on do Blender escreve um manifesto de cena como sidecar do GLB). Um importador **file-authoritative** valida (zod) e faz merge no store de cenas existente (o mesmo padrão do `content:deploy`). Quando só o `.glb` é solto (sem sidecar), um **perfil de introspação runtime** do GLB infere luzes/câmera/atmosfera → a cena ainda se registra com o `loadArenaModelBare` já existente.

**Stack:** Blender Python add-on, `shared` zod schema, backend Fastify + scenes store (file-backed `data/scenes/scenes.json`), `scene3d` THREE/GLTFLoader, `vite`.

---

## Contexto atual (verificado no código)

- **GLB de arena tem dois destinos:**
  1. commitado em `scene3d/assets/arenas/*.glb` → glob do Vite gera `ARENA_FILE_LIST`/`getArenaUrl` (`scene3d/src/arena-urls.ts`) e vira o dropdown "Model file" + lista do editor.
  2. upload runtime em `frontend/public/assets/arenas` (volume `arenadata`), servido por backend/nginx em `/assets/arenas/*.glb`; tem rotas admin (`/api/admin/arenas/*.glb`), porém **não aparece** no `ARENA_FILE_LIST` (que é o glob commitado).
- **`SceneEntity`** (`shared/src/scene.ts`): `name`, `elements`, `kind` (`'arena'|'lobby'`), `settings` (SceneSettings + `modelFile` + subset `lobby`), `useGlbSettings`, `weather`, `timeOfDay`. Persistida em `backend/data/scenes/scenes.json` (env v2) e gerenciada por CRUD admin (`/api/admin/scenes`), validadas por `ArenaSettingsZ`/`LobbySceneSettingsZ`/`WeatherConfigZ`/`TimeOfDayConfigZ`.
- **Hoje, para usar um GLB novo é preciso manualmente:** colocar o arquivo no lugar certo E criar/editar a SceneEntity apontando `modelFile` + marcar `useGlbSettings`/elements/kind + knobs. **É essa edição que o esquema elimina.**
- **GLB-default já existe** (`loadArenaModelBare` em `scene3d/src/scene.ts`): se o GLB embute luzes punctuais, cede o rig; senão aplica atmosfera do arenaKey (override por filename `arena.glb→steel`), fog off. Base perfeita para a introspação.

---

## Fluxo-alvo (o que o artista faz / o que o sistema faz)

```
Blender (add-on io_digiworld_scene)
  modela arenal + câmera principal + empties de spawn + custom props DW_*
  → Export for DigiWorld
  →  my_scene.glb  +  my_scene.scene.json      (sidecar, gerados juntos)

Sistema
  dev:  solta os 2 em scene3d/assets/arenas/
  prod: upload do .glb via admin + commit do .scene.json no bundle
  → pnpm scenes:import   (CI: scenes:xref gate)
  → valida zod + catalogs → upsert/remove na scenes store
  → SceneEntity criada: modelFile setado, useGlbSettings/kind/elements/lobby aplicados

Se o artista soltar SÓ o .glb (sem sidecar): runtime introspecciona o GLB
(extras/câmera/luzes/spawn) e o loadArenaModelBare já renderiza com atmosfera
adequada — a cena aparece com defaults sensatos, nada quebrado.
```

---

# Plano de implementação (tarefas pequenas, TDD)

## Tarefa 0 — Decisão de entrada (ranst: resolver antes)
**Objetivo:** decidir a porta única de entrega de GLB para não duplicar stores.
- Proposta: manter **ambos** por ora, mas o importador aceita `arenaSource: 'committed'|'runtime'` e o resolver de `modelFile` tenta o glob commitado e depois `/assets/arenas/<file>`. 
- **Open question** (ver Riscos): se vale unificar em backend-only (upload runtime como única porta) ou manter commitado. Não bloca as tarefas 1–5; bloca só a 6.

## Tarefa 1 — Schema do manifesto (`SceneManifestZ`)
**Arquivos:**
- Criar `shared/src/scene-manifest.ts`
- Modificar `shared/src/index.ts` (export)

**Passo 1 — teste de schema:**
```ts
// shared/src/scene-manifest.test.ts (novo)
import { SceneManifestZ } from './scene-manifest';
const ok = SceneManifestZ.parse({
  slug: 'my_scene', name: 'My Scene', kind: 'arena',
  elements: ['steel'], useGlbSettings: true,
  atmosphere: 'steel', modelFile: 'my_scene.glb',
  settings: { sunIntensity: 1.2 },
  lobby: { pedestalSpacing: 256, partyHeight: 0.4 },
});
expect(ok.name).toBe('My Scene');
expect(() => SceneManifestZ.parse({ slug: 'x', kind: 'arena', elements: ['???'] as never }))
  .toThrow();
```
**Passo 2 — rodar e ver falhar** (`pnpm --filter @digiworld/shared test`), depois implementar.

**Formato do manifesto** (superset enxuto; reusa zod já existente no backend):
```ts
const SceneManifestZ = z.object({
  schema: z.literal('digiworld-scene/v1'),
  slug: z.string().regex(/^[a-z0-9_-]+$/),      // chave estável (nome do arquivo)
  name: z.string().min(1).max(120),
  kind: z.enum(['arena','lobby']).default('arena'),
  elements: z.array(z.enum(ELEMENTS)).max(ELEMENTS.length).default([]),
  useGlbSettings: z.boolean().default(false),
  atmosphere: z.enum(LEGACY_ARENA_KEYS).nullish(), // chave de atmosfera p/ fallback
  modelFile: z.string().regex(/\.glb$/i),        // o add-on grava o nome do .glb vizinho
  settings: ArenaSettingsZ.partial(),            // espelho do schema admin existente
  lobby: LobbySceneSettingsZ.nullish(),          // palco da party (kind:lobby)
  weather: WeatherConfigZ.nullish(),             // default null (ver Riscos)
  timeOfDay: TimeOfDayConfigZ.nullish(),         // default null
}).strict();
```
**Passo 3-4 — rodar verde. Passo 5 — commit.**
> `type SharedSceneManifest = z.infer<typeof SceneManifestZ>`.

## Tarefa 2 — Perfil de introspação runtime do GLB (`glb-profile.ts`)
**Arquivos:**
- Criar `scene3d/src/glb-profile.ts`
- Criar `scene3d/src/glb-profile.test.ts`

**Passo 1 — teste (headless, mock do GLTFLoader — reutiliza padrão de `glb-atmosphere-fallback.test.ts`):**
```ts
// scene3d/src/glb-profile.test.ts
import { inspectArenaGlb } from './glb-profile';
// mock GLTFLoader → glb com: camera, 1 pointLight, malha emissiva, empty 'spawn_0', asset extras
const p = await inspectArenaGlb('https://x/arena.glb');
expect(p.hasLights).toBe(true);
expect(p.camera).toBeDefined();
expect(p.atmosphereKey).toBe('steel'); // de gltf.userData.extras.sceneMeta.atmosphere
expect(p.spawnFloorY).toBeCloseTo(0);  // ray nos empties spawn_*
```
**Passo 2 — falha. Passo 3 — implementar:**
```ts
export type GlbSceneProfile = {
  hasLights: boolean;
  hasCamera: boolean;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null;
  atmosphereKey: string | null;   // gltf.userData.extras.sceneMeta?.atmosphere ?? filename override ?? null
  spawnFloorY: number;            // média dos empties/nodes name^=spawn (raycast) — 0 se não houver
  sceneMeta: Record<string, unknown> | null; // extras em nível de asset
  blobUrl: string;
};
export async function inspectArenaGlb(url: string): Promise<GlbSceneProfile>;
```
- `extras` do asset → `gltf.userData`; `extras` de node → `object.userData` (GLTFLoader). Camera → `gltf.cameras`/`gltf.nodes` com `camera` idx.
- Nome da convenção: nodes `CAM_*`/`camera`, empties `spawn_*` (e marca `SCENE_meta` para os extras). Aceita ambas: extras estruturados OU convenções de nome.

**Passo 5 — commit.**

## Tarefa 3 — `loadArenaModelBare` usa o perfil (refactor do fallback)
**Arquivo:** `scene3d/src/scene.ts`
**Passo 1 — teste (estender `glb-atmosphere-fallback.test.ts`):** injetar GLB com extras `sceneMeta.atmosphere='lava'` e um node `spawn_0` → `loadArenaModelBare('…/x.glb')` aplica atmosfera `fire` (chave do override) e ajusta `currentArenaOffsetY` p/ encaixar no spawn.
**Passo 2 — falha. Passo 3 — implementar:** dentro de `loadArenaModelBare`, chamar `inspectArenaGlb(url)` e:
- se `profile.sceneMeta` ou `atmosphereKey` presente → usar como fallback (antes do override por filename);
- se `profile.hasCamera` e `useGlbSettings` → adotar câmera (lobby já adota; aqui prepara o terreno, ver Tarefa 6);
- `profile.spawnFloorY` → `arenaOffsetY` base do palco.
**Passo 4-5 — verde + commit.**

## Tarefa 4 — Importador file-authoritative (`scenes:import` + gate)
**Arquivos:**
- Criar `backend/src/scenes/manifest.ts` (parse dir `scene3d/assets/arenas/*.scene.json` + `content/*.scene.json`; valida `SceneManifestZ`; xref elements/atmosphere)
- Criar `backend/src/scenes/manifest-cli.ts` (comando `scenes:import`)
- Modificar `backend/src/scenes/store.ts` (Record ganha `source?: { kind:'manifest', slug:string }` e `mergeSceneFromManifest`)
- Modificar `backend/src/scenes/routes.ts` (campo `source` preservado; GET `/api/scene/scenes` inclui)
- Criar `backend/test/scenes-manifest-import.test.ts`

**Passo 1 — teste (merge idempotente sobre `SqliteAdapter`/store real):**
```ts
// backend/test/scenes-manifest-import.test.ts
import { importManifestDir } from '../src/scenes/manifest.js';
// fixture: dirs com 2 manifests → upsert
await importManifestDir(tmpDir);           // cria A e B
expect((await listScenes()).map(s=>s.name).sort()).toEqual(['A','B']);
// re-import idêntico → 0 mudanças (idempotente, updatedAt preservado)
const before = (await listScenes()).map(s=>s.updatedAt);
await importManifestDir(tmpDir);
expect((await listScenes()).map(s=>s.updatedAt)).toEqual(before);
// manifest A editado → update; manifest removido → só A some se derive de manifest (nunca um criado à mão)
```
**Passo 2 — falha. Passo 3 — implementar** (merge por `slug`/`source`: cria faltante, atualiza mudado, remove cena de manifest cuja fonte sumiu; cenas criadas via admin sem `source` NUNCA são tocadas).
**Passo 4-5 — verde + commit.**
**Cross-ref (gate CI):** validar `elements`/`atmosphere`/`modelFile` de cada manifesto contra os catálogos e a existência do `.glb`; erro não-zero quebra deploy (igual `content:xref`).

## Tarefa 5 — Command + CI wiring (`pnpm scenes:import` / `scenes:xref`)
**Arquivos:**
- `backend/package.json` (scripts `scenes:import`, `scenes:xref`)
- CI (`.github/workflows/*` — junto do content gate) roda `pnpm --filter @digiworld/backend scenes:xref` + depois `scenes:import`
**Passo:** adicionar scripts; rodar sem fixture → 0 issues. Commit.
> **Pitfall do conteúdo:** o importador NÃO deve varrer o dev-DB; deve ser puramente file-driven (como `dialogues` file-authoritative), sem tocar `content:refresh`.

## Tarefa 6 — Resolver `modelFile` em ambos os stores + listar no editor
**Arquivos:**
- `backend/src/config.ts` (ARENAS_DIR já existe)
- `backend/src/scenes/routes.ts` (novo `GET /api/scene/arenas` → `{filename,source,url}[]` = glob commitado + conteúdo de `ARENAS_DIR`)
- `frontend/src/lib/api-scenes.ts` (`listArenaFiles()`)
- `scene3d/src/arena-urls.ts` (`getArenaUrl` tenta glob commitado e, para runtime, devolve `/assets/arenas/<file>` — ou melhor: unificar a lista vinda do endpoint)
- `frontend/src/components/admin/SceneSettingsAdmin.tsx` (dropdown "Model file" usa `listArenaFiles()` em vez de só `ARENA_FILE_LIST`)
- Adotar câmera do GLB no preview/combate quando `useGlbSettings && hasCamera` (estende `loadArenaModelBare`)

**Passo 1 — teste** do resolver: nome commitado → URL do glob; nome só runtime-uploaded → `/assets/arenas/x.glb`. **Passo 4-5 — commit.**

## Tarefa 7 — Blender add-on `io_digiworld_scene`
**Arquivos (repo novo):**
- `tools/blender/io_digiworld_scene/__init__.py`
- `.../operators.py` (Export for DigiWorld)
- `.../panels.py` (painel na sidebar com name/kind/elements/atmosphere/useGlbSettings/lobby)
- `modules/gltf_export.py` (chama o exporter nativo do Blender com `use_visible=…, export_cameras=…, export_lights=…, export_extras=…`)
- `modules/manifest_builder.py` (serializa `SceneManifestZ` — o add-on importa `shared/src/scene-manifest.ts` transpilado? **Não**: duplicar o schema em zod não é viável em Python. **Decisão:** o add-on grava um JSON simples e o importador do backend valida com `SceneManifestZ`; o add-on só garante shape + campos).

**Comportamento:** lê `bpy.context.scene.DW_*` (custom props) + convenções (câmera ativa, empties `spawn_*`), gera `{slug}.glb` + `{slug}.scene.json` no mesmo dir. `modelFile` = nome do `.glb`. `useGlbSettings` = true quando há luzes punctuais ou câmera; atmosphere = prop `DW_atmosphere` (senão auto por convenção).
**Teste (opcional, manual):** rodar o export num `.blend` de fixture, conferir que o `.scene.json` passa em `SceneManifestZ` (roundtrip).

## Tarefa 8 — Docs + exemplo de cena
**Arquivos:** `tools/blender/README.md`, um exemplo `scene3d/assets/arenas/_template.scene.json`.
**Conteúdo:** o que named collections/empties significam, o schema do manifesto, fluxo dev vs prod, requisito de commit/upload. Commit final.

---

# Arquivos que devem mudar (resumo)
- `shared/src/scene-manifest.{ts,test.ts}` (novo; schema do manifesto)
- `scene3d/src/glb-profile.{ts,test.ts}` (novo; introspação do GLB)
- `scene3d/src/scene.ts` (loadArenaModelBare usa perfil)
- `scene3d/src/arena-urls.ts` (resolver runtime + committed)
- `backend/src/scenes/{manifest.ts,manifest-cli.ts}` (novo; importador + gate)
- `backend/src/scenes/{store.ts,routes.ts}` (source; merge; `GET /api/scene/arenas`)
- `backend/test/scenes-manifest-import.test.ts` (novo)
- `backend/package.json` (scripts)
- `frontend/src/lib/api-scenes.ts`, `frontend/src/components/admin/SceneSettingsAdmin.tsx`
- `tools/blender/io_digiworld_scene/*` (add-on novinho)
- CI: gate `scenes:xref` + `scenes:import`

# Validação / como provar
- `pnpm --filter @digiworld/shared test` — schema do manifesto
- `pnpm --filter @digiworld/scene3d test` — glb-profile + fallback com extras
- `pnpm --filter @digiworld/backend test` — `scenes-manifest-import.test.ts` (merge idempotente; nunca toca cena admin-manual)
- CI new: `pnpm --filter @digiworld/backend scenes:xref` (0 issues) + `scenes:import`
- Roundtrip manual: exportar `.blend` de fixture → confirmar `scene.json` válido → importar → `GET /api/scene/scenes` inclui a cena com modelFile/useGlbSettings/kind/lobby corretos

# Riscos, tradeoffs e open questions
- **Dois stores de GLB** (commitado vs upload runtime) — fonte real de "edição manual". Opção de unificar para backend-only é discutível; a Tarefa 6 mantém ambos mas expõe a lista unificada. **Decidir antes da Tarefa 6.**
- **Weather/timeOfDay no manifesto:** não faz sentido autorar clima no Blender; manter `null` por padrão e editar só no admin. O add-on não expõe esses campos.
- **Sobrescrita admin × manifesto:** manifestos são fonte; edições do admin numa cena de manifest podem ser sobrescritas no próximo import. Mitigação: badge "from Blender" + merge que NÃO regride campos admin (ou regra "último write vence" com `source.updatedAt`). Escolha explícita necessária.
- **Orfandade:** manifest removido → cena de manifest removida (documentada); cena admin-manual nunca é tocada.
- **glTF extras limitados** (strings/números/arrays, sem `undefined`): o manifesto completo vai no sidecar; os extras do GLB só carregam `atmosphere` + convenção de nome — não duplicar tudo.
- **Add-on duplica zod?** Não — o add-on só emite JSON; a validação é sempre do backend (`SceneManifestZ`). Reduz risco de drift Python/TS.
- **Câmera no combate** ainda não é adotada (só lobby). Tarefa 6 estende; se sair de escopo, registrar como follow-up.

---

**Mão na massa:** plano completo. Para executar com `subagent-driven-development` (uma subagente nova por tarefa, review de spec + qualidade) — quer que eu siga?