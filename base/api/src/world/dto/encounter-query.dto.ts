import { IsInt } from 'class-validator';

/**
 * Request body for `POST /api/world/encounter` (TASK-48, R-17b) — the absolute tile
 * coordinate the player is standing on when a step MIGHT surface a wild encounter. The
 * server reads the pure biome at `(x, y)`, draws the roll SERVER-SIDE, and answers with
 * the encounter (if any) — the client never supplies the roll (server-authoritative).
 *
 * `@IsInt()` rejects a missing / non-integer / non-numeric `x`/`y` with a 400 at the
 * validation boundary (tile coords are whole numbers). Any integer — including negative —
 * is valid: the world is unbounded (total over ℤ²).
 *
 * P-7 footgun (add-nest-feature-endpoint skill): this DTO is bound with a
 * PARAMETER-SCOPED `ValidationPipe({ expectedType: EncounterQueryDto, transform: true })`
 * on the `@Body()` (mirroring the global pipe's whitelist/transform) — NOT the global
 * pipe alone — or the vitest/esbuild transform omits the expected-type metadata and
 * validation is silently SKIPPED under the gate (a bad body would pass as 2xx).
 * `transform: true` coerces the JSON numbers so `@IsInt` sees real numbers.
 */
export class EncounterQueryDto {
  @IsInt()
  x!: number;

  @IsInt()
  y!: number;
}
