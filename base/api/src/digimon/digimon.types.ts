/**
 * Public shape of the `GET /digimon` response (TASK-8, R-3).
 *
 * The THIRD public API contract in the project (after `HealthStatus` and the
 * `/auth/*` types), written — like them — as an explicit exported interface other
 * code depends on. `GET /digimon`'s 200 body is `OwnedDigimon[]`: the signed-in
 * player's roster of owned Digimon. TASK-9's SPA keeps a LOCAL mirror of this to
 * type its roster client (no cross-workspace import — the house rule D-8 #1, same
 * as the web `/health` and `/auth` consumers mirror their server types); keep the
 * two in lock-step. Per invariant 5 (additive/versioned, never a silent break)
 * fields may be ADDED in later slices but an existing one must not change meaning
 * or vanish.
 */

/**
 * One owned Digimon as returned to the client.
 *
 * These are exactly the PUBLIC fields — the service projects rows to this shape so
 * internal/owner columns (`userId`, `createdAt`, `deletedAt`) NEVER cross the API
 * boundary (mirrors how the auth surface never leaks `passwordHash`). `id` is the
 * per-instance cuid (stable identity a later evolve/rename/release slice keys on);
 * `type` / `element` / `stage` are strings here because the datastore stores them
 * as plain `String` (SQLite has no enums — see schema.prisma / digimon.seed.ts);
 * the allowed vocabulary is documented on the seed's `StarterDigimon` unions.
 */
export interface OwnedDigimon {
  id: string;
  name: string;
  /** Attribute-triangle value, e.g. "Vaccine" | "Virus" | "Data" | "Free". */
  type: string;
  /** Elemental affinity, e.g. "Fire" | "Water" | "Nature" | "Electric" | "Neutral". */
  element: string;
  /** Evolution stage, e.g. "Rookie" (starters) | "Champion" | ... */
  stage: string;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  level: number;
  /**
   * Accumulated experience toward the NEXT level (TASK-29, R-6) — additive on this
   * shape (invariant 5). A training action (`POST /digimon/:id/train`) grants a fixed
   * amount; when `xp` reaches {@link xpToNext} the `level` ticks up and `xp` carries
   * the overflow into the next level. `0` for a brand-new starter.
   */
  xp: number;
  /**
   * The XP threshold to advance FROM the CURRENT `level` to `level + 1` (TASK-29,
   * R-6). Computed server-side from the single leveling curve in `training.ts` and
   * returned on the wire so the UI can render a "xp / xpToNext" progress denominator
   * WITHOUT a client-side mirror of the curve (no drift — D-8 #1). Derived, not a
   * stored column.
   */
  xpToNext: number;
  /**
   * Accumulated typed FIRE DATA (TASK-30, R-16) — additive on this shape (invariant
   * 5). Grows by a fixed amount per `POST /digimon/:id/train` alongside XP; once it
   * crosses the variant branch's threshold (see evolution.ts's `requiredData`) the
   * Digimon can evolve into a VARIANT form (e.g. Agumon → Meramon) via
   * `POST /digimon/:id/evolve` with `{ branch: 'variant' }` instead of the linear
   * chain. `0` for a brand-new starter. Fire Data is domain progression, NOT a
   * spendable resource (its grant is free — invariant 3 untriggered).
   */
  dataFire: number;
  /**
   * The ISO-8601 string of the server-stored TRAINING START timestamp (TASK-189, R-26
   * slice 48), or `null` when the digimon is NOT currently training. Additive-optional
   * (invariant 5). `POST /digimon/:id/train/start` sets it to `now()`; the UI computes a
   * live elapsed indicator from it and gates the Start vs Collect button; the elapsed
   * REWARD is computed SERVER-side (invariant 1), never from this client-read value.
   * `POST /digimon/:id/train/collect` clears it back to `null`.
   */
  trainingStartedAt?: string | null;
  /**
   * The player's chosen PARTY SLOT for this Digimon (TASK-255, R-31a) — `1`, `2`, or
   * `3` when it is in the party, or `null` when it is NOT. Additive-optional (invariant
   * 5). `POST /digimon/:id/party` sets/clears it (owner-scoped, one Digimon per slot);
   * this read surfaces it so a follow-on client control can render the persisted party
   * (Digimon with a non-null `partySlot`, ordered by slot) instead of the read-only
   * `slice(0,3)` view the Party rail shipped with. Party is DOMAIN state, not a
   * spendable resource (invariant 3 untriggered). `null`/absent on an old-shape row →
   * no client change breaks.
   */
  partySlot?: number | null;
}/**
 * One recorded action in a battle's turn-by-turn log (TASK-32, R-7) — the public
 * mirror of `battle.ts`'s `TurnLogEntry`, redeclared here (not imported) so the wire
 * contract lives with the other public shapes and TASK-33's SPA keeps a local mirror
 * of exactly this (D-8 #1). Must stay byte-compatible with `battle.ts`'s interface.
 */
