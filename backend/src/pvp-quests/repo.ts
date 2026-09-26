import type { DbExecutor } from '../db/executor.js';
import { one, q, run, tx } from '../db/index.js';
import type {
  PvpQuestAssignment,
  PvpQuestCategory,
  PvpQuestParams,
  PvpQuestPeriod,
  PvpQuestReward,
  PvpQuestTemplate,
  PvpQuestWithProgress,
} from '@digiworld/shared/pvp-quest';
import { describeQuest } from './registry.js';
import { allWindows, windowSeed, windowFor, type PeriodWindow } from './periods.js';
import { generateBoard } from './generator.js';
import { applyPremiumBonus, isUserPremium } from '../premium/index.js';

/**
 * Persistence + reward-authority for the procedural PvP quest board.
 *
 * Trust model:
 *  - Boards are generated and stored by the server from `generateBoard`.
 *  - Player progress is written ONLY by the evaluator (fed authoritative battle
 *    results). Clients cannot influence `progress`/`state`/`completed_at`.
 *  - Rewards are granted exactly once, inside a transaction, guarded by a
 *    conditional UPDATE (`claimed_at IS NULL`) so a replayed claim is a no-op.
 */

// ---------------------------------------------------------------------------
// Board (per period window)
// ---------------------------------------------------------------------------

const SQL_BOARD_BY_WINDOW = `SELECT * FROM pvp_quest_boards WHERE period = ? AND window_id = ?`;
const SQL_UPSERT_BOARD = `INSERT INTO pvp_quest_boards (period, window_id, instance_id, category, params, target, reward, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(period, window_id, instance_id) DO NOTHING`;
const SQL_BOARD_EXISTS = `SELECT 1 FROM pvp_quest_boards WHERE period = ? AND window_id = ? LIMIT 1`;

interface BoardRow {
  period: string;
  window_id: string;
  instance_id: string;
  category: string;
  params: string;
  target: number;
  reward: string;
  created_at: number;
}

function rowToTemplate(row: BoardRow): PvpQuestTemplate {
  return {
    instanceId: row.instance_id,
    period: row.period as PvpQuestPeriod,
    category: row.category as PvpQuestCategory,
    params: JSON.parse(row.params) as PvpQuestParams,
    target: row.target,
    reward: JSON.parse(row.reward) as PvpQuestReward,
  };
}

/**
 * Ensure a board exists for the window, generating+storing it if not present.
 * Idempotent across nodes/restarts: the `ON CONFLICT DO NOTHING` makes a
 * concurrent second call a no-op, and the board is keyed by the deterministic
 * (period, window_id), so the same window always yields the same quests.
 */
export async function ensureBoard(period: PvpQuestPeriod, window: PeriodWindow, count = 8): Promise<PvpQuestTemplate[]> {
  const existing = await one<BoardRow>(SQL_BOARD_EXISTS, period, window.windowId);
  if (existing) {
    const rows = await q<BoardRow>(SQL_BOARD_BY_WINDOW, period, window.windowId);
    return rows.map(rowToTemplate);
  }
  const board = generateBoard(period, { count, seed: windowSeed(period, window.windowId) });
  await tx(async (t) => {
    for (const q of board) {
      await t.run(SQL_UPSERT_BOARD, [
        q.period, window.windowId, q.instanceId, q.category,
        JSON.stringify(q.params), q.target, JSON.stringify(q.reward), Date.now(),
      ]);
    }
  });
  return board;
}

export async function getBoard(period: PvpQuestPeriod, window: PeriodWindow): Promise<PvpQuestTemplate[]> {
  const rows = await q<BoardRow>(SQL_BOARD_BY_WINDOW, period, window.windowId);
  return rows.map(rowToTemplate);
}

// ---------------------------------------------------------------------------
// Per-user assignments (lazily spawned for the current window)
// ---------------------------------------------------------------------------

const SQL_ASSIGN = `INSERT INTO pvp_quest_assignments (user_id, period, window_id, instance_id, progress, state, completed_at, claimed_at, created_at)
  VALUES (?, ?, ?, ?, 0, '{}', NULL, NULL, ?)
  ON CONFLICT(user_id, period, window_id, instance_id) DO NOTHING`;
