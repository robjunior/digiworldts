/**
 * Starter team guard.
 *
 * The two teams offered at `/intro` are the first balance decision a player
 * meets, and the three they replace were badly lopsided — measured over 400
 * battles each, `aggressive` lost to `balanced` 1% to 100%, because it was
 * three fire Rookies and elemental affinity is a 3x swing against a mono-element
 * team while its chain bonus is only 1.4x.
 *
 * These assertions encode the constraints that came out of designing the
 * replacements by simulation, so a future edit to `DEFAULT_TEAMS` cannot
 * silently reintroduce the same class of defect. They are structural and fast;
 * the head-to-head balance itself is measured separately, since 1000 battles
 * per pairing does not belong in a smoke test.
 *
 * The last section is the one that matters most operationally: it proves that
 * retiring a starter team leaves the rosters of players who already picked it
 * completely untouched.
 *
 * Run: pnpm --filter @digiworld/backend test:starter-teams
 */
import { existsSync, unlinkSync } from 'node:fs';

import { DEFAULT_TEAMS } from '../src/onboarding/engine.ts';
import { loadCatalog } from '../src/digimon/xml.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';

const DB_PATH = process.env.DB_PATH;
if (DB_PATH !== undefined && DB_PATH !== '' && existsSync(DB_PATH)) unlinkSync(DB_PATH);

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS: ${name}${detail ? ` — ${detail}` : ''}`);
    return;
  }
  failed += 1;
  console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
}

const catalog = loadCatalog();
const byId = new Map(catalog.digimons.map((d) => [d.id, d]));

console.log('=== Shape ===');
check('exactly two starter teams are offered', DEFAULT_TEAMS.length === 2, `got ${DEFAULT_TEAMS.length}`);
check('slugs are unique', new Set(DEFAULT_TEAMS.map((t) => t.slug)).size === DEFAULT_TEAMS.length);
check(
  'the retired slugs are gone from the constant',
  !DEFAULT_TEAMS.some((t) => ['aggressive', 'balanced', 'wildcard'].includes(t.slug)),
);

console.log('\n=== Catalog references ===');
for (const team of DEFAULT_TEAMS) {
  check(`${team.slug}: exactly 3 mons`, team.monCatalogIds.length === 3, `got ${team.monCatalogIds.length}`);
  for (const id of team.monCatalogIds) {
    const mon = byId.get(id);
    // completeOnboarding rejects the whole selection with `invalid-catalog-id`
    // if any of these is missing, which would strand a new player on /intro.
    check(`${team.slug}: ${id} exists in the catalog`, mon !== undefined);
    if (mon) check(`${team.slug}: ${mon.name} is a Rookie`, mon.stage === 'Rookie', `stage=${mon.stage}`);
  }
}

console.log('\n=== Balance constraints ===');
for (const team of DEFAULT_TEAMS) {
  const mons = team.monCatalogIds.map((id) => byId.get(id)).filter((m) => m !== undefined);
  const elements = new Set(mons.map((m) => m!.element));
  // A mono-element team eats a 1.5x/0.5x affinity swing from a single opposing
  // element and earns only a 1.4x chain bonus in return. This is what sank the
  // old `aggressive` team.
  check(`${team.slug}: not mono-element`, elements.size > 1, `elements: ${[...elements].join(', ')}`);
}

const attributePatterns = DEFAULT_TEAMS.map((t) =>
  t.monCatalogIds.map((id) => byId.get(id)?.attribute ?? '?').join('/'),
);
// The battle AI focuses the front unit, so slot 0 fights slot 0 and the
// attribute triangle (1.35x / 0.75x, a 1.8x swing) decides most fights. Sharing
// one pattern makes every slot pairing attribute-neutral and leaves elements as
// the only thing separating the two teams.
check(
  'both teams share an attribute pattern slot for slot',
  new Set(attributePatterns).size === 1,
  attributePatterns.join('  vs  '),
);

console.log('\n=== Retiring a team does not touch existing players ===');
{
  const db = await getDb();
  const now = Date.now();
  await db.run(
    `INSERT INTO onboarding_teams (id, slug, name, description, mon_1_catalog_id, mon_2_catalog_id, mon_3_catalog_id, sort_order, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['onb_legacy', 'aggressive', 'Aggressive', 'retired', 'skb-50', 'skb-151', 'skb-90', 0, 1, now, now],
  );
  await db.run(
    `INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at, onboarding_completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['usr_legacy', 'legacy_player', 'Legacy Player', 'x', 0, now, now, now],
  );
  for (const [i, catalogId] of ['skb-50', 'skb-151', 'skb-90'].entries()) {
    await db.run(
      `INSERT INTO player_roster (id, user_id, catalog_id, nickname, status, slot_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [`mon_legacy_${i}`, 'usr_legacy', catalogId, `Legacy${i}`, 'party', i, now, now],
    );
  }

  // Exactly what migration 086 does.
  await db.run(`DELETE FROM onboarding_teams WHERE slug IN ('aggressive', 'balanced', 'wildcard')`);

  const teamGone = await db.one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM onboarding_teams WHERE slug = 'aggressive'`,
  );
  check('the retired team is removed', (teamGone?.n ?? -1) === 0);

  const roster = await db.query<{ catalog_id: string; slot_index: number }>(
    `SELECT catalog_id, slot_index FROM player_roster WHERE user_id = ? ORDER BY slot_index`,
    ['usr_legacy'],
  );
  check('the player keeps all three Digimon', roster.length === 3, `got ${roster.length}`);
  check(
    'their catalog ids are unchanged',
    roster.map((r) => r.catalog_id).join(',') === 'skb-50,skb-151,skb-90',
    roster.map((r) => r.catalog_id).join(','),
  );
  check('their party slots are unchanged', roster.map((r) => r.slot_index).join(',') === '0,1,2');

  const user = await db.one<{ onboarding_completed_at: number | null }>(
    `SELECT onboarding_completed_at FROM users WHERE id = ?`,
    ['usr_legacy'],
  );
  // Still set, so they are never sent back to /intro to pick from the new pair.
  check('they stay marked as onboarded', user?.onboarding_completed_at === now);

  await closeDbAdapter();
}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
