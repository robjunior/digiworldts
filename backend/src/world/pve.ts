import type { PvePartyPreferences, PvePlace, PvePlaceInput, PvePoolEntry, PveWorldResponse } from '@digiworld/shared/pve';
import { q, one, run } from '../db/index.js';
import { newId } from '../util/ids.js';
import { loadCatalog } from '../digimon/xml.js';
import { loadPartyLoadout } from '../roster/routes.js';
import { createPveBattleForUser } from '../battle/routes.js';
import type { LoadoutMember } from '../battle/engine.js';

 type PlaceRow = {
  id: string; name: string; description: string; x: number; y: number;
  explore_pool: string; expedition_pool: string; enabled: number | boolean;
  min_wild_level: number; max_wild_level: number; min_wild_stage: PvePlace['minWildStage']; max_wild_stage: PvePlace['maxWildStage']; wild_count_min: number; wild_count_max: number; level_variance_min: number; level_variance_max: number; xp_multiplier: number; bits_multiplier: number;
  created_at: number; updated_at: number;
};

type PreferenceRow = { explore_party: string; expedition_party: string };

function parseJson<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function rowToPlace(row: PlaceRow): PvePlace {
  return {
    id: row.id, name: row.name, description: row.description, x: row.x, y: row.y,
    explorePool: parseJson<readonly PvePoolEntry[]>(row.explore_pool, []),
    expeditionPool: parseJson<readonly PvePoolEntry[]>(row.expedition_pool, []),
    minWildLevel: row.min_wild_level,
    maxWildLevel: row.max_wild_level,
    minWildStage: row.min_wild_stage,
    maxWildStage: row.max_wild_stage,
    wildCountMin: row.wild_count_min,
    wildCountMax: row.wild_count_max,
    levelVarianceMin: row.level_variance_min,
    levelVarianceMax: row.level_variance_max,
    xpMultiplier: row.xp_multiplier,
    bitsMultiplier: row.bits_multiplier,
    enabled: Boolean(row.enabled), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function parseParty(raw: string | undefined): readonly string[] {
  const value = raw ? parseJson<unknown>(raw, []) : [];
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 3) : [];
}

function validatePool(pool: readonly PvePoolEntry[]): boolean {
  const catalogIds = new Set(loadCatalog({ publishedOnly: false }).digimons.map((d) => d.id));
  return pool.every((entry) => catalogIds.has(entry.catalogId) && Number.isFinite(entry.weight) && entry.weight > 0);
}

export async function readPveWorld(userId: string): Promise<PveWorldResponse> {
  const rows = await q<PlaceRow>(`SELECT * FROM pve_places ORDER BY name`);
  const pref = await one<PreferenceRow>(`SELECT explore_party, expedition_party FROM pve_party_preferences WHERE user_id = ?`, userId);
  return {
    places: rows.filter((row) => Boolean(row.enabled)).map(rowToPlace),
    preferences: {
      exploreParty: parseParty(pref?.explore_party),
      expeditionParty: parseParty(pref?.expedition_party),
    },
  };
}

export async function savePvePartyPreferences(userId: string, mode: 'explore' | 'expedition', party: readonly string[]): Promise<PvePartyPreferences> {
  if (party.length > 3 || new Set(party).size !== party.length) throw new Error('invalid-party');
  const now = Date.now();
  const current = await one<PreferenceRow>(`SELECT explore_party, expedition_party FROM pve_party_preferences WHERE user_id = ?`, userId);
  const explore = mode === 'explore' ? party : parseParty(current?.explore_party);
  const expedition = mode === 'expedition' ? party : parseParty(current?.expedition_party);
  await run(`INSERT INTO pve_party_preferences (user_id, explore_party, expedition_party, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET explore_party = excluded.explore_party, expedition_party = excluded.expedition_party, updated_at = excluded.updated_at`,
    userId, JSON.stringify(explore), JSON.stringify(expedition), now);
  return { exploreParty: explore, expeditionParty: expedition };
}

export async function listPvePlaces(includeDisabled = false): Promise<readonly PvePlace[]> {
  const rows = await q<PlaceRow>(`SELECT * FROM pve_places ORDER BY name`);
  return rows.filter((row) => includeDisabled || Boolean(row.enabled)).map(rowToPlace);
}

export async function upsertPvePlace(input: PvePlaceInput): Promise<PvePlace> {
  if (!/^[a-z0-9_-]{3,48}$/i.test(input.id) || !input.name.trim() || !validatePool(input.explorePool) || !validatePool(input.expeditionPool)) {
    throw new Error('invalid-place');
  }
  const now = Date.now();
  const minWildLevel = Math.max(1, Math.floor(input.minWildLevel ?? 1));
  const maxWildLevel = Math.max(minWildLevel, Math.floor(input.maxWildLevel ?? 99));
  const minWildStage = input.minWildStage ?? 'Rookie';
  const maxWildStage = input.maxWildStage ?? 'Mega';
  const wildCountMin = Math.max(1, Math.min(3, Math.floor(input.wildCountMin ?? 1)));
  const wildCountMax = Math.max(wildCountMin, Math.min(3, Math.floor(input.wildCountMax ?? 3)));
  const levelVarianceMin = Math.max(0.1, input.levelVarianceMin ?? 0.9);
  const levelVarianceMax = Math.max(levelVarianceMin, input.levelVarianceMax ?? 1.2);
  const xpMultiplier = Math.max(0, input.xpMultiplier ?? 1);
  const bitsMultiplier = Math.max(0, input.bitsMultiplier ?? 1);
  await run(`INSERT INTO pve_places (id, name, description, x, y, explore_pool, expedition_pool, min_wild_level, max_wild_level, min_wild_stage, max_wild_stage, wild_count_min, wild_count_max, level_variance_min, level_variance_max, xp_multiplier, bits_multiplier, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, x=excluded.x, y=excluded.y,
      explore_pool=excluded.explore_pool, expedition_pool=excluded.expedition_pool, min_wild_level=excluded.min_wild_level,
      max_wild_level=excluded.max_wild_level, min_wild_stage=excluded.min_wild_stage, max_wild_stage=excluded.max_wild_stage,
      wild_count_min=excluded.wild_count_min, wild_count_max=excluded.wild_count_max, level_variance_min=excluded.level_variance_min,
      level_variance_max=excluded.level_variance_max, xp_multiplier=excluded.xp_multiplier, bits_multiplier=excluded.bits_multiplier,
      enabled=excluded.enabled, updated_at=excluded.updated_at`,
    input.id, input.name.trim(), input.description.trim(), input.x, input.y, JSON.stringify(input.explorePool), JSON.stringify(input.expeditionPool), minWildLevel, maxWildLevel, minWildStage, maxWildStage, wildCountMin, wildCountMax, levelVarianceMin, levelVarianceMax, xpMultiplier, bitsMultiplier, input.enabled === false ? 0 : 1, now, now);
  const row = await one<PlaceRow>(`SELECT * FROM pve_places WHERE id = ?`, input.id);
  if (!row) throw new Error('pve-place-write-failed');
  return rowToPlace(row);
}
export async function deletePvePlace(id: string): Promise<boolean> {
  const result = await run(`DELETE FROM pve_places WHERE id = ?`, id);
  return result.changes > 0;
}

export async function startPveEncounter(
  userId: string,
  placeId: string,
  mode: 'explore' | 'expedition',
  hours = 1,
  excludeCatalogIds: readonly string[] = [],
): Promise<{ ok: true; matchId: string } | { ok: false; error: string }> {
  const world = await readPveWorld(userId);
  const place = world.places.find((candidate) => candidate.id === placeId && candidate.enabled);
  if (!place) return { ok: false, error: 'place-not-found' };
  if (!Number.isInteger(hours) || hours < 1 || hours > 8) return { ok: false, error: 'invalid-duration' };
  const memberIds = mode === 'explore' ? world.preferences.exploreParty : world.preferences.expeditionParty;
  const player = await loadPartyLoadout(userId, memberIds);
  if ('error' in player) return { ok: false, error: player.error };
  const meatStageFactor = (stage: string): number => ({ Fresh: 0.5, 'In-Training': 0.75, Rookie: 1, Champion: 1.5, Ultimate: 2, Mega: 2.75, Ultra: 3.5 }[stage] ?? 1);
  const meatNeeded = Math.max(1, Math.ceil(player.members.reduce((sum, member) => sum + member.level * meatStageFactor(member.template.stage), 0) / 10) * (mode === 'expedition' ? hours : 1));
  const meatResult = await run(`UPDATE resources SET amount = amount - ?, updated_at = ? WHERE user_id = ? AND resource = 'Meat' AND amount >= ?`, meatNeeded, Date.now(), userId, meatNeeded);
  if (meatResult.changes === 0) return { ok: false, error: 'insufficient-meat' };
  const pool = (mode === 'explore' ? place.explorePool : place.expeditionPool).filter((entry) => entry.weight > 0);
  const catalog = loadCatalog().digimons;
  const stageRank = (stage: string): number => ['Fresh', 'In-Training', 'Rookie', 'Champion', 'Ultimate', 'Mega', 'Ultra'].indexOf(stage);
  const maxStage = stageRank(place.maxWildStage);
  const minStage = stageRank(place.minWildStage);
  let candidates = pool.map((entry) => ({ entry, template: catalog.find((template) => template.id === entry.catalogId) }))
    .filter((candidate) => candidate.template && stageRank(candidate.template.stage) >= minStage && stageRank(candidate.template.stage) <= maxStage) as Array<{ entry: PvePoolEntry; template: (typeof catalog)[number] }>;
  // "Continue → different digimons": when re-rolling right after a battle,
  // drop the species just fought so the next wild team is guaranteed to differ
  // (falls back to the full pool when exclusion would empty it).
  if (excludeCatalogIds.length > 0) {
    const excluded = new Set(excludeCatalogIds);
    const filtered = candidates.filter((candidate) => !excluded.has(candidate.entry.catalogId));
    if (filtered.length > 0) candidates = filtered;
  }
  if (candidates.length === 0) { await run(`UPDATE resources SET amount = amount + ?, updated_at = ? WHERE user_id = ? AND resource = 'Meat'`, meatNeeded, Date.now(), userId); return { ok: false, error: 'empty-explore-pool-after-limits' }; }
  const average = player.members.reduce((sum, member) => sum + member.level, 0) / Math.max(1, player.members.length);
  const wildLevel = Math.max(place.minWildLevel, Math.min(place.maxWildLevel, Math.round(average * (place.levelVarianceMin + Math.random() * (place.levelVarianceMax - place.levelVarianceMin)))));
  const wildCount = Math.min(3, Math.max(1, Math.round(place.wildCountMin + Math.random() * (place.wildCountMax - place.wildCountMin))));
  const weightedPick = (): (typeof candidates)[number] => {
    const total = candidates.reduce((sum, candidate) => sum + candidate.entry.weight, 0);
    let roll = Math.random() * total;
    for (const candidate of candidates) { roll -= candidate.entry.weight; if (roll <= 0) return candidate; }
    return candidates[candidates.length - 1]!;
  };
  const wildParty = Array.from({ length: wildCount }, (_, slot) => {
    const picked = weightedPick();
    const member: LoadoutMember = { monId: newId(`wild-${slot}`), templateId: picked.template.id, template: picked.template, level: wildLevel, nickname: picked.template.name, statBonus: { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: 0 } };
    return { member, wildInfo: { catalogId: picked.template.id, rare: false } };
  });
  const started = await createPveBattleForUser(userId, player, wildParty, place.id);
  if (!started.ok) { await run(`UPDATE resources SET amount = amount + ?, updated_at = ? WHERE user_id = ? AND resource = 'Meat'`, meatNeeded, Date.now(), userId); }
  return started.ok ? { ok: true, matchId: started.matchId } : started;
}
