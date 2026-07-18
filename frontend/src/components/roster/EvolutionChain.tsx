import { Fragment } from 'react';

import type { TemplateDigimon } from '@digiworld/shared/digimon';

type EvolutionChainProps = {
  readonly catalogId: string;
  readonly templateById: ReadonlyMap<string, TemplateDigimon>;
  readonly reverseGraph: ReadonlyMap<string, readonly string[]>;
};

const MAX_BACKWARD = 4;
const MAX_FORWARD = 4;

export function EvolutionChain({ catalogId, templateById, reverseGraph }: EvolutionChainProps): JSX.Element | null {
  const chain = buildChain(catalogId, templateById, reverseGraph);
  if (chain.length <= 1) return null;
  return (
    <div className="evo-chain" aria-label="Evolutionary history">
      {chain.map((tpl, index) => (
        <Fragment key={tpl.id}>
          {index > 0 ? <span className="evo-sep" aria-hidden="true" /> : null}
          <span
            className={`evo-node ${tpl.id === catalogId ? 'is-current' : ''}`}
            data-stage={String(tpl.stage).toLowerCase()}
            title={`${tpl.name} · ${tpl.stage}`}
          >
            <img
              src={tpl.assets.dot}
              alt={tpl.name}
              loading="lazy"
              onError={(event) => { event.currentTarget.style.opacity = '0.2'; }}
            />
            <span className="evo-node-label">{tpl.stage}</span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function buildChain(
  currentId: string,
  byId: ReadonlyMap<string, TemplateDigimon>,
  rev: ReadonlyMap<string, readonly string[]>,
): readonly TemplateDigimon[] {
  const current = byId.get(currentId);
  if (!current) return [];
  const seen = new Set<string>([currentId]);

  const backward: TemplateDigimon[] = [];
  let cursor: TemplateDigimon | undefined = current;
  while (cursor && backward.length < MAX_BACKWARD) {
    const parents = (rev.get(cursor.id) ?? []).filter((id) => !seen.has(id));
    if (parents.length === 0) break;
    const parentId = parents.slice().sort()[0]!;
    const parent = byId.get(parentId);
    if (!parent) break;
    seen.add(parent.id);
    backward.unshift(parent);
    cursor = parent;
  }

  const forward: TemplateDigimon[] = [];
  cursor = current;
  while (cursor && forward.length < MAX_FORWARD) {
    const nexts = (cursor.evolvesInto ?? []).filter((id) => !seen.has(id));
    if (nexts.length === 0) break;
    const child = byId.get(nexts[0]!);
    if (!child) break;
    seen.add(child.id);
    forward.push(child);
    cursor = child;
  }

  return [...backward, current, ...forward];
}
