import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Request body for `POST /digimon/:id/battle` (TASK-32, R-7) — selects WHICH fixed
 * PvE enemy the player's Digimon (identified by the path `:id`) fights.
 *
 * `@IsString() @IsNotEmpty()` rejects a missing/blank/non-string `enemyId` with a
 * 400 at the validation boundary; an unknown-but-well-formed id (a string that
 * matches no {@link ENEMY_ROSTER} entry) is a clean 404/422 from the service, NOT a
 * validation error — the DTO only proves the SHAPE, the service proves EXISTENCE.
 *
 * P-7 footgun (add-nest-feature-endpoint skill): this DTO is bound with a
 * PARAMETER-SCOPED `ValidationPipe({ expectedType: BattleDto, transform: true })` on
 * the `@Body()` (mirroring the global pipe's whitelist/transform) — NOT the global
 * pipe alone — or the vitest/esbuild transform omits the expected-type metadata and
 * validation is silently SKIPPED under the gate (a bad body would pass as 2xx).
 */
export class BattleDto {
  @IsString()
  @IsNotEmpty()
  enemyId!: string;
}