const SQL_ASSIGNMENTS = `SELECT a.*, b.category, b.params, b.target, b.reward
  FROM pvp_quest_assignments a JOIN pvp_quest_boards b
    ON b.period = a.period AND b.window_id = a.window_id AND b.instance_id = a.instance_id
  WHERE a.user_id = ? AND a.period = ? AND a.window_id = ?`;
const SQL_ASSIGNMENT_ONE = `SELECT a.*, b.category, b.params, b.target, b.reward
  FROM pvp_quest_assignments a JOIN pvp_quest_boards b
    ON b.period = a.period AND b.window_id = a.window_id AND b.instance_id = a.instance_id
  WHERE a.user_id = ? AND a.period = ? AND a.window_id = ? AND a.instance_id = ?`;
const SQL_UPDATE_PROGRESS = `UPDATE pvp_quest_assignments
  SET progress = ?, state = ?, completed_at = ? WHERE user_id = ? AND period = ? AND window_id = ? AND instance_id = ?`;
const SQL_CLAIM = `UPDATE pvp_quest_assignments SET claimed_at = ? WHERE user_id = ? AND period = ? AND window_id = ? AND instance_id = ? AND completed_at IS NOT NULL AND claimed_at IS NULL`;

interface AssignmentRow {
  user_id: string;
  period: string;
  window_id: string;
  instance_id: string;
  progress: number;
  state: string;
  completed_at: number | null;
  claimed_at: number | null;
  created_at: number;
  category: string;
  params: string;
  target: number;
  reward: string;
}

function rowToAssignment(row: AssignmentRow): PvpQuestWithProgress {
  const template: PvpQuestTemplate = {
    instanceId: row.instance_id,
    period: row.period as PvpQuestPeriod,
    category: row.category as PvpQuestCategory,
    params: JSON.parse(row.params) as PvpQuestParams,
    target: row.target,
    reward: JSON.parse(row.reward) as PvpQuestReward,
  };
  const state = (JSON.parse(row.state) as Record<string, unknown>) ?? {};
  const completed = row.completed_at !== null;
  const claimed = row.claimed_at !== null;
  const state_ = claimed ? 'claimed' : completed ? 'completed' : 'active';
  return {
    ...template,
    title: describeQuest(template),
    progress: row.progress,
    state: state_ as PvpQuestWithProgress['state'],
    completedAt: row.completed_at,
    claimedAt: row.claimed_at,
  };
}

/** Materialize assignments for a user for the given window (idempotent). */
export async function spawnAssignments(userId: string, window: PeriodWindow, board: PvpQuestTemplate[]): Promise<void> {
  if (board.length === 0) return;
  await tx(async (t) => {
    for (const q of board) {
      await t.run(SQL_ASSIGN, [userId, q.period, window.windowId, q.instanceId, Date.now()]);
    }
  });
}

export interface AssignmentsResult {
  window: PeriodWindow;
  quests: PvpQuestWithProgress[];
}

/** Get the user's board for a period, spawning it from the current window. */
export async function getUserPeriodQuests(userId: string, period: PvpQuestPeriod, now = Date.now()): Promise<AssignmentsResult> {
  const window = windowFor(period, now);
  const board = await ensureBoard(period, window);
  await spawnAssignments(userId, window, board);
  const rows = await q<AssignmentRow>(SQL_ASSIGNMENTS, userId, period, window.windowId);
  const byInstance = new Map(rows.map((r) => [r.instance_id, r]));
  // Return in board (generation) order.
  const quests = board.map((q) => {
    const row = byInstance.get(q.instanceId);
    return row ? rowToAssignment(row) : null;
  }).filter((x): x is PvpQuestWithProgress => x !== null);
  return { window, quests };
}

export async function getAllUserQuests(userId: string, now = Date.now()): Promise<AssignmentsResult[]> {
  const windows = allWindows(now);
  const out: AssignmentsResult[] = [];
  for (const window of windows) {
    const period = window.period;
    const board = await ensureBoard(period, window);
    await spawnAssignments(userId, window, board);
    const rows = await q<AssignmentRow>(SQL_ASSIGNMENTS, userId, period, window.windowId);
    const byInstance = new Map(rows.map((r) => [r.instance_id, r]));
    const quests = board
      .map((q) => {
        const row = byInstance.get(q.instanceId);
        return row ? rowToAssignment(row) : null;
      })
      .filter((x): x is PvpQuestWithProgress => x !== null);
    out.push({ window, quests });
  }
  return out;
}