export interface TurnLogEntry {
  /** 1-based round number; both combatants may act within the same round. */
  round: number;
  /** Which side struck this entry. */
  actor: 'player' | 'enemy';
  /** Damage dealt to the OTHER side on this action (always ≥ 1). */
  damage: number;
  /** The struck side's running HP AFTER this hit (clamped ≥ 0). */
  defenderHpAfter: number;
  /**
   * The NAME of the skill used this action (TASK-51, R-17c) — e.g. `"Attack"` /
   * `"Fire Breath"`. OPTIONAL/additive (invariant 5); absent on a pure Burn-tick
   * entry. Byte-mirror of `battle.ts`'s `TurnLogEntry.skill`.
   */
  skill?: string;
  /**
   * Human-readable status notes for this turn (TASK-51, R-17c) — e.g.
   * `"Numemon is Burned"` or `"Burn deals 4 to Numemon"`. OPTIONAL/additive;
   * absent when nothing statusful happened. Byte-mirror of `battle.ts`.
   */
  statusEvents?: string[];
  /**
   * Whether THIS strike landed a CRITICAL hit (TASK-159, R-22 slice 20).
   * OPTIONAL/additive; absent on a non-crit / status / tick entry. Byte-mirror of
   * `battle.ts`'s `TurnLogEntry.crit`.
   */
  crit?: boolean;
  /**
   * Whether THIS strike was EVADED / MISSED (TASK-160, R-22 slice 21) — crit's
   * mirror-image. OPTIONAL/additive; absent on a strike that landed / status / tick
   * entry. Byte-mirror of `battle.ts`'s `TurnLogEntry.evaded`.
   */
  evaded?: boolean;
  /**
   * Whether an OFFENSIVE status this turn was RESISTED by the defender / failed to
   * land (TASK-161, R-22 slice 22). OPTIONAL/additive; absent when the status landed
   * / on a non-status entry. Byte-mirror of `battle.ts`'s `TurnLogEntry.resisted`.
   */
  resisted?: boolean;
}

/**
 * Public shape of the `POST /digimon/:id/battle` response (TASK-32, R-7) — a
 * NET-NEW, additive contract (invariant 5); no existing view changes. The server
 * resolves the WHOLE fight deterministically and returns the outcome, the ordered
 * turn log (for TASK-33 to replay), the XP reward granted (0 on a loss), the enemy
 * that was fought, and the (possibly level-raised) Digimon in the SAME
 * {@link OwnedDigimon} shape `GET /digimon` returns — so the client can update its
 * roster in place from one response.
 */
