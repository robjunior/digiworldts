/**
 * Dungeon traps engine.
 *
 * A trap is a tile at `(dungeon_id, x, y)` with a kind + severity. When a player
 * steps onto the tile, the server rolls a dodge check against the party's
 * average SPD (`avoidChance = min(0.75, partyAvgSpd / 500)`) and, on a landed
 * trap, applies the effect described by `kind`. Traps fire once per run — the
 * fired trap id is added to `UserDungeonRun.oneshotTriggeredIds` so subsequent
 * steps on the same tile are a no-op.
 *
 * Effect application in this MVP:
 *   - `damage` / `energy_drain` / `mood_loss` / `teleport` are described in the
 *     response's `effectSummary`; wiring HP/EN/mood/position DB writes is the
 *     follow-up (this ships the roll + notification pipeline first).
 *   - `poison` / `burn` describe the pending ailment for the next battle;
 *     hooking it into `pending_buffs` is the follow-up.
 *   - `random_encounter` names the intent; spawning the wild battle is the
 *     follow-up.
 */
import { one, q, run } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import { loadCatalog } from '../digimon/xml.js';
import type { DungeonTrap, TrapKind, TrapTriggered } from '@digiworld/shared';

const SQL_LIST_TRAPS = `SELECT * FROM dungeon_traps WHERE dungeon_id = ? ORDER BY y, x`;
const SQL_GET_TRAP = `SELECT * FROM dungeon_traps WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_TRAP_AT = `SELECT * FROM dungeon_traps WHERE dungeon_id = ? AND x = ? AND y = ?`;
const SQL_INSERT_TRAP = `INSERT INTO dungeon_traps (id, dungeon_id, x, y, kind, severity, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_TRAP = `UPDATE dungeon_traps SET x = ?, y = ?, kind = ?, severity = ?, label = ? WHERE dungeon_id = ? AND id = ?`;
const SQL_DELETE_TRAP = `DELETE FROM dungeon_traps WHERE dungeon_id = ? AND id = ?`;

type TrapRow = {
  readonly id: string;
  readonly dungeon_id: string;
  readonly x: number;
  readonly y: number;
  readonly kind: string;
  readonly severity: number;
  readonly label: string | null;
  readonly created_at: number;
};

const KIND_LABELS: Record<TrapKind, string> = {
  damage: 'damage',
  poison: 'poison',
  burn: 'burn',
  energy_drain: 'energy-drain',
  mood_loss: 'demoralizing',
  teleport: 'teleport',
  random_encounter: 'ambush',
};

function trapFromRow(row: TrapRow): DungeonTrap {
  return {
    id: row.id,
    dungeonId: row.dungeon_id,
    x: row.x,
    y: row.y,
    kind: row.kind as TrapKind,
    severity: row.severity,
    label: row.label,
    createdAt: row.created_at,
  };
}

export async function listTraps(dungeonId: string): Promise<DungeonTrap[]> {
  return (await q<TrapRow>(SQL_LIST_TRAPS, dungeonId)).map(trapFromRow);
}

export async function getTrapAt(dungeonId: string, x: number, y: number): Promise<DungeonTrap | null> {
  const row = await one<TrapRow>(SQL_GET_TRAP_AT, dungeonId, x, y);
  return row ? trapFromRow(row) : null;
}

export async function createTrap(
  dungeonId: string,
  input: { readonly x: number; readonly y: number; readonly kind: TrapKind; readonly severity: number; readonly label: string | null },
): Promise<DungeonTrap | 'not-found' | 'conflict'> {
  if (await getTrapAt(dungeonId, input.x, input.y)) return 'conflict';
  const id = newId('trap');
  const now = Date.now();
  await run(SQL_INSERT_TRAP, id, dungeonId, input.x, input.y, input.kind, input.severity, input.label, now);
  const row = await one<TrapRow>(SQL_GET_TRAP, dungeonId, id);
  if (!row) return 'not-found';
  return trapFromRow(row);
}

export async function updateTrap(
  dungeonId: string,
  trapId: string,
  input: { readonly x?: number | undefined; readonly y?: number | undefined; readonly kind?: TrapKind | undefined; readonly severity?: number | undefined; readonly label?: string | null | undefined },
): Promise<DungeonTrap | 'not-found' | 'conflict'> {
  const existing = await one<TrapRow>(SQL_GET_TRAP, dungeonId, trapId);
  if (!existing) return 'not-found';
  const trap = trapFromRow(existing);
  const nextX = input.x ?? trap.x;
  const nextY = input.y ?? trap.y;
  if ((nextX !== trap.x || nextY !== trap.y) && (await getTrapAt(dungeonId, nextX, nextY))) return 'conflict';
  await run(
    SQL_UPDATE_TRAP,
    nextX,
    nextY,
    input.kind ?? trap.kind,
    input.severity ?? trap.severity,
    input.label !== undefined ? input.label : trap.label,
    dungeonId,
    trapId,
  );
  const row = await one<TrapRow>(SQL_GET_TRAP, dungeonId, trapId);
  return row ? trapFromRow(row) : 'not-found';
}

export async function deleteTrap(dungeonId: string, trapId: string): Promise<boolean> {
  const result = await run(SQL_DELETE_TRAP, dungeonId, trapId);
  return result.changes > 0;
}

export type PartySpdSnapshot = { readonly avgSpd: number; readonly count: number };

const SQL_PARTY_SPD = `SELECT catalog_id, spd_bonus FROM player_roster WHERE user_id = ? AND slot_index IS NOT NULL`;

/**
 * Party average SPD used for the trap dodge roll. Sums `template.baseStats.spd
 * + statBonus.spd` across the three party members and divides by the count. A
 * missing template contributes only the statBonus (rare — happens if the
 * catalog was hot-swapped mid-run).
 */
export async function computePartyAvgSpd(userId: string): Promise<PartySpdSnapshot> {
  const rows = await q<{ readonly catalog_id: string; readonly spd_bonus: number }>(SQL_PARTY_SPD, userId);
  if (rows.length === 0) return { avgSpd: 0, count: 0 };
  const catalog = loadCatalog();
  let total = 0;
  for (const row of rows) {
    const tpl = catalog.digimons.find((d) => d.id === row.catalog_id);
    const baseSpd = tpl?.baseStats.spd ?? 0;
    total += baseSpd + row.spd_bonus;
  }
  return { avgSpd: Math.round(total / rows.length), count: rows.length };
}

function computeAvoidChance(partySpd: PartySpdSnapshot): number {
  if (partySpd.count === 0) return 0;
  return Math.min(0.75, partySpd.avgSpd / 500);
}

function describeEffect(trap: DungeonTrap, dodged: boolean, teleportTo?: { readonly x: number; readonly y: number }): string {
  const label = trap.label ?? KIND_LABELS[trap.kind];
  if (dodged) return `${label} avoided`;
  switch (trap.kind) {
    case 'damage':
      return `all party mons lost ${trap.severity}% HP`;
    case 'poison':
      return `party poisoned for the next battle`;
    case 'burn':
      return `party burned for the next battle`;
    case 'energy_drain':
      return `all party mons lost ${trap.severity}% EN`;
    case 'mood_loss':
      return `a party mon lost ${trap.severity} mood`;
    case 'teleport':
      return teleportTo ? `warped to (${teleportTo.x}, ${teleportTo.y})` : 'warp failed';
    case 'random_encounter':
      return `a wild pack ambushes you`;
    default: {
      const exhaustive: never = trap.kind;
      return String(exhaustive);
    }
  }
}

/**
 * Evaluate whether a trap at the player's step triggers and, if so, describe
 * the outcome. Pure function over `PartySpdSnapshot` + a random draw. Callers
 * apply the returned effect (position update for teleport, HP/EN write for
 * damage, etc.) after this returns.
 */
export function evaluateTrap(
  trap: DungeonTrap,
  partySpd: PartySpdSnapshot,
  walkableCells: readonly { readonly x: number; readonly y: number }[],
): TrapTriggered {
  const avoidChance = computeAvoidChance(partySpd);
  const dodged = Math.random() < avoidChance;
  let teleportTo: { readonly x: number; readonly y: number } | undefined;
  if (!dodged && trap.kind === 'teleport') {
    const eligible = walkableCells.filter((c) => c.x !== trap.x || c.y !== trap.y);
    if (eligible.length > 0) {
      const pick = eligible[Math.floor(Math.random() * eligible.length)];
      if (pick) teleportTo = { x: pick.x, y: pick.y };
    }
  }
  log.info('dungeon.trap.roll', { trapId: trap.id, kind: trap.kind, dodged, avoidChance, partyAvgSpd: partySpd.avgSpd });
  return {
    trapId: trap.id,
    kind: trap.kind,
    severity: trap.severity,
    label: trap.label,
    dodged,
    avoidChance,
    partyAvgSpd: partySpd.avgSpd,
    effectSummary: describeEffect(trap, dodged, teleportTo),
    ...(teleportTo ? { teleportTo } : {}),
  };
}
