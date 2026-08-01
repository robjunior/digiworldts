import { log } from '../util/log.js';
import { getNpc, saveNpc } from './repo.js';

/**
 * Seed the NPCs referenced by the shipped .twee intros.
 *
 * Idempotent: only inserts NPCs whose id is not yet present. Never overwrites
 * an admin edit — once the DB row exists, this seeder leaves it alone.
 */
const INITIAL_NPCS: readonly {
  readonly id: string;
  readonly displayName: string;
  readonly expressions: readonly { readonly key: string; readonly label?: string }[];
}[] = [
  {
    id: 'elder',
    displayName: 'Elder of the Forest',
    expressions: [
      { key: 'neutral' },
      { key: 'concerned', label: 'Concerned' },
    ],
  },
  {
    id: 'nursery',
    displayName: 'Nursery Keeper',
    expressions: [
      { key: 'neutral' },
      { key: 'happy', label: 'Happy' },
    ],
  },
  {
    id: 'tamer_guild',
    displayName: 'Tamer Guild Officer',
    expressions: [
      { key: 'neutral' },
      { key: 'concerned', label: 'Concerned' },
      { key: 'happy', label: 'Happy' },
    ],
  },
  {
    id: 'the_world',
    displayName: 'The World',
    expressions: [
      { key: 'neutral' },
      { key: 'concerned', label: 'Concerned' },
    ],
  },
  {
    id: 'unknown',
    displayName: 'Unknown Presence',
    expressions: [
      { key: 'neutral' },
    ],
  },
];

export async function seedInitialNpcs(): Promise<{ readonly inserted: number; readonly skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (const npc of INITIAL_NPCS) {
    const existing = await getNpc(npc.id);
    if (existing !== null) { skipped += 1; continue; }
    await saveNpc(npc);
    inserted += 1;
  }
  if (inserted > 0) log.info('npc.seed.ok', { inserted, skipped });
  return { inserted, skipped };
}