export interface BattleOutcomeView {
  /** From the PLAYER's perspective. */
  outcome: 'win' | 'loss';
  /** The ordered turn-by-turn log; non-empty for any resolved fight. */
  turns: TurnLogEntry[];
  /**
   * The reward granted — `xpGained` is the win XP (or `0` on a loss).
   *
   * TASK-172 (R-22 slice 33): an ADDITIVE, OPTIONAL danger-reward breakdown of the
   * ALREADY-computed `xpGained` — populated ONLY on the interactive win branch when the
   * encounter danger scaled the reward (`activeEnemyScale !== 1`), so the player can SEE
   * why a deadlier fight paid more. `baseXp` = the un-scaled base (`BATTLE_XP_REWARD`),
   * `scaleBonus` = `xpGained - baseXp` (the danger-derived extra). NO new XP is granted —
   * `xpGained` (the total) is byte-identical to TASK-171. Both fields OMITTED at scale 1 /
   * on a non-win turn so pre-slice-33 readers (auto/PvP/explore reward paths) are
   * byte-unchanged (invariant 5). Display-only; the client computes NO rule (A-36 #3 / L-16).
   *
   * TASK-173 (R-22 slice 34): an ADDITIVE, OPTIONAL `loot` — the danger-scaled SPENDABLE
   * resource drop credited to the player's `ResourceBalance` on a wild interactive win
   * (`{ resource: 'DigiCredits', amount }`). Present ONLY on the interactive win branch;
   * OMITTED on loss / non-win / auto / PvP / explore paths so pre-slice-34 readers are
   * byte-unchanged (invariant 5). The persisted balance is separately visible on `/farm`.
   */
  reward: {
    xpGained: number;
    baseXp?: number;
    scaleBonus?: number;
    loot?: { resource: string; amount: number; rarity?: string };
  };
  /** Which fixed enemy was fought. */
  enemy: { id: string; name: string };
  /**
   * The player's Digimon after the fight: on a WIN, its persisted XP/level/stats
   * (may have ticked up); on a LOSS, unchanged (no penalty this slice). Same shape
   * as `GET /digimon` so the client refreshes the roster row directly.
   */
  digimon: OwnedDigimon;
}

/**
 * A single per-side snapshot on the wire (TASK-140, R-22) — the serializable form of
 * `battle.ts`'s `SideState`, with `inflicted` flattened `Set → string[]`. Byte-mirror of
 * `battle.ts`'s `SerializedSideState`; the SPA keeps a local mirror (D-8 #1). It carries
 * NO stats — those are the server-authoritative `Combatant`s rebuilt each turn.
 */
export interface SerializedSideState {
  hp: number;
  energy: number;
  statuses: unknown[];
  inflicted: string[];
  /**
   * DISPLAY-ONLY (TASK-147, R-22 slice 8): the effective SPD `resolveTurnOrder` used this
   * turn. Optional/additive — absent on any pre-slice snapshot. Byte-mirror of `battle.ts`'s
   * `SerializedSideState.effectiveSpd`; the SPA mirrors it too (D-8 #1). Never fed back into a
   * combat rule, so turn-order LOGIC stays byte-unchanged (invariant 5).
   */
  effectiveSpd?: number;
  /**
   * TASK-148 (R-22 slice 9): the CARRIED ATB accumulator — a REAL round-tripped field that
   * GROWS by `effectiveSpd` each interactive turn (UNLIKE display-only `effectiveSpd`).
   * Byte-mirror of `battle.ts`'s `SerializedSideState.atb`; the SPA mirrors it too (D-8 #1).
   * Read by NO combat rule; the web gauge renders `min(100%, atb ÷ ATB_THRESHOLD)`.
   */
  atb: number;
  /**
   * TASK-149 (R-22 slice 10): DISPLAY-ONLY flag — `true` when this side crossed
   * `ATB_THRESHOLD` and took ONE extra (bonus) action at the interactive seam this turn.
   * Byte-mirror of `battle.ts`'s `SerializedSideState.extraActed`; the SPA mirrors it (D-8 #1).
   * Optional (absent → falsy), never fed back into a rule — the web HUD renders the
   * "ATB FULL — extra action!" payoff marker from it.
   */
  extraActed?: boolean;
  /**
   * TASK-150 (R-22 slice 11): DISPLAY-ONLY count — the number of extra (bonus) actions this
   * side took from its banked ATB at the interactive seam this turn (`0` when none; capped at
   * `MAX_ATB_BONUS_ACTIONS`). Byte-mirror of `battle.ts`'s `SerializedSideState.bonusActions`;
   * the SPA mirrors it (D-8 #1). Optional (absent on pre-slice snapshots → HUD degrades to the
   * `extraActed` boolean marker), never fed back into a rule — the web HUD renders the
   * "ATB FULL — extra action ×N!" payoff marker from it.
   */
  bonusActions?: number;
}

