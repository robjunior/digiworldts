# Fluxo de Skills do Projeto

> Versão simplificada para o Silvio: uma fonte de verdade, sem mistério.

## Resumo em uma linha

**Toda skill do jogo vem dos arquivos de seed em `backend/src/skills/seeds/`**. Esses arquivos são a única fonte de verdade. Nada mais gera, modifica ou injeta skills no sistema.

---

## Onde estão os seeds (onde se edita uma skill)

```
backend/src/skills/seeds/
├── types.ts              # formato da skill + factory (makeSkillFactory)
├── index.ts              # lista única de TODAS as skills (ALL_SKILL_SEEDS)
├── fire.ts               # skills genéricas de fogo
├── fire-signatures.ts    # skills exclusivas de digimons de fogo (ex: Agumon)
├── water.ts + signatures
├── plant.ts + signatures
├── ice.ts + signatures
├── electricity.ts + signatures
├── earth.ts + signatures
├── steel.ts + signatures
├── wind.ts + signatures
├── light.ts + signatures
├── dark.ts + signatures
├── nullelem.ts + signatures
```

### O formato de uma skill (types.ts)

Cada skill tem:
- `id` — identificador único (gerado automaticamente a partir do nome)
- `name` / `name_pt` — nome em inglês e português
- `description` / `description_pt` — descrição
- `element` — elemento (fire, water, plant, ice, etc.)
- `stage` — etapa (Rookie, Champion, Ultimate)
- `slot_role` — função na interface (primary_attack, support, etc.)
- `energyCost` — custo de energia
- `cooldown` — cooldown em segundos
- `actions` —lista de ações (dano, cura, buff, etc.) em formato DSL
- `signature` — se é exclusiva de um digimon (`true`/`false`)
- `owner_template_id` — se signature, qual digimon é dono
- `upgrade_of`, `tier_2` — relacionamentos de upgrade

### Como criar uma skill

```typescript
import { makeSkillFactory } from './types.js';

const f = makeSkillFactory('fire', 'fire');

export const FIRE_SKILLS: SkillSeed[] = [
  f({
    idSuffix: 'unique-identifier',
    name: 'Nome da Skill',
    name_pt: 'Nome em Português',
    description: 'O que a skill faz',
    description_pt: 'O que a skill faz (pt)',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 19, scale: 'atk', factor: 0.82 }, element: 'fire' },
    ],
  }),
];
```

---

## Como o seed vira o catálogo no banco de dados

### Boot do servidor (`backend/src/server.ts`)

Na inicialização, o servidor roda **apenas** `seedSkillsCatalogV2()` (de `seed-catalog.ts`). Essa função:

1. Pega **todas** as skills de `ALL_SKILL_SEEDS` (que vem de `seeds/index.ts`)
2. Valida cada uma com `SkillInputSchema`
3. Insere no `skills_catalog` com `ON CONFLICT (name) DO NOTHING`

Ou seja: **idempotente**. Se já existe uma skill com esse nome (editada pelo admin), ela não é sobrescrita.

### Arquivo de seed antigo (`seed.ts`)

Antes, existia também o `seedSkillsCatalogFromXml()` que lia do XML. **Isso foi removido.** Agora o XML não tem mais nenhuma relação com o catálogo de skills. O XML serve apenas para metadata dos digimons (nome, evolução, resistências, etc.), não skills.

---

## Como uma skill chega na batalha

### 1. Montagem da skill pool do digimon (`backend/src/skills/pool.ts`)

Quando um digimon entra na batalha, o sistema monta sua skill pool chamando `buildSkillPoolFromCatalog(templateId, element, stage)`:

```
skills_catalog
  ├─ signature = 1 AND owner_template_id = templateId   → skills exclusivas do digimon
  └─ signature = 0 AND element = element AND stage = stage → skills genéricas da etapa+elemento
```

O resultado é cortado no `EQUIPPED_SLOTS_PER_STAGE[stage]` (slots equipáveis por etapa).

**Importante:** isso substitui o antigo `m.template.skillPool` que vinha do XML. Agora a skill pool é calculada do banco de dados, não do XML.

### 2. Resolução da skill (`backend/src/skills/resolve.ts`)

`resolveSkillFromCatalog(skillRow, resolver)` pega cada skill da pool e resolve:
- Se a skill tem um ID que bate no catálogo, usa os dados do catálogo (DSL completo, vfx_preset_id, etc.)
- Se não bate, usa o skill row do catalog como está

### 3. Engine de batalha (`backend/src/battle/engine.ts`)

Na função `unitFromLoadout`, o skill pool é montado via `buildSkillPoolFromCatalog` e depois resolvido via `resolveSkillFromCatalog`. Nada do XML entra aqui.

---

## Arquivos e suas responsabilidades

