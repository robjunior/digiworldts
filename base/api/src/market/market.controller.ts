import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ListDigimonDto } from './dto/list-digimon.dto';
import { MarketService } from './market.service';
import type { MarketListingView, MarketState } from './market.types';

/**
 * `/api/market` — the player-market API (TASK-42, R-10). The smallest runnable slice:
 * a seller lists an owned Digimon for DigiCredits, all open listings are visible, and
 * another player buys one (currency + ownership move server-side, audit-logged).
 *
 * House feature-controller shape (P-1, the DIRECT analogue of {@link ShopController} /
 * {@link PvpController} — copied deliberately): a thin HTTP layer that delegates the
 * rules to {@link MarketService}. This is the API layer TASK-43's `/market` screen
 * consumes over `apiUrl` (invariant 1: the SPA reaches the listings + the sale ONLY
 * through these endpoints, never the datastore directly).
 *
 * All three routes are guarded by the EXISTING {@link JwtAuthGuard} (reused from
 * AuthModule via `imports: [AuthModule]`): 401 without a valid Bearer token. The
 * module is additive (invariant 5); no existing route changes.
 */
@Controller('market')
export class MarketController {
  // Explicit @Inject(MarketService) token — REQUIRED (L-7/P-7): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain DI would inject
  // `undefined` and the route would 500 under the gate. Resolves identically under tsc
  // (build). NO other ctor param.
  constructor(@Inject(MarketService) private readonly market: MarketService) {}

  /**
   * `GET /api/market` → 200 {@link MarketListingView}[] — every OPEN listing, leak-safe
   * (a display name + the Digimon's public fields; never `sellerId`/email). Visible to
   * any signed-in player. JwtAuthGuard pins `request.user`; no per-caller filtering is
   * needed (the market is public to all players).
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  listings(): Promise<MarketListingView[]> {
    return this.market.getOpenListings();
  }

  /**
   * `POST /api/market/list` → 200 {@link MarketListingView} — list the caller's own
   * Digimon for a DigiCredits price.
   *
   * JwtAuthGuard runs first (401 without a valid token); we read the SELLER's id
   * (`request.user.id`, never trusted from the body) and delegate. The service resolves
   * the Digimon owner-scoped (404 if not the caller's), guards the price (422 if < 1)
   * and one-open-listing-per-Digimon (422 if already listed), then creates it.
   *
   * The body `{ digimonId, priceCredits }` is validated by a PARAMETER-SCOPED
   * `ValidationPipe({ whitelist, transform, expectedType: ListDigimonDto })` — NOT a
   * bare `@Body() dto` leaning on the global pipe (P-7): under the vitest/esbuild
   * transform the global pipe cannot see the DTO class and validation would be SILENTLY
   * SKIPPED. The malformed-body → 400 e2e case guards against this regressing.
   *
   * `@HttpCode(200)` pins 200 OK: a listing IS a created resource, but the house idiom
   * returns the projected view at 200 (matching shop/pvp), so the client reads a
   * uniform success shape.
   */
  @Post('list')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  list(
    @Req() request: AuthenticatedRequest,
    @Body(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        expectedType: ListDigimonDto,
      }),
    )
    dto: ListDigimonDto,
  ): Promise<MarketListingView> {
    return this.market.listDigimon(request.user.id, dto.digimonId, dto.priceCredits);
  }

  /**
   * `POST /api/market/:listingId/buy` → 200 {@link MarketState} — buy an open listing;
   * DigiCredits transfer seller↔buyer, the Digimon changes hands, audit-logged on both
   * sides, all atomic.
   *
   * JwtAuthGuard runs first (401 without a valid token); we read the BUYER's id
   * (`request.user.id`) and the `listingId` from the path and delegate. The service
   * runs the whole paired mutation in one `$transaction` (404 unknown listing / 422
   * self-buy / 409 stale listing / 422 insufficient DigiCredits). NO body/DTO — the
   * listing id in the path fully identifies the buy.
   *
   * `@HttpCode(200)` pins 200 OK (a buy is not a fresh-resource creation — it returns
   * the resolved sale — matching collect/purchase/challenge).
   */
  @Post(':listingId/buy')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  buy(
    @Req() request: AuthenticatedRequest,
    @Param('listingId') listingId: string,
  ): Promise<MarketState> {
    return this.market.buyListing(request.user.id, listingId);
  }
}
