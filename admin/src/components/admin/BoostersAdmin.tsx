import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';

import {
  fetchBooster,
  fetchBoosters,
  fetchCatalogEvolutions,
  BOOSTER_RARITIES,
  BOOSTER_STATUSES,
  type BoosterDetail,
  type BoosterDigimonEntry,
  type BoosterItemEntry,
  type BoosterRarity,
  type BoosterSeed,
  type BoosterStatus,
  type CatalogEvolution,
} from '../../lib/api-boosters';
import { AdminMessage, AdminSection, ErrorText, Field } from './AdminShared';

const BOOSTERS_QUERY_KEY = ['admin', 'boosters'] as const;

// ---------------------------------------------------------------------------
// Validation — mirrors backend/src/boosters/loader.ts semantic rules (§2.4/§6)
// ---------------------------------------------------------------------------
type SeedIssue = { rule: string; message: string };

function validateSeed(seed: BoosterSeed): SeedIssue[] {
  const issues: SeedIssue[] = [];
  const refs = new Set<string>();
  for (const n of seed.digimonPool) {
    if (refs.has(n.ref)) issues.push({ rule: 'ref-unique', message: `duplicate digimon ref "${n.ref}"` });
    refs.add(n.ref);
  }
  for (const n of seed.digimonPool) {
    if (n.parentRef !== null && !refs.has(n.parentRef)) {
      issues.push({ rule: 'parent-ref', message: `node "${n.ref}" has dangling parentRef "${n.parentRef}"` });
    }
  }
  if (seed.digimonPool.length > 0 && !seed.digimonPool.some((n) => n.parentRef === null)) {
    issues.push({ rule: 'root', message: 'digimonPool must have at least one root (parentRef: null)' });
  }
  for (const n of seed.digimonPool) {
    if (wouldCycle(seed.digimonPool, n.ref, n.parentRef)) {
      issues.push({ rule: 'cycle', message: `node "${n.ref}" would create a cycle via "${n.parentRef}"` });
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(seed.code)) {
    issues.push({ rule: 'schema', message: `code "${seed.code}" must match [A-Za-z0-9_-]+` });
  }
  for (const n of [...seed.digimonPool, ...seed.itemPool.map((i) => ({ ...i, parentRef: null, digimonId: i.itemId }))]) {
    if (n.weight <= 0) issues.push({ rule: 'schema', message: `"${n.ref}" weight must be > 0` });
  }
  return issues;
}

function wouldCycle(nodes: BoosterDigimonEntry[], from: string, to: string | null): boolean {
  let current = to;
  while (current !== null) {
    if (current === from) return true;
    current = nodes.find((n) => n.ref === current)?.parentRef ?? null;
  }
  return false;
}

function slugFrom(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function BoostersAdmin(): JSX.Element {
  const listQuery = useQuery({ queryKey: BOOSTERS_QUERY_KEY, queryFn: fetchBoosters, staleTime: 30_000 });
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<BoosterSeed | null>(null);

  const issues = useMemo(() => (draft ? validateSeed(draft) : []), [draft]);

  return (
    <AdminSection
      title="Boosters"
      lede="Manual editorial curation (seed files, not DB). The booster's parent→child tree is authored by hand — it never derives from the global evolution graph. Save exports a .booster.json you commit + PR; the deploy loader populates the cache."
    >
      <ErrorText error={listQuery.error instanceof Error ? listQuery.error : null} />
      {listQuery.isPending ? <AdminMessage tone="muted">Loading boosters…</AdminMessage> : null}
      <div className="admin-row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <select
          className="input"
          value={selectedCode ?? ''}
          onChange={async (e) => {
            const code = e.target.value;
            setSelectedCode(code);
            if (!code) {
              setDraft(newDraft());
              return;
            }
            try {
              const detail = await fetchBooster(code);
              setDraft(fromDetail(detail));
            } catch {
              setDraft(null);
            }
          }}
        >
          <option value="">— new booster —</option>
          {listQuery.data?.map((b) => (
            <option key={b.code} value={b.code}>
              {b.code} · {b.name} ({b.status})
            </option>
          ))}
        </select>
        <button className="button" type="button" onClick={() => { setSelectedCode(null); setDraft(newDraft()); }}>
          New
        </button>
      </div>

      {draft ? (
        <BoosterEditor seed={draft} onChange={setDraft} issues={issues} />
      ) : (
        <AdminMessage tone="muted">Select a booster to edit, or start a new one.</AdminMessage>
      )}
    </AdminSection>
  );
}

function newDraft(): BoosterSeed {
  return {
    $schema: './booster.schema.json',
    code: '',
    name: '',
    set: '',
    releaseDate: new Date().toISOString().slice(0, 10),
    status: 'draft',
    tags: [],
    digimonPool: [],
    itemPool: [],
  };
}

function fromDetail(detail: BoosterDetail): BoosterSeed {
  const b = detail.booster;
  return {
    $schema: './booster.schema.json',
    code: b.code,
    name: b.name,
    set: b.set,
    releaseDate: b.releaseDate,
    ...(b.description ? { description: b.description } : {}),
    status: b.status,
    tags: b.tags,
    digimonPool: detail.digimonPool.map((n) => ({
      ref: n.ref,
      digimonId: n.digimon_id,
      parentRef: n.parent_node_id ? n.parent_node_id.split(':').slice(1).join(':') : null,
      rarity: n.rarity as BoosterRarity,
      weight: n.weight,
      order: n.order,
    })),
    itemPool: detail.itemPool.map((i) => ({
      ref: i.ref,
      itemId: i.item_id,
      rarity: i.rarity as BoosterRarity,
      weight: i.weight,
      order: i.order,
    })),
  };
}

function BoosterEditor({ seed, onChange, issues }: {
  readonly seed: BoosterSeed;
  readonly onChange: (s: BoosterSeed) => void;
  readonly issues: SeedIssue[];
}): JSX.Element {
  const set = (patch: Partial<BoosterSeed>) => onChange({ ...seed, ...patch });

  return (
    <div className="booster-editor">
      <div className="booster-panels">
        <MetadataPanel seed={seed} set={set} />
        <DigimonPoolPanel seed={seed} set={set} />
        <ItemPoolPanel seed={seed} set={set} />
      </div>

      <div className="booster-footer">
        <div className="booster-issues">
          {issues.length === 0 ? (
            <AdminMessage tone="success">Valid — ready to export.</AdminMessage>
          ) : (
            <ul className="booster-issue-list">
              {issues.map((i, idx) => (
                <li key={idx}>{i.rule}: {i.message}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="booster-actions">
          <button className="button" type="button" onClick={() => exportSeed(seed)} disabled={issues.length > 0}>
            Export .booster.json
          </button>
        </div>
      </div>

      <details className="booster-preview">
        <summary>JSON preview</summary>
        <pre className="code-block">{JSON.stringify(seed, null, 2)}</pre>
      </details>
    </div>
  );
}

function exportSeed(seed: BoosterSeed): void {
  const code = seed.code || 'booster';
  const blob = new Blob([JSON.stringify(seed, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${code}-${slugFrom(seed.name) || 'booster'}.booster.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function MetadataPanel({ seed, set }: { readonly seed: BoosterSeed; readonly set: (p: Partial<BoosterSeed>) => void }): JSX.Element {
  return (
    <div className="booster-panel">
      <h3>Metadata</h3>
      <Field label="Code"><input className="input" value={seed.code} onChange={(e) => set({ code: e.target.value })} /></Field>
      <Field label="Name"><input className="input" value={seed.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Set"><input className="input" value={seed.set} onChange={(e) => set({ set: e.target.value })} /></Field>
      <Field label="Release date"><input className="input" type="date" value={seed.releaseDate} onChange={(e) => set({ releaseDate: e.target.value })} /></Field>
      <Field label="Description"><textarea className="input" value={seed.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Field>
      <Field label="Status">
        <select className="input" value={seed.status} onChange={(e) => set({ status: e.target.value as BoosterStatus })}>
          {BOOSTER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Tags (comma-separated)">
        <input className="input" value={(seed.tags ?? []).join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
      </Field>
    </div>
  );
}

function DigimonPoolPanel({ seed, set }: { readonly seed: BoosterSeed; readonly set: (p: Partial<BoosterSeed>) => void }): JSX.Element {
  const updateNode = (ref: string, patch: Partial<BoosterDigimonEntry>) => {
    set({ digimonPool: seed.digimonPool.map((n) => (n.ref === ref ? { ...n, ...patch } : n)) });
  };
  const addRoot = () => {
    const ref = slugFrom(`mon${seed.digimonPool.length + 1}`);
    set({ digimonPool: [...seed.digimonPool, { ref, digimonId: '', parentRef: null, rarity: 'common', weight: 1, order: seed.digimonPool.length }] });
  };
  const addChild = (parentRef: string) => {
    const ref = slugFrom(`child${seed.digimonPool.length + 1}`);
    set({ digimonPool: [...seed.digimonPool, { ref, digimonId: '', parentRef, rarity: 'uncommon', weight: 1, order: 0 }] });
  };
  const removeNode = (ref: string) => {
    // cascade: drop the node and all descendants
    const doomed = new Set<string>();
    const collect = (r: string) => {
      if (doomed.has(r)) return;
      doomed.add(r);
      seed.digimonPool.filter((n) => n.parentRef === r).forEach((c) => collect(c.ref));
    };
    collect(ref);
    const kept = seed.digimonPool.filter((n) => !doomed.has(n.ref));
    set({ digimonPool: renumber(kept) });
  };

  const visit = (parentRef: string | null, depth: number): ReactNode =>
    seed.digimonPool
      .filter((n) => n.parentRef === parentRef)
      .map((n) => (
        <div key={n.ref} className={`booster-node booster-node-depth-${Math.min(depth, 4)}`}>
          <div className="booster-node-row">
            <Badge label="ref" value={n.ref} />
            <label>
              digimonId
              <input className="input" value={n.digimonId} onChange={(e) => updateNode(n.ref, { digimonId: e.target.value })} />
            </label>
            <select className="input" value={n.rarity} onChange={(e) => updateNode(n.ref, { rarity: e.target.value as BoosterRarity })}>
              {BOOSTER_RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input className="input" type="number" min={1} value={String(n.weight)} onChange={(e) => updateNode(n.ref, { weight: Number(e.target.value) })} title="weight" />
            <button className="button button-small" type="button" onClick={() => addChild(n.ref)}>+ child</button>
            <button className="button button-small button-danger" type="button" onClick={() => removeNode(n.ref)}>remove</button>
          </div>
          <EvoSuggest
            digimonId={n.digimonId}
            onUse={(target) => {
              // The graph is a SUGGESTION only — filling digimonId never
              // forces the booster's parent→child to match the global graph.
              updateNode(n.ref, { digimonId: target.targetId });
            }}
          />
          {visit(n.ref, depth + 1)}
        </div>
      ));

  return (
    <div className="booster-panel">
      <h3>Digimon Pool</h3>
      <button className="button button-small" type="button" onClick={addRoot}>+ Add Root Digimon</button>
      {visit(null, 0)}
      {seed.digimonPool.length === 0 ? <AdminMessage tone="muted">No digimon yet.</AdminMessage> : null}
    </div>
  );
}

function EvoSuggest({ digimonId, onUse }: {
  readonly digimonId: string;
  readonly onUse: (t: CatalogEvolution) => void;
}): JSX.Element | null {
  const evoQuery = useQuery({
    queryKey: ['catalog', 'evolutions', digimonId],
    queryFn: () => fetchCatalogEvolutions(digimonId),
    enabled: Boolean(digimonId),
    staleTime: 60_000,
  });
  const evolutions = evoQuery.data?.evolutions ?? [];
  if (!digimonId || evolutions.length === 0) return null;
  return (
    <div className="booster-evo-suggest">
      <span>Sugestões do grafo ({digimonId}):</span>
      {evolutions.slice(0, 4).map((e) => (
        <button key={e.targetId} className="button button-small" type="button" onClick={() => onUse(e)}>
          {e.name} <span className="muted">({e.targetId})</span>
        </button>
      ))}
    </div>
  );
}

function ItemPoolPanel({ seed, set }: { readonly seed: BoosterSeed; readonly set: (p: Partial<BoosterSeed>) => void }): JSX.Element {
  const update = (idx: number, patch: Partial<BoosterItemEntry>) => {
    const items = seed.itemPool.map((i, k) => (k === idx ? { ...i, ...patch } : i));
    set({ itemPool: items });
  };
  const add = () => {
    set({ itemPool: [...seed.itemPool, { ref: slugFrom(`item${seed.itemPool.length + 1}`), itemId: '', rarity: 'common', weight: 1, order: seed.itemPool.length }] });
  };
  return (
    <div className="booster-panel">
      <h3>Item Pool</h3>
      <button className="button button-small" type="button" onClick={add}>+ Add Item</button>
      {seed.itemPool.map((i, idx) => (
        <div key={i.ref} className="booster-node-row">
          <Badge label="ref" value={i.ref} />
          <label>
            itemId
            <input className="input" value={i.itemId} onChange={(e) => update(idx, { itemId: e.target.value })} />
          </label>
          <select className="input" value={i.rarity} onChange={(e) => update(idx, { rarity: e.target.value as BoosterRarity })}>
            {BOOSTER_RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input className="input" type="number" min={1} value={String(i.weight)} onChange={(e) => update(idx, { weight: Number(e.target.value) })} title="weight" />
          <button className="button button-small button-danger" type="button" onClick={() => set({ itemPool: seed.itemPool.filter((_, k) => k !== idx) })}>remove</button>
        </div>
      ))}
      {seed.itemPool.length === 0 ? <AdminMessage tone="muted">No items yet.</AdminMessage> : null}
    </div>
  );
}

function renumber(nodes: BoosterDigimonEntry[]): BoosterDigimonEntry[] {
  // Keep parentRef references; recompute order for roots only.
  return nodes.map((n, i) => ({ ...n, order: n.parentRef === null ? i : n.order }));
}

function Badge({ label, value }: { readonly label: string; readonly value: string }): JSX.Element {
  return (
    <span className="booster-badge" title={label}>{value || '—'}</span>
  );
}