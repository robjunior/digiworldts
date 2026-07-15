import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type { SerializedFightState } from '../digimon.types';

/**
 * Request body of `POST /digimon/:id/battle/turn` (TASK-140, R-22 — interactive combat).
 * One request resolves ONE player turn: the player's chosen `skillId` (validated
 * server-side against the palette + affordability), against the fixed `enemyId`. `state`
 * is the client-carried mid-fight snapshot (A-123 — no server session store this slice):
 * ABSENT = start a FRESH fight (the server seeds it); PRESENT = resume from the snapshot.
 *
 * `state` is validated only as a present-object (its stats are NEVER trusted — the server
 * rebuilds the authoritative `Combatant`s from the DB row + roster each turn); the shape
 * is the wire {@link SerializedFightState}.
 */
export class BattleTurnDto {
  @IsString()
  @IsNotEmpty()
  enemyId!: string;

  /**
   * The chosen skill's id. OPTIONAL: absent = OPEN a fresh fight and return the initial
   * menu WITHOUT resolving any turn (the "Start" preview — the player picks their FIRST
   * turn from the returned menu). Present = resolve the player's turn with this skill.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  skillId?: string;

  @IsOptional()
  @IsObject()
  state?: SerializedFightState;

  /**
   * The non-skill turn action. ADDITIVE — absent on every existing request, so
   * preview-vs-resolve (by `skillId`) is byte-identical to before.
   * - `'flee'` (TASK-143, R-22 slice 4): end the current live fight immediately (the player
   *   disengages). A flee request must carry the `state` of a LIVE fight and no `skillId`.
   * - `'pass'` (TASK-153, R-22 slice 14): advance a CONTROL-LOCKED turn (the player is
   *   stunned/frozen/asleep and cannot act). The server resolves the forced skip regardless
   *   of any `skillId` and does NOT 422 for an unknown/unaffordable skill — the whole turn is
   *   skipped. Carries the `state` of a LIVE fight; the honest no-op the client's "Continue"
   *   control posts when `playerControlLock` is non-null.
   * - `'timeout'` (TASK-185, R-24 slice 45a): resolve the player's turn with the engine's OWN
   *   default pick — `chooseSkill(state.player, state.enemy)` (the same deterministic affordable
   *   fallback the enemy side uses) — WITHOUT a `skillId`, so an inactive player whose per-action
   *   clock (TASK-186) expires can never HANG the fight. A `'timeout'` advances the turn exactly
   *   like a normal skill turn (it is NOT the START-PREVIEW) and NEVER 422s: the SERVER picks the
   *   move, so the client cannot clock-game into a better one (invariant 1). Carries the `state`
   *   of a LIVE fight; a control-LOCKED `'timeout'` is byte-identical to a locked `'pass'`.
   */
  @IsOptional()
  @IsString()
  @IsIn(['flee', 'pass', 'timeout'])
  action?: 'flee' | 'pass' | 'timeout';

  /**
   * The player-selected enemy DIFFICULTY (TASK-165, R-22 slice 26). OPTIONAL/additive — sent
   * on the OPENING request (fresh fight); the server seeds it onto the carried `state`, so
   * subsequent turns keep the choice with no extra client bookkeeping. Absent → the server
   * defaults to `'hard'` (today's full-banking enemy). The controller pipe is
   * `whitelist:true`, so an undeclared field would be STRIPPED — it MUST be declared here to
   * survive. Selects WHICH existing enemy selector the interactive seam injects; it moves no
   * spendable value (invariant 3 untriggered) and computes no combat rule client-side.
   */
  @IsOptional()
  @IsString()
  @IsIn(['easy', 'normal', 'hard'])
  difficulty?: 'easy' | 'normal' | 'hard';