/**
 * Apply a delta to one assignment, marking completion atomically. Called by the
 * evaluator inside its own transaction. Returns true if anything changed.
 */
export async function applyProgress(
  t: DbExecutor,
  userId: string,
  period: PvpQuestPeriod,
  windowId: string,
  instanceId: string,
  delta: number,
  nextState: Record<string, unknown>,
  target: number,
  now: number,
): Promise<boolean> {
  if (delta <= 0) return false;
  const row = await t.one<AssignmentRow>(SQL_ASSIGNMENT_ONE, [userId, period, windowId, instanceId]);
  if (!row) return false;
  if (row.completed_at !== null) return false; // already done — no double count
  const prev = row.progress;
  const next = Math.min(target, prev + delta);
  const completedAt = next >= target ? now : null;
  await t.run(SQL_UPDATE_PROGRESS, [
    next, JSON.stringify(nextState), completedAt, userId, period, windowId, instanceId,
  ]);
  return true;
}

// ---------------------------------------------------------------------------
// Reward claim (single delivery)
// ---------------------------------------------------------------------------

export interface ClaimResult {
  ok: boolean;
  alreadyClaimed: boolean;
  reward: PvpQuestReward | null;
  /** Premium active at claim time — when true, the granted amounts include +50%. */
  premium: boolean;
  /** Portion of the granted reward attributable to the premium bonus (0 when non-premium). */
  premiumBonus: PvpQuestReward | null;
}

/**
 * Grant a quest's reward exactly once. The `claimed_at IS NULL` guard makes a
 * replayed/duplicate claim a no-op. Reward granting happens here and ONLY here.
 */
export async function claimQuest(userId: string, period: PvpQuestPeriod, windowId: string, instanceId: string): Promise<ClaimResult> {
  return tx(async (t) => {
    const row = await t.one<AssignmentRow>(SQL_ASSIGNMENT_ONE, [userId, period, windowId, instanceId]);
    if (!row) return { ok: false, alreadyClaimed: false, reward: null, premium: false, premiumBonus: null };
    if (row.claimed_at !== null) return { ok: false, alreadyClaimed: true, reward: null, premium: false, premiumBonus: null };
    if (row.completed_at === null) return { ok: false, alreadyClaimed: false, reward: null, premium: false, premiumBonus: null };
    const reward = JSON.parse(row.reward) as PvpQuestReward;
    const now = Date.now();
    const premium = await isUserPremium(userId, now);
    if (reward.kind === 'netcore') {
      const amount = applyPremiumBonus(reward.amount, premium);
      await t.run(
        `INSERT INTO player_wallet (user_id, credits, netcore, streak_day, updated_at) VALUES (?, 0, ?, 0, ?)
         ON CONFLICT(user_id) DO UPDATE SET netcore = player_wallet.netcore + excluded.netcore, updated_at = excluded.updated_at`,
        [userId, amount, now],
      );
    } else if (reward.kind === 'credits') {
      const amount = applyPremiumBonus(reward.amount, premium);
      await t.run(
        `INSERT INTO player_wallet (user_id, credits, netcore, streak_day, updated_at) VALUES (?, ?, 0, 0, ?)
         ON CONFLICT(user_id) DO UPDATE SET credits = player_wallet.credits + excluded.credits, updated_at = excluded.updated_at`,
        [userId, amount, now],
      );
    } else if (reward.kind === 'item' || reward.kind === 'battle_item') {
      const qty = applyPremiumBonus(reward.qty, premium);
      await t.run(
        `INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at`,
        [userId, reward.itemId, qty, now],
      );
    }
    // pvp_points/xp/cosmetic: hook point for dedicated systems; claimed_at still
    // flips so the reward cannot be granted twice.
    const marked = await t.run(SQL_CLAIM, [now, userId, period, windowId, instanceId]);
    return {
      ok: marked.changes > 0,
      alreadyClaimed: false,
      reward,
      premium,
      premiumBonus: premium ? reward : null,
    };
  });
}

/** Ensure a fresh board exists for all three windows at boot (idempotent). */
export async function seedCurrentBoards(now = Date.now()): Promise<void> {
  for (const window of allWindows(now)) {
    await ensureBoard(window.period, window);
  }
}