/**
 * The client-carried mid-fight snapshot (TASK-140, R-22). The interactive turn route
 * has NO server session store this slice (A-123) — the client posts back the `state` it
 * received to resume the fight. Byte-mirror of `battle.ts`'s `SerializedFightState`.
 */
export interface SerializedFightState {
  player: SerializedSideState;
  enemy: SerializedSideState;
  round: number;
  /**
   * The resolved outcome, or `null` while the fight continues. `'fled'` (TASK-143,
   * R-22 slice 4) is produced ONLY by the interactive `battleTurn` flee branch — the
   * auto-resolve engine never assigns it (invariant 5 held: the union widens
   * additively, no `simulateBattle` logic changes).
   */
  decided: 'win' | 'loss' | 'fled' | null;
  /**
   * TASK-165 (R-22 slice 26): the carried player-selected enemy DIFFICULTY (`'easy'` → the
   * flat `chooseSkill` enemy; `'hard'` → the full banking chain). Byte-mirror of `battle.ts`'s
   * `SerializedFightState.difficulty`; the SPA mirrors it too (D-8 #1). Optional/additive
   * (absent on any pre-slice snapshot → the server defaults it to `'hard'` = today's enemy),
   * never fed back into a combat rule — the auto path stays byte-frozen (invariant 5).
   */
  difficulty?: 'easy' | 'normal' | 'hard';
  /**
   * TASK-168 (R-22 slice 29): the carried biome-derived enemy STRENGTH SCALE (>= 1) applied
   * once to the foe's stat block at the interactive rebuild seam. Byte-mirror of `battle.ts`'s
   * `SerializedFightState.enemyScale`; the SPA mirrors it too (D-8 #1). Optional/additive
   * (absent on any pre-slice snapshot → the server defaults it to `1` = today's baseline foe),
   * never fed back into a combat rule — the auto path stays byte-frozen (invariant 5).
   */
  enemyScale?: number;
  /**
   * TASK-272 (R-44c — team-battle interactive DRIVE): the wire form of the whole PLAYER PARTY's
   * live per-member snapshots, in party-slot order. Byte-mirror of `battle.ts`'s
   * `SerializedFightState.players`; the SPA mirrors it too (D-8 #1). ADDITIVE-OPTIONAL — present
   * ONLY when a party of >1 members is set, OMITTED otherwise → every pre-slice single reader is
   * byte-unaffected (the length-1 identity anchor). The scalar `player` stays populated with the
   * FRONT/active member. Read by NO combat rule on the client (A-36 #3 / L-16) — the server drives.
   */
   players?: SerializedSideState[];
   /**
    * TASK-273 (R-44a — multi-enemy encounter groups): the wire form of the whole ENEMY GROUP's live
    * per-member snapshots, in group order. Byte-mirror of `battle.ts`'s `SerializedFightState.enemies`;
    * the SPA mirrors it too (D-8 #1). ADDITIVE-OPTIONAL — present ONLY when a group of >1 enemies is
    * fielded, OMITTED otherwise → every pre-slice single reader is byte-unaffected (the length-1
    * identity anchor). The scalar `enemy` stays populated with the FRONT/active enemy. Read by NO
    * combat rule on the client (A-36 #3 / L-16) — the server drives.
    */
   enemies?: SerializedSideState[];
 }

/** One entry in the player's affordable-skill MENU for the NEXT turn (TASK-140). */
export interface BattleSkillOption {
  id: string;
  name: string;
  energyCost: number;
  /** Whether the player can pay for it at the start of their next turn (server truth). */
  affordable: boolean;
  /**
   * R-34 / TASK-205 — the DISPLAY element/attribute this skill is grouped under on
   * the `/battle` menu (copied through from the catalog `Skill.element`). OPTIONAL
   * + display-only: no combat rule reads it (invariant 5, D-8 #1 byte-mirrored into
   * `apps/web/src/api/battle.ts`).
   */
  element?: string;
}

