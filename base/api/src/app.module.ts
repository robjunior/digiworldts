import { Module } from '@nestjs/common';
import { ActivityModule } from './activity/activity.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { DailyModule } from './daily/daily.module';
import { DigimonModule } from './digimon/digimon.module';
import { ExploreModule } from './explore/explore.module';
import { FarmModule } from './farm/farm.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { MarketModule } from './market/market.module';
import { PrismaModule } from './prisma/prisma.module';
import { PvpModule } from './pvp/pvp.module';
import { ShopModule } from './shop/shop.module';
import { SocialModule } from './social/social.module';
import { WorldModule } from './world/world.module';

/**
 * Root application module — the composition root.
 *
 * TASK-1 left this empty of feature routes (it only proved the app boots).
 * TASK-2 registers {@link HealthModule} here for `GET /health`; TASK-4 adds
 * {@link PrismaModule} (the datastore provider) so persistence is available to
 * feature modules; TASK-5 adds {@link AuthModule} (the `/auth/*` account loop,
 * which imports PrismaModule for the datastore). TASK-8 adds
 * {@link DigimonModule} (the JWT-guarded `GET /digimon` roster API, which imports
 * PrismaModule for the datastore + AuthModule to reuse the JwtAuthGuard). TASK-15
 * adds {@link FarmModule} (the JWT-guarded `GET /farm` Farm/City API, which
 * likewise imports PrismaModule + AuthModule to reuse the guard). TASK-26 adds
 * {@link ShopModule} (the JWT-guarded `/api/shop` premium-shop API — catalog +
 * DigiCredits balance with a starter grant, and a `POST /api/shop/purchase` DEBIT
 * that spends DigiCredits + applies a QoL effect + writes an audit row in one
 * `$transaction` (imports PrismaModule + AuthModule the same way). Further domain
 * modules join the same way. TASK-34 adds {@link AdminModule} (the JWT+admin-gated
 * `POST /api/admin/grant` — an admin CREDITs a target player's balance + writes an
 * audit row in one `$transaction`; imports PrismaModule + AuthModule to reuse the
 * exported AdminGuard). Every such registration is ADDITIVE, preserving invariant 5
 * (the public API only ever grows or versions; released contracts never break
 * silently).
 *
 * TASK-36 adds {@link PvpModule} (the JWT-guarded `/api/pvp` ranked-PvP API —
 * `GET /api/pvp/opponents` lists challengeable players and `POST /api/pvp/challenge`
 * resolves a match via the EXISTING deterministic `simulateBattle` and moves BOTH
 * players' `mmr` by an Elo step in one `$transaction`; imports PrismaModule +
 * AuthModule to reuse the exported JwtAuthGuard). Rating is domain progression, so
 * it moves no balance + writes no audit row (invariant 3 untriggered).
 *
 * TASK-40 adds {@link ExploreModule} (the JWT-guarded `/api/explore` exploration API —
 * `GET /api/explore/map` returns the server-authoritative procedural tile map and
 * `POST /api/explore/:tileId/explore` triggers a wild encounter that runs the EXISTING
 * deterministic `simulateBattle`, persisting a WIN's XP reward through the shared curve;
 * imports PrismaModule + AuthModule to reuse the exported JwtAuthGuard). XP is domain
 * progression, so it moves no balance + writes no audit row (invariant 3 untriggered).
 *
 * TASK-42 adds {@link MarketModule} (the JWT-guarded `/api/market` player-market API —
 * `GET /api/market` lists open offers, `POST /api/market/list` lists an owned Digimon
 * for DigiCredits, and `POST /api/market/:listingId/buy` runs the paired economic
 * mutation: the buyer is DEBITED + the seller CREDITED + the Digimon reassigned + two
 * `market-sale` AuditLog rows, all in one `$transaction`; imports PrismaModule +
 * AuthModule to reuse the exported JwtAuthGuard). The sale MOVES spendable DigiCredits
 * between two players, so invariant 3 IS triggered and honored (two audit rows).
 *
 * TASK-44 adds {@link SocialModule} (the JWT-guarded `/api/social` friends API —
 * `POST /api/social/friends/request` sends a friend request by email,
 * `POST /api/social/friends/:id/accept` accepts a pending one, and
 * `GET /api/social/friends` lists accepted friends (with a `lastSeenAt`-derived `online`
 * indicator) + incoming requests; imports PrismaModule + AuthModule to reuse the exported
 * JwtAuthGuard). A friendship is domain state that moves no spendable value, so invariant
 * 3 is untriggered (no balance, no audit row). The `lastSeenAt` it reads is stamped as a
 * pure side-effect of the EXISTING `GET /auth/me` (its wire shape byte-unchanged).
 *
 * TASK-46 adds {@link WorldModule} (the JWT-guarded `/api/world` world API —
 * `GET /api/world/chunk?cx=&cy=` returns the 32×32 tiles of a chunk of the deterministic,
 * infinitely-generable square-tile world (each tile `{biome, walkable}`); imports ONLY
 * AuthModule to reuse the exported JwtAuthGuard — no PrismaModule, since the world is a
 * pure function of coordinates with no model/migration/state). A read of generated
 * terrain moves no spendable value, so invariant 3 is untriggered.
 *
 * TASK-235 adds {@link DailyModule} (the JWT-guarded `/api/daily` daily-reward API —
 * `GET /api/daily` reads the player's 7-day claim-streak state and `POST /api/daily/claim`
 * grants the current streak-day's reward once per UTC calendar day, advancing the streak +
 * CREDITing the day's `ResourceBalance` reward + writing a `daily-claim` AuditLog row in
 * one `$transaction`, refusing a second same-day claim; imports PrismaModule + AuthModule
 * to reuse the exported JwtAuthGuard). The claim MOVES spendable value, so invariant 3 IS
 * triggered and honored (an audited credit).
 *
 * TASK-248 adds {@link ActivityModule} (the JWT-guarded `/api/activity` activity-feed API —
 * `GET /api/activity` READS the caller's recent `AuditLog` rows newest-first, owner-scoped;
 * imports PrismaModule + AuthModule to reuse the exported JwtAuthGuard). READ-ONLY — it
 * projects the append-only ledger and moves no value, so invariant 3 is UNTRIGGERED.
 *
 * TASK-262 adds {@link InventoryModule} (the JWT-guarded `/api/inventory` player-inventory
 * API — `GET /api/inventory` READS the caller's owned `InventoryItem` stacks owner-scoped;
 * imports PrismaModule + AuthModule to reuse the exported JwtAuthGuard). READ-ONLY — the
 * WRITE (a grant) rides the EXISTING audited shop-purchase `$transaction`, so invariant 3
 * is UNTRIGGERED here (no separate, unaudited value path).
 */
@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    DigimonModule,
    FarmModule,
    ShopModule,
    AdminModule,
    PvpModule,
    ExploreModule,
    MarketModule,
    SocialModule,
    WorldModule,
    DailyModule,
    ActivityModule,
    InventoryModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
