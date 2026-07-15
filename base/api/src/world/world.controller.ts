import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EncounterQueryDto } from './dto/encounter-query.dto';
import { WorldService } from './world.service';
import { toChunkView } from './world.types';
import type { EncounterView, WorldChunkView, WorldStateView } from './world.types';

/**
 * `/api/world` — the deterministic world API (TASK-46, R-17a). The FIRST world surface:
 * an authenticated player's Phaser client (TASK-47) streams the nearby chunks of the
 * server-authoritative, deterministic, infinitely-generable square-tile world.
 *
 * House feature-controller shape (P-1, the DIRECT analogue of {@link ExploreController} /
 * {@link PvpController}): a thin HTTP layer. The `GET chunk` route is a PURE MODULE call
 * ({@link toChunkView}) with no service; TASK-48 (R-17b) added `GET state` (the persisted
 * per-player Starter-City spawn) + `POST encounter` (a server-authoritative wild-encounter
 * roll), which DO need the datastore + server-side RNG, so a thin {@link WorldService} is
 * now injected (`@Inject(WorldService)` — the L-7/P-7 esbuild-DI footgun; a bare param
 * would inject `undefined` and 500 under the gate).
 *
 * Invariant 1: the SPA reaches the world ONLY through the `/api/world/*` funnel.
 * Invariant 2: every route is JWT-guarded; `state` is owner-scoped (`request.user.id`) so
 * a player reads only their OWN spawn, while chunks/cities/biomes are public terrain — no
 * owner-scoped leak. Invariant 3: NOT triggered (a spawn placement + an encounter roll
 * move no spendable value — no ResourceBalance/AuditLog, like xp/mmr). Invariant 5: the
 * two new routes + the two `User.spawn*` columns are purely additive; `GET chunk` and
 * `POST /digimon/:id/battle` stay byte-unchanged.
 */
@Controller('world')
export class WorldController {
  constructor(@Inject(WorldService) private readonly world: WorldService) {}

  /**
   * `GET /api/world/chunk?cx=<int>&cy=<int>` → 200 {@link WorldChunkView} — the 32×32
   * tiles of chunk `(cx, cy)` in row-major order. JwtAuthGuard runs first (401 without a
   * valid Bearer token).
   *
   * `cx`/`cy` arrive as raw query strings; we parse them with `Number.parseInt` and
   * REJECT a missing / non-integer value with a 400 BEFORE generating (fail fast on bad
   * input — no chunk is produced for garbage coordinates). `Number.parseInt` is deliberate
   * over `Number(...)`: a caller that appends `?cx=3.9` is treating tile coords as
   * integers, so we take the integer part rather than 400 — but a purely non-numeric
   * value (`?cx=x`, `NaN`) is a client bug and 400s.
   */
  @Get('chunk')
  @UseGuards(JwtAuthGuard)
  getChunk(@Query('cx') cx: string, @Query('cy') cy: string): WorldChunkView {
    const cxInt = Number.parseInt(cx, 10);
    const cyInt = Number.parseInt(cy, 10);
    if (Number.isNaN(cxInt) || Number.isNaN(cyInt)) {
      throw new BadRequestException('cx and cy must be integers (e.g. ?cx=0&cy=0)');
    }
    return toChunkView(cxInt, cyInt);
  }

  /**
   * `GET /api/world/state` → 200 {@link WorldStateView} — the caller's persisted
   * Starter-City spawn (`{x,y}`), the nearest city to it, and the min-spawn-distance
   * rule. Grant-on-first-read: the spawn is computed + persisted the first time and is
   * stable thereafter. Owner-scoped via `request.user.id` (invariant 2) — a player reads
   * only their OWN spawn. JwtAuthGuard runs first (401 without a valid Bearer token).
   */
  @Get('state')
  @UseGuards(JwtAuthGuard)
  getState(@Req() request: AuthenticatedRequest): Promise<WorldStateView> {
    return this.world.getStateForUser(request.user.id);
  }

  /**
   * `POST /api/world/encounter` → 200 {@link EncounterView} — the wild encounter (if any)
   * for a step at the absolute tile `{x,y}` in the body. The server reads the pure biome,
   * draws the roll SERVER-SIDE (the client never supplies it), and returns `null` or a
   * `{name, enemyId}` the existing `POST /digimon/:id/battle` accepts.
   *
   * `@HttpCode(200)` pins the contract (a POST would otherwise default to 201). The body
   * is bound with a PARAMETER-SCOPED `ValidationPipe({ expectedType: EncounterQueryDto })`
   * (mirroring the global pipe's whitelist/transform) — the P-7 footgun: leaning on the
   * global pipe alone silently SKIPS validation under the gate. `transform: true` coerces
   * the JSON numbers so `@IsInt` sees real numbers; a non-integer body 400s here.
   */
  @Post('encounter')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  rollEncounter(
    @Req() request: AuthenticatedRequest,
    @Body(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        expectedType: EncounterQueryDto,
      }),
    )
    dto: EncounterQueryDto,
  ): Promise<EncounterView> {
    // TASK-170 (R-22 slice 31): resolve the encounter for the AUTHENTICATED player so the
    // wild-enemy strength scale is seeded by THAT player's own team level (owner-scoped via
    // the already-present JWT guard, mirroring `getState` above) — a levelled account meets
    // a proportionally tougher foe on the same tile than a beginner.
    return this.world.rollEncounterForUser(request.user.id, dto.x, dto.y);
  }
}
