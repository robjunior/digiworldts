import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import type { SerializedFightState } from '../../digimon/digimon.types';

/**
 * Request body of `POST /api/pvp/challenge/turn` (TASK-182, R-23a2 slice 43 —
 * INTERACTIVE per-turn PvP). One request resolves ONE turn of a ranked duel driven
 * through the SAME shared `battleTurn`/`resolveActorTurn` engine PvE uses.
 *
 * It MIRRORS the PvE {@link BattleTurnDto} (`skillId?`/`state?`/`action?`) but names
 * the target as `opponentId` (WHO to duel — another real player) instead of a static
 * roster `enemyId`: the opponent's champion is resolved SERVER-SIDE from the DB and
 * injected as the shared seam's `foe` (invariant 2 — the foe is NEVER client-supplied
 * beyond naming which player). The challenger is the authenticated caller
 * (`request.user.id`, never trusted from the body).
 *
 * `state` is the client-carried mid-fight snapshot (A-123 — no server session store):
 * ABSENT = start a FRESH duel (the server seeds it + returns the opening menu);
 * PRESENT = resume from the snapshot. Its stats are NEVER trusted — the server rebuilds
 * the authoritative `Combatant`s (both champions) from the DB each turn.
 *
 * CRITICAL (P-7): the controller MUST bind this with a PARAMETER-SCOPED
 * `@Body(new ValidationPipe({ whitelist: true, transform: true, expectedType:
 * ChallengeTurnDto }))`, NOT a bare `@Body() dto` leaning on the global pipe — under
 * the vitest/esbuild transform the global pipe cannot see the DTO class and validation
 * is SILENTLY SKIPPED. The malformed-body → 400 e2e case guards against that regressing.
 */
export class ChallengeTurnDto {
  @IsString()
  @IsNotEmpty()
  opponentId!: string;

  /**
   * The chosen skill's id. OPTIONAL: absent = OPEN a fresh duel and return the initial
   * menu WITHOUT resolving any turn (the opening preview — the player picks their FIRST
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
   * The non-skill turn action, mirroring the PvE turn DTO — `'flee'` (disengage the
   * live duel), `'pass'` (advance a control-locked turn), or `'timeout'` (TASK-186,
   * R-24 slice 45b — the per-action countdown expired; the server picks the move via the
   * shared `battleTurn` seam's `chooseSkill`, so the challenger cannot clock-game).
   * ADDITIVE — absent on the ordinary skill-pick path; `dto.action` is forwarded verbatim
   * into the shared `DigimonService.battleTurn(...)`, which already understands `'timeout'`
   * (TASK-185), so no service change is needed — only this literal widen.
   */
  @IsOptional()
  @IsString()
  @IsIn(['flee', 'pass', 'timeout'])
  action?: 'flee' | 'pass' | 'timeout';

  /**
   * The challenger-selected opponent DIFFICULTY (TASK-183, R-23a2 slice 44a). MIRRORS the
   * PvE {@link BattleTurnDto.difficulty} verbatim (same `@IsOptional()` + `@IsIn([...])`
   * union). OPTIONAL/additive — sent on the OPENING request (fresh duel); the server
   * forwards it into the shared `battleTurn(...)` `difficulty` slot, so it is seeded onto
   * the carried `state` and persists across the round-trip with no extra client bookkeeping.
   * Absent → the server defaults to `'hard'` (`?? 'hard'` in `battleTurn`), byte-identical to
   * TASK-182 — every existing duel/fixture is unchanged. Selects WHICH existing enemy
   * selector the shared seam injects (`'easy'`→flat `chooseSkill`, `'normal'`→finisher,
   * `'hard'`→the full banking chain); it moves no spendable value (invariant 3 untriggered)
   * and computes no combat rule client-side. The controller pipe is `whitelist:true`, so an
   * undeclared field would be STRIPPED — it MUST be declared here to survive.
   */
  @IsOptional()
  @IsString()
  @IsIn(['easy', 'normal', 'hard'])
  difficulty?: 'easy' | 'normal' | 'hard';

  /**
   * The LIVE opponent's chosen skill id (TASK-312, R-44b — live-opponent action seam). When
   * present, the shared `battleTurn(...)` resolves the OPPONENT'S champion turn with THIS skill
   * instead of the engine AI pick (the two-sided-duel drive: a real human on the other side
   * chooses their champion's move). MIRRORS the `skillId` shape verbatim (`@IsOptional()`/
   * `@IsString()`/`@IsNotEmpty()`). ADDITIVE — absent on today's AI-driven duel path, in which
   * case the opponent's move stays AI-resolved (byte-identical to TASK-182). The server VALIDATES
   * it against the SAME palette/energy rules the AI honors (invariant 2 — never trusted from the
   * wire; only the *choice* of skill is supplied, the champion's stats stay DB-authoritative), so
   * an illegal/unaffordable pick refuses the turn (422) with the fight UNCHANGED. The controller
   * pipe is `whitelist:true`, so it MUST be declared here to survive stripping.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  opponentSkillId?: string;
}
