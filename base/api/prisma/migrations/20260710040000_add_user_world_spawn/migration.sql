-- AlterTable
-- TASK-48 (R-17b): add the additive `spawnX`/`spawnY` columns to User — the player's
-- persisted Starter-City spawn tile in the deterministic Digiworld. Both NULLABLE
-- INTEGER with NO default, so every existing row reads NULL = "no spawn yet" and no
-- account's world placement changes on deploy; the 12 prior committed migrations stay
-- byte-stable and no released contract breaks (invariant 5). SQLite supports adding a
-- nullable column in place. WorldService.getStateForUser computes the spawn ONCE on
-- first read (the grant-on-first-read idiom) via the PURE findSpawnTile(seed) — a
-- walkable, non-city tile at least MIN_SPAWN_DISTANCE tiles from the nearest city — and
-- persists it here so a re-read never moves the spawn. City POSITIONS are NOT stored
-- (a pure function of coordinates in world.map.ts); only the chosen spawn persists.
-- Spawn placement is DOMAIN state, not spendable value — no ResourceBalance/AuditLog
-- (invariant 3 untriggered, like xp/mmr).
ALTER TABLE "User" ADD COLUMN "spawnX" INTEGER;
ALTER TABLE "User" ADD COLUMN "spawnY" INTEGER;
