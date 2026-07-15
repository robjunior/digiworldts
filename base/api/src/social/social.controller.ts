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
import { FriendRequestDto } from './dto/friend-request.dto';
import { SocialService } from './social.service';
import type { FriendView, FriendsResponse } from './social.types';

/**
 * `/api/social` — the social friends API (TASK-44, R-11). The smallest runnable slice:
 * a player sends a friend request to another by email, the other accepts, and both see
 * each other in a friends list with a `lastSeenAt`-derived online indicator.
 *
 * House feature-controller shape (P-1, the DIRECT analogue of {@link MarketController} /
 * {@link PvpController} — copied deliberately): a thin HTTP layer that delegates the
 * rules to {@link SocialService}. This is the API layer TASK-45's `/friends` screen will
 * consume over `apiUrl` (invariant 1: the SPA reaches the friends list + the request/
 * accept ONLY through these endpoints, never the datastore directly).
 *
 * All three routes are guarded by the EXISTING {@link JwtAuthGuard} (reused from
 * AuthModule via `imports: [AuthModule]`): 401 without a valid Bearer token. The module
 * is additive (invariant 5); no existing route changes.
 */
@Controller('social')
export class SocialController {
  // Explicit @Inject(SocialService) token — REQUIRED (L-7/P-7): the vitest/esbuild
  // transform omits constructor `design:paramtypes`, so plain DI would inject `undefined`
  // and the route would 500 under the gate. Resolves identically under tsc (build).
  constructor(@Inject(SocialService) private readonly social: SocialService) {}

  /**
   * `POST /api/social/friends/request` → 200 {@link FriendView} — send a friend request
   * to the player identified by `{ email }`.
   *
   * JwtAuthGuard runs first (401 without a valid token); we read the REQUESTER's id
   * (`request.user.id`, never trusted from the body) and delegate. The service resolves
   * the target (404 unknown email), guards self-request (422) + a duplicate edge in
   * either direction (409), then creates the pending edge.
   *
   * The body `{ email }` is validated by a PARAMETER-SCOPED `ValidationPipe({ whitelist,
   * transform, expectedType: FriendRequestDto })` — NOT a bare `@Body() dto` (P-7): under
   * the vitest/esbuild transform the global pipe cannot see the DTO class and validation
   * would be SILENTLY SKIPPED. The malformed-body → 400 e2e case guards against that.
   *
   * `@HttpCode(200)` pins 200 OK (the house idiom returns the projected view at 200,
   * matching market/shop/pvp).
   */
  @Post('friends/request')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  request(
    @Req() request: AuthenticatedRequest,
    @Body(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        expectedType: FriendRequestDto,
      }),
    )
    dto: FriendRequestDto,
  ): Promise<FriendView> {
    return this.social.sendRequest(request.user.id, dto.email);
  }

  /**
   * `POST /api/social/friends/:id/accept` → 200 {@link FriendView} — accept a pending
   * request. NO body — the edge id in the path fully identifies the accept.
   *
   * JwtAuthGuard runs first (401 without a valid token); we read the caller's id
   * (`request.user.id`) and the edge `id` from the path and delegate. The service
   * resolves the pending edge (404 unknown/non-pending), authorizes ONLY the addressee
   * (403 otherwise), and flips it to accepted.
   *
   * `@HttpCode(200)` pins 200 OK (accepting is not a fresh-resource creation — it
   * returns the resolved friendship).
   */
  @Post('friends/:id/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  accept(@Req() request: AuthenticatedRequest, @Param('id') id: string): Promise<FriendView> {
    return this.social.acceptRequest(request.user.id, id);
  }

  /**
   * `GET /api/social/friends` → 200 `{ friends, incoming }` — the caller's accepted
   * friends (each with an `online` indicator) + the pending requests addressed to them.
   *
   * JwtAuthGuard runs first (401 without a valid token); we read the caller's id and
   * delegate. Owner-scoped (invariant 2); leaks only a display name + an online boolean
   * per counterpart, never their email/id.
   */
  @Get('friends')
  @UseGuards(JwtAuthGuard)
  friends(@Req() request: AuthenticatedRequest): Promise<FriendsResponse> {
    return this.social.getFriends(request.user.id);
  }
}
