import { describe, expect, it, vi } from 'vitest';
import { DigimonController } from './digimon.controller';
import type { DigimonService } from './digimon.service';
import type { BattleTurnView } from './digimon.types';
import { BattleTurnDto } from './dto/battle-turn.dto';
import { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { DEFAULT_RNG, LIVE_RNG } from './rng';

/**
 * RNG WIRING (TASK-177, R-22 slice 38 — TURN ON REAL PER-PLAYER RANDOMNESS).
 *
 * The five injected-RNG combat rolls (flee / crit / evade / resist / lucky loot-rarity)
 * are all threaded through `DigimonService.battleTurn(…, rng: Rng = DEFAULT_RNG)`, but
 * before this slice the controller passed `undefined` into the `rng` slot, so production
 * always fell back to `DEFAULT_RNG = () => 0` and NONE of them ever fired for a real
 * player. This proves the WIRING: the controller now feeds `LIVE_RNG` (real
 * `Math.random`-backed entropy, drawn at the HTTP boundary) into the 7th argument.
 *
 * DELIBERATELY a direct-instantiation controller unit test (NOT an HTTP e2e), and it
 * asserts the WIRING (which const is passed), never a rolled OUTCOME — a real
 * `Math.random` draw over HTTP would flake (L-55/L-56 non-flaky discipline). The
 * rolled-outcome behaviour of each consumer stays covered by the existing direct-service
 * injected-stub tests; those inject `DEFAULT_RNG`/explicit stubs and are UNTOUCHED.
 */
describe('battleTurn controller RNG wiring', () => {
  const makeController = () => {
    const spy = vi.fn(async () => ({}) as BattleTurnView);
    // Only the one method under test is needed on the stub service.
    const service = { battleTurn: spy } as unknown as DigimonService;
    return { controller: new DigimonController(service), spy };
  };

  const request = { user: { id: 'user-1' } } as AuthenticatedRequest;
  const dto: BattleTurnDto = { enemyId: 'enemy-1', skillId: 'skill-1' };

  it('passes LIVE_RNG (real entropy) into the rng slot — not undefined/DEFAULT_RNG', async () => {
    const { controller, spy } = makeController();
    await controller.battleTurn('digimon-1', request, dto);

    expect(spy).toHaveBeenCalledTimes(1);
    // The 7th positional argument (index 6, after userId, id, enemyId, skillId, state,
    // action) is the injected `rng`. Production now feeds real per-player entropy.
    const rngArg = spy.mock.calls[0][6];
    expect(rngArg).toBe(LIVE_RNG);
    expect(rngArg).not.toBe(DEFAULT_RNG);
    expect(rngArg).not.toBeUndefined();
  });

  it('forwards the identifying + option arguments in the documented order', async () => {
    const { controller, spy } = makeController();
    await controller.battleTurn('digimon-1', request, {
      enemyId: 'enemy-1',
      skillId: 'skill-1',
      difficulty: 'easy',
      enemyScale: 2,
      biome: 'mountain',
    });

    const call = spy.mock.calls[0];
    expect(call[0]).toBe('user-1'); // userId (from the authenticated request)
    expect(call[1]).toBe('digimon-1'); // path :id
    expect(call[2]).toBe('enemy-1'); // dto.enemyId
    expect(call[3]).toBe('skill-1'); // dto.skillId
    expect(call[6]).toBe(LIVE_RNG); // rng — the slice-38 flip
    expect(call[7]).toBe('easy'); // dto.difficulty
    expect(call[8]).toBe(2); // dto.enemyScale
    expect(call[9]).toBe('mountain'); // dto.biome
  });
});