| Arquivo | O que faz |
|---------|-----------|
| `backend/src/skills/seeds/*.ts` | Definição das skills (fonte de verdade) |
| `backend/src/skills/seeds/index.ts` | Agrega todas em `ALL_SKILL_SEEDS` |
| `backend/src/skills/seed.ts` | Boot seed: insere skills dos seeds no `skills_catalog` |
| `backend/src/skills/seed-catalog.ts` | Boot seed V2: valida + insere no `skills_catalog` |
| `backend/src/skills/pool.ts` | Monta a skill pool de um digimon a partir do catalog (`buildSkillPoolFromCatalog`) |
| `backend/src/skills/resolve.ts` | Resolve uma skill do catálogo para uso em runtime |
| `backend/src/battle/engine.ts` | Usa a skill pool montada para formar os units de batalha |
| `backend/src/digimon/xml.ts` | Carrega o XML de digimons (NÃO skills, só metadata) |

---

## O que mudou recentemente

### Antes
- Skills vinham de múltiplas fontes: XML (povoado pelo scraper/Wikimon), seeds, admin
- Um digimon podia ter skills que não eram suas (ex: Angemon com "Cinder Knuckle" que é de fogo e não é signature dele)
- O seed antigo (`seedSkillsCatalogFromXml`) lia do XML e poluía o catálogo

### Depois
- Skills vêm **apenas** dos seeds
- XML sem skills (só metadata)
- `seedSkillsCatalogFromXml` removido do boot
- `buildSkillPoolFromCatalog` substituiu o `template.skillPool` do XML
- Angemon (e qualquer digimon) só tem as skills que os seeds definem para ele (assinaturas + genéricas da etapa)

---

## Verificações práticas

### Como saber quais skills um digimon tem

1. Olhe no `skills_catalog` do banco de dados:
   ```sql
   SELECT id, name, element, stage, signature, owner_template_id
   FROM skills_catalog
   WHERE owner_template_id = 'skb-50'  -- template_id do digimon
      OR (signature = 0 AND element = 'fire' AND stage = 'Rookie')
   ORDER BY slot_role;
   ```

2. Ou procure no código:
   - `seeds/fire-signatures.ts` tem as skills exclusivas de cada digimon de fogo
   - `seeds/fire.ts` tem as skills genéricas de fogo
   - `pool.ts` monta a lista final

### Se uma skill não aparece
1. Verifique se ela está nos seeds (tem `signature` e `owner_template_id` corretos)
2. Verifique se o boot seed rodou (`log.info('skills.catalog.seed.ok')` no servidor)
3. Verifique se não tem conflito de nome no catalog (`ON CONFLICT DO NOTHING` pode ter pulara)

### Se um digimon tem skill de outro
- Verifique se não tem `signature=1` com `owner_template_id` do digimon errado no seed
- Verifique se a skill não está sendo resolvida erradamente pelo `resolveSkillFromCatalog`

---

## Deploy

### Criar skill nova
1. Adiciona no arquivo de seed apropriado (`seeds/fire.ts` ou `seeds/fire-signatures.ts`)
2. Adiciona na lista `ALL_SKILL_SEEDS` no `seeds/index.ts` se for nova (já vem de lá)
3. Reinicia o servidor (ou roda `pnpm db:seed` se houver comando dedicado)
4. O `seedSkillsCatalogV2` insere a skill no `skills_catalog`

### Modificar skill existente
1. Edita no seed correspondente
2. Reinicia o servidor
3. **Atenção:** se a skill já foi editada pelo admin no catálogo, o `ON CONFLICT DO NOTHING` vai preservar a edição. Se quiser forçar a versão do seed, precisa remover a skill do catalog primeiro.

### Remover skill
1. Remove do seed
2. Remove do catálogo manualmente ou via admin
3. Reinicia

---

## Perguntas frequentes

**Por que o XML não tem mais skills?**  
Porque o XML era uma fonte secundária que competía com os seeds e causava confusão (skills de um digimon aparecendo em outro). Agora o XML tem só o necessário para a estrutura dos digimons.

**O scraper ainda funciona?**  
O scraper (`pnpm scrape --refresh`) ainda popula o XML com metadata, mas NÃO mais popula skills. Skills saem só dos seeds.

**E se eu quiser adicionar uma skill que não tem no seed?**  
Adiciona no seed. Não tem outra forma. Isso garante que todas as skills são versionadas no código.

**E skills criadas pelo admin na interface?**  
Elas ficam no `skills_catalog` e são preservadas pelo `ON CONFLICT DO NOTHING` do seed. Mas se quiser que apareçam em produção consistentemente, o ideal é adicioná-las nos seeds também.

---

Se algo não ficar claro, pegue este documento e pergunte: "o que exatamente a função X faz?" ou "como uma skill sai do seed Y e chega no digimon Z?". O fluxo é linear e agora tem um único caminho.