/**
 * Public shape of `POST /digimon/:id/battle/turn` (TASK-140, R-22) — the INTERACTIVE
 * turn route response, a NET-NEW additive contract (invariant 5). One request resolves
 * ONE player turn (the chosen skill) + the enemy's automatic reply, so control returns to
 * the player. `state` is the snapshot to carry into the next turn, or `null` when the
 * fight has ended (then `outcome` is non-null). `entries` are ONLY this exchange's log
 * entries (the client APPENDS them to its running log — contained-refetch, never blanks).
 * `playerSkills` is the menu for the NEXT player turn (empty when the fight ended).
 */
export interface BattleTurnView {
  /** The snapshot to carry into the next turn, or `null` when the fight ended. */
  state: SerializedFightState | null;
  /** Only THIS exchange's turn-log entries (player turn + enemy reply). */
  entries: TurnLogEntry[];
  /**
   * Non-null only on the turn that ENDS the fight. `'fled'` (TASK-143, R-22 slice 4)
   * is the player disengaging via the Flee turn action — the fight ends with NO
   * reward (invariant 3 untriggered) and NO persistence, distinct from `'win'`/`'loss'`.
   */
  outcome: 'win' | 'loss' | 'fled' | null;
  /**
   * The XP reward granted — non-zero only on the winning final turn.
   *
   * TASK-172 (R-22 slice 33): the OPTIONAL `baseXp`/`scaleBonus` danger-reward breakdown of
   * the ALREADY-computed `xpGained`, populated only on a danger-scaled win (`activeEnemyScale
   * !== 1`) and omitted otherwise (invariant 5 back-compat). See {@link BattleOutcomeView.reward}.
   *
   * TASK-173 (R-22 slice 34): the OPTIONAL `loot` danger-scaled spendable drop, present only
   * on the interactive wild win branch (invariant 5 back-compat). See {@link BattleTurnView.reward}.
   *
   * TASK-269 (R-31e fourth slice): the OPTIONAL `xpLost`/`inventoryWiped` loss-penalty report,
   * present ONLY on the interactive PvE-LOSS branch (`outcome === 'loss' && !skipEconomicReward`)
   * and OMITTED on win/flee/undecided/auto/PvP paths (invariant 5 back-compat). `xpLost` is the
   * real before→after XP drop (`>= 0`); `inventoryWiped` is `true` iff ≥1 owned stack was wiped.
   * Display-only — the destruction is the shipped `battle-loss`/`battle-loss-wipe` behaviour;
   * these fields only REPORT it so the client can show a defeat notice.
   */
  reward: {
    xpGained: number;
    baseXp?: number;
    scaleBonus?: number;
    loot?: { resource: string; amount: number; rarity?: string };
    xpLost?: number;
    inventoryWiped?: boolean;
  };
  /** The affordable-skill menu for the next player turn (empty when ended). */
  playerSkills: BattleSkillOption[];
  /** Which fixed enemy is being fought. */
  enemy: { id: string; name: string };
  /**
   * The player's Digimon — persisted (XP/level raised) ONLY on the winning final turn;
   * otherwise the current row unchanged. Same shape as `GET /digimon`.
   */
  digimon: OwnedDigimon;
  /**
   * TELEGRAPH (TASK-142, R-22 slice 3) — the enemy's NEXT intended skill, so the player
   * can PLAN their upcoming pick against what is coming (tactical, not blind-reactive).
   * OPTIONAL + nullable additive field (invariant 5 — a client on the old shape ignores
   * it, no migration). It is the server-computed `chooseSkill(state.enemy, state.player)`
   * on the returned live state — the EXISTING pure enemy selector REUSED, not a client
   * re-derivation (A-36 #3 / L-16). `null` when the fight has ENDED (`state === null`) or
   * the enemy has no available choice; the client renders only `.name`, computing NO
   * selection logic.
   *
   * TASK-151 (R-22 slice 12): ADDITIVE optional `projectedActions` — HOW MANY actions the
   * enemy will take next turn (projected from its carried residual `atb` + next SPD via the
   * pure `projectedBonusActions`, mirroring the drain-loop bound). Display-only, read by no
   * rule; `undefined` on a pre-slice snapshot. The client shows a "(×N!)" incoming-combo
   * warning only when `>= 2` (a single incoming action is the normal, unwarned case).
   */
  nextEnemy?: { skillId: string; name: string; projectedActions?: number } | null;

