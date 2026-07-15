import { IsIn, IsOptional } from 'class-validator';
import type { EvolutionBranch } from '../evolution';

/**
 * Optional request body for `POST /digimon/:id/evolve` (TASK-30, R-16) — selects
 * WHICH evolution branch to take: the original `'linear'` chain or the
 * accumulation-gated `'variant'` branch.
 *
 * `@IsOptional()` + a controller-side default of `'linear'` keeps the EXISTING
 * no-body evolve byte-compatible: a caller that POSTs nothing (or `{}`) still
 * evolves along the linear chain exactly as before this task (invariant 5,
 * backward-compatible). `@IsIn(['linear','variant'])` rejects any other string with
 * a 400 (so a typo'd branch is a clean validation error, not a silent linear evolve).
 *
 * P-7 footgun (add-nest-feature-endpoint skill): this DTO is bound with a
 * PARAMETER-SCOPED `ValidationPipe({ expectedType: EvolveDto, transform: true })` on
 * the `@Body()` — NOT the global pipe alone — or the vitest/esbuild transform omits
 * the expected-type metadata and validation is silently SKIPPED under the gate.
 */
export class EvolveDto {
  @IsOptional()
  @IsIn(['linear', 'variant'])
  branch?: EvolutionBranch;
}
