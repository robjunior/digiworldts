// One-shot repair: recompute every dungeon's walkable_mask_json from its
// tiles using the corrected computeWalkableMaskFromTiles (tree/decoration
// overlays no longer poison border cells). Run with:
//   DATABASE_URL=postgres://... pnpm dlx tsx scripts/recompute-walkable-masks.ts
import { recomputeAllWalkableMasks } from '../src/dungeons/repo.ts';

const res = await recomputeAllWalkableMasks();
console.log('recomputed', res.recomputed, 'of', res.dungeons, 'dungeons');
process.exit(0);
