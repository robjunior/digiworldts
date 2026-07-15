import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ExploreService } from './explore.service';
import type { ExploreOutcomeView, TileView } from './explore.types';

/**
 * `/api/explore` — the exploration API (TASK-40, R-9). The FIRST exploration surface:
 * an authenticated player fetches the server-authoritative procedural tile map and
 * explores a tile to trigger a wild-Digimon encounter that feeds the EXISTING combat
 * core. The later R-9 slices (the hex renderer, fog-of-war, movement, loot — carved
 * children, A-33) reuse this write path.
 *
 * House feature-controller shape (P-1, the DIRECT analogue of {@link PvpController} /
 * {@link ShopController} — copied deliberately): a thin HTTP layer that delegates the
 * rules to {@link ExploreService}. This is the API layer TASK-41's `/explore` screen
 * consumes over `apiUrl` (invariant 1: the SPA reaches the map + the explore write ONLY
 * through these endpoints, never the datastore directly).
 *
 * Both routes are guarded by the EXISTING {@link JwtAuthGuard} (reused from AuthModule
 * via `imports: [AuthModule]`): 401 without a valid Bearer token. The module is additive
 * (invariant 5); no existing route changes.
 */
@Controller('explore')
export class ExploreController {
  // Explicit @Inject(ExploreService) token — REQUIRED (L-7/P-7): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain DI would inject
  // `undefined` and the route would 500 under the gate. Resolves identically under tsc
  // (build). NO other ctor param.
  constructor(@Inject(ExploreService) private readonly explore: ExploreService) {}

  /**
   * `GET /api/explore/map` → 200 {@link TileView}[] — the server-authoritative world
   * map. Each tile's `hasEncounter` flag reveals THAT a fight awaits without leaking
   * WHICH enemy (invariant 2). JwtAuthGuard runs first (401 without a valid token).
   */
  @Get('map')
  @UseGuards(JwtAuthGuard)
  getMap(): TileView[] {
    return this.explore.getMap();
  }

  /**
   * `POST /api/explore/:tileId/explore` → 200 {@link ExploreOutcomeView} — explore the
   * named tile. An empty tile returns `outcome:'empty'` (no write); an encounter tile
   * resolves the deterministic `simulateBattle` against a wild Digimon and, on a WIN,
   * persists the XP reward (the Digimon may level up).
   *
   * NO body/DTO (like `train` / `battle` — the `:tileId` path param + the authenticated
   * `request.user.id` are the whole input), so there is no P-7 validation-pipe footgun
   * here; the tileId is validated by the service's `findTile` → 404. `@HttpCode(200)`
   * pins the response to 200 OK: a `@Post` defaults to 201 Created, but exploring is not
   * a resource creation — it returns the resolved outcome, so 200 is the honest,
   * contracted status (the same reason battle/train/challenge pin 200 over the POST
   * default).
   */
  @Post(':tileId/explore')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  exploreTile(
    @Req() request: AuthenticatedRequest,
    @Param('tileId') tileId: string,
  ): Promise<ExploreOutcomeView> {
    return this.explore.exploreTile(request.user.id, tileId);
  }
}
