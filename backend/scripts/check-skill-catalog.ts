import { q } from '../db/index.js';

async function main() {
  console.log('=== skills por elemento ===');
  const elementRows = await q('SELECT element, COUNT(*) as cnt FROM skills_catalog GROUP BY element ORDER BY element');
  for (const r of elementRows) console.log(`${r.element} -> ${r.cnt}`);

  const total = await q('SELECT COUNT(*) as cnt FROM skills_catalog');
  console.log(`TOTAL: ${total[0].cnt}`);

  const sigCount = await q('SELECT COUNT(*) as cnt FROM skills_catalog WHERE signature = 1');
  console.log(`SIGNATURES: ${sigCount[0].cnt}`);

  console.log('\n=== signatures (skill exclusiva por digimon) ===');
  const signatures = await q(
    `SELECT id, name, element, owner_template_id, signature, slot_role, stage
     FROM skills_catalog
     WHERE signature = 1
     ORDER BY owner_template_id, stage, slot_role`
  );
  for (const s of signatures) {
    console.log(`${s.owner_template_id} | ${s.id} | ${s.name} | ${s.element} | stage=${s.stage} | role=${s.slot_role}`);
  }

  console.log('\n=== skills sem owner_template_id (genéricas) — amostra ===');
  const generic = await q(
    `SELECT id, name, element, stage, slot_role
     FROM skills_catalog
     WHERE signature = 0 AND owner_template_id IS NULL
     ORDER BY element, stage, slot_role
     LIMIT 12`
  );
  for (const g of generic) {
    console.log(`${g.id} | ${g.name} | ${g.element} | stage=${g.stage} | role=${g.slot_role}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