  /**
   * TASK-152 (R-22 slice 13): the player's OWN projected bonus-action count for next turn
   * (display-only, read by no rule; forecast, not a contract — A-135). Symmetric to
   * `nextEnemy.projectedActions` but a smaller shape: the player has no telegraphed "next
   * skill" (they CHOOSE), so this carries ONLY the count. Projected from the player's carried
   * residual `atb` + next SPD via the SAME pure `projectedBonusActions` (mirrors the drain-loop
   * bound). `null` when the fight has ENDED; `undefined` on a pre-slice snapshot.
   */
  nextPlayer?: { projectedActions: number } | null;

  /**
   * TASK-153 (R-22 slice 14): the CONTROL-LOCK the player is carrying INTO their upcoming turn —
   * `stun` | `freeze` | `sleep` (the SAME set `resolveActorTurn` skips a turn for). Non-null ONLY
   * on a LIVE fight where the player is locked (then `playerSkills` is `[]` — nothing is pickable,
   * the whole turn is a forced skip the server resolves regardless of the posted skill); `null`
   * once the fight has ENDED or when the player is unlocked; `undefined` on a pre-slice snapshot.
   * Display-only, read by no combat rule (invariant 5) — it makes the already-built control-lock
   * ailments LEGIBLE + HONEST on the interactive path (present ≠ observable, L-17).
   */
  playerControlLock?: { kind: 'stun' | 'freeze' | 'sleep'; label: string } | null;

  /**
   * TASK-154 (R-22 slice 15): the CONTROL-LOCK the ENEMY is carrying INTO its upcoming turn — the
   * exact enemy-side MIRROR of `playerControlLock`. When non-null the enemy is stunned/frozen/asleep
   * and `resolveActorTurn`'s actor-symmetric `stunnedThisTurn` guard will SILENTLY DISCARD the
   * enemy's telegraphed action (it forgoes its turn), so the client shows "Enemy is {label} — skips
   * this turn." ALONGSIDE the (unchanged) `nextEnemy` intent line. Non-null ONLY on a LIVE fight
   * where the enemy is locked; `null` once ENDED or when unlocked; `undefined` on a pre-slice
   * snapshot. Read by no combat rule (invariant 5) — makes the already-built enemy control-lock skip
   * HONEST on the interactive HUD (present ≠ observable, L-17).
   */
  nextEnemyControlLock?: { kind: 'stun' | 'freeze' | 'sleep'; label: string } | null;

  /**
   * TASK-271 (R-44 slice — team battle): the ordered PLAYER PARTY for this fight — the authed
   * user's `partySlot`-non-null owned Digimon (≤3), sorted by slot, projected to a small
   * display identity `{ id, name }`. ADDITIVE-OPTIONAL: OMITTED entirely when the user has NO
   * party set (a lone active-Digimon 1v1 — the byte-identical fallback so every pre-slice single
   * reader is unaffected; the client renders exactly as today). When present it lets the `/world`
   * combat overlay draw each party member on the player side (display-only — the client RENDERS
   * the members; every combat rule stays in the pure engine, A-36 #3 / L-16). The FIRST/front
   * member is the same Digimon carried on `digimon`/`state.player` (the identity anchor). The
   * enemy side stays single (multi-enemy is child R-44a).
   */
   partyMembers?: { id: string; name: string }[];
   /**
    * TASK-273 (R-44a — multi-enemy encounter groups): the ordered ENEMY GROUP for this fight — the
    * rolled wild pack (1..2 distinct species), projected to a small display identity `{ id, name }`
    * (`id` is the roster `enemyId`). ADDITIVE-OPTIONAL: OMITTED entirely when a single enemy is
    * fielded (a 1v1 — the byte-identical fallback so every pre-slice single reader is unaffected;
    * the client renders exactly as today). When present it lets the `/world` combat overlay draw each
    * enemy on the enemy side (display-only — the client RENDERS the enemies; every combat rule stays
    * in the pure engine, A-36 #3 / L-16). The FIRST/front enemy is the same foe carried on `enemy`
    * (the identity anchor) — the symmetric mirror of `partyMembers`.
    */
   enemyMembers?: { id: string; name: string }[];
 }