  /**
   * The biome-derived enemy STRENGTH SCALE (TASK-168, R-22 slice 29). OPTIONAL/additive — sent
   * on the OPENING request (fresh fight); the server multiplies the foe's stat block once and
   * seeds it onto the carried `state`, so subsequent turns keep the scaled foe with no extra
   * client bookkeeping. Absent → the server defaults to `1` (the byte-identical baseline foe).
   * A finite number `>= 1` (a tougher foe, never weaker — A-42); the client only FORWARDS a
   * server-derived value (it computes no scaling rule, A-36 #3). Must be declared here to
   * survive the `whitelist:true` pipe. Moves no spendable value (invariant 3 untriggered).
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  enemyScale?: number;

  /**
   * The biome the wild encounter was rolled in (TASK-174, R-22 slice 35). OPTIONAL/additive —
   * sent on the OPENING request (fresh wild fight, handed off from `/world`); the server maps it
   * to a spendable loot RESOURCE (`lootResourceForBiome`) credited on a WIN, so a win's loot KIND
   * depends on WHERE it was won. Absent / unknown → the server falls back to the shipped
   * `BATTLE_LOOT_RESOURCE` (back-compat; safe/PvP/auto paths stay byte-identical). A plain public
   * biome string; the client only FORWARDS the server-derived value (it maps no rule, A-36 #3).
   * Must be declared here to survive the `whitelist:true` pipe. Moves no combat state; the credit
   * shape (invariant 3) is unchanged — only the resource string varies.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  biome?: string;

  /**
   * The acting party member's slot (TASK-272, R-44c — team-battle interactive DRIVE), 1-based to
   * mirror the persisted `partySlot` column. OPTIONAL/additive — names WHICH living party member's
   * turn this request drives (that member casts `skillId`; every other living member casts the
   * server default). ABSENT → the server defaults to the FRONT living member, so a client that
   * posts only a `skillId` (like today's 1v1) drives the front member exactly as before (the
   * length-1 identity anchor). Must be declared here to survive the `whitelist:true` pipe. Moves
   * no spendable value (invariant 3 untriggered); the enemy still targets the front member
   * deterministically (a menu-picked target is child R-44b). Bounded `>= 1` (a real slot).
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  memberSlot?: number;

  /**
   * The ordered ENEMY GROUP's roster ids (TASK-273, R-44a — multi-enemy encounter groups), sent on
   * the OPENING request (fresh wild fight, handed off from `/world`'s `enemies[]`). OPTIONAL/additive
   * — names WHICH wild species the fight fields as a PACK; the server rebuilds each enemy's
   * authoritative `Combatant` stat block from the roster EACH turn (never trusts the wire for stats —
   * invariant 2), so `enemyIds` only carries WHICH foes, in order. `enemyIds[0]` is the FRONT foe (=
   * the scalar `enemyId`). ABSENT / length ≤1 → the server fields the single `enemyId` foe, so a
   * client that posts only an `enemyId` (like today's 1v1) fights one enemy exactly as before (the
   * length-1 identity anchor). Must be declared here to survive the `whitelist:true` pipe. Bounded to
   * a group cap of 2 (`ArrayMaxSize`); moves no spendable value (invariant 3 untriggered).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  enemyIds?: string[];

  /**
   * The 0-based living-enemy INDEX the acting party member targets THIS turn (TASK-274, R-44b first
   * slice — per-member PICKED enemy target). OPTIONAL/additive — names WHICH living enemy the acting
   * member (`memberSlot`, or the front member by default) attacks when a GROUP (R-44a) is fielded.
   * ABSENT/invalid → the server targets the FRONT living enemy (the TASK-273 behaviour = the
   * invariant-5 identity anchor), so a client that omits it fights exactly as before. Server-validated
   * against the CURRENT living enemy set (never trusted raw — invariant 2; a bad/out-of-range/dead
   * index is 422'd with the fight UNCHANGED). Must be declared here to survive the `whitelist:true`
   * pipe. Bounded `0..1` (group cap is 2 → index 0 or 1); moves no spendable value (invariant 3
   * untriggered). The ENEMY still targets the front-living party member deterministically (enemy-picked
   * targeting + team PvP are the remaining R-44b child).
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  targetEnemyIndex?: number;
}
