import { useEffect } from 'react';

import type { DigdexEntry } from '../../lib/api-digdex';

const STAT_ORDER = [
  { key: 'hp',  label: 'HP' },
  { key: 'atk', label: 'ATK' },
  { key: 'def', label: 'DEF' },
  { key: 'en',  label: 'EN' },
  { key: 'int', label: 'INT' },
  { key: 'spd', label: 'SPD' },
] as const;

export type DigdexDetailModalProps = {
  readonly entry: DigdexEntry;
  readonly entriesById: ReadonlyMap<string, DigdexEntry>;
  readonly onClose: () => void;
  readonly onSelect: (entry: DigdexEntry) => void;
};

export function DigdexDetailModal({ entry, entriesById, onClose, onSelect }: DigdexDetailModalProps): JSX.Element | null {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!entry.met || !entry.template) return null;
  const template = entry.template;

  const previousForms: DigdexEntry[] = [];
  for (const other of entriesById.values()) {
    if (!other.template) continue;
    if (other.template.evolvesInto?.some((edge) => edge.targetId === template.id)) previousForms.push(other);
  }
  const nextForms: DigdexEntry[] = (template.evolvesInto ?? [])
    .map((edge) => entriesById.get(edge.targetId))
    .filter((e): e is DigdexEntry => e !== undefined);

  const stopPropagation = (event: React.MouseEvent): void => event.stopPropagation();

  return (
    <div className="digdex-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="digdex-modal-title">
      <div className="digdex-modal" style={{ position: 'relative' }} onClick={stopPropagation}>
        <button className="digdex-modal-close" type="button" onClick={onClose} aria-label="Close">×</button>

        <div className="digdex-modal-head">
          <img className="digdex-modal-portrait" src={template.assets.portrait} alt={template.name} />
          <div className="digdex-modal-title">
            <h2 id="digdex-modal-title">{template.name}</h2>
            <div className="digdex-modal-tags">
              <span className="digdex-tag">{template.stage}</span>
              <span className="digdex-tag">{template.attribute}</span>
              <span className={`digdex-tag digdex-tag-${template.element}`}>{template.element}</span>
              <span className="digdex-tag" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>{template.id}</span>
            </div>
          </div>
        </div>

        <div className="digdex-section">
          <h3>Base stats</h3>
          <div className="digdex-stats">
            {STAT_ORDER.map(({ key, label }) => (
              <div className="digdex-stat" key={key}>
                <span className="digdex-stat-label">{label}</span>
                <span className="digdex-stat-value">{template.baseStats[key]}</span>
              </div>
            ))}
          </div>
        </div>

        {template.skillPool.length > 0 ? (
          <div className="digdex-section">
            <h3>Skill pool</h3>
            {template.skillPool.map((skill) => (
              <div className="digdex-skill" key={skill.id}>
                <div className="digdex-skill-head">
                  <span className="digdex-skill-name">{skill.name}</span>
                  <span className={`digdex-tag digdex-tag-${skill.element}`} style={{ fontSize: 9 }}>{skill.element}</span>
                  <span className="digdex-skill-meta">EN {skill.energyCost} · PWR {skill.power}</span>
                </div>
                {skill.description ? <div className="digdex-skill-desc">{skill.description}</div> : null}
              </div>
            ))}
          </div>
        ) : null}

        {previousForms.length > 0 ? (
          <div className="digdex-section">
            <h3>Evolves from</h3>
            <div className="digdex-evo-chain">
              {previousForms.map((prev, index) => (
                <EvolutionItem key={prev.catalogId} entry={prev} onSelect={onSelect} showArrowAfter={index < previousForms.length - 1} />
              ))}
              <span className="digdex-evo-arrow" aria-hidden>→</span>
              <span className="digdex-evo-arrow" aria-hidden style={{ fontWeight: 900, color: '#7dd3fc' }}>{template.name}</span>
            </div>
          </div>
        ) : null}

        {nextForms.length > 0 ? (
          <div className="digdex-section">
            <h3>Evolves into</h3>
            <div className="digdex-evo-chain">
              <span className="digdex-evo-arrow" aria-hidden style={{ fontWeight: 900, color: '#7dd3fc' }}>{template.name}</span>
              <span className="digdex-evo-arrow" aria-hidden>→</span>
              {nextForms.map((next, index) => (
                <EvolutionItem key={next.catalogId} entry={next} onSelect={onSelect} showArrowAfter={index < nextForms.length - 1} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EvolutionItem({ entry, onSelect, showArrowAfter }: { readonly entry: DigdexEntry; readonly onSelect: (entry: DigdexEntry) => void; readonly showArrowAfter: boolean }): JSX.Element {
  const clickable = entry.met;
  const onClick = (): void => { if (clickable) onSelect(entry); };
  return (
    <>
      <div
        className={`digdex-evo-item${clickable ? ' is-clickable' : ' is-unmet'}`}
        onClick={onClick}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : -1}
        onKeyDown={(event) => { if (clickable && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick(); } }}
      >
        {entry.met && entry.template ? (
          <>
            <img className="digdex-evo-portrait" src={entry.template.assets.portrait} alt={entry.template.name} loading="lazy" />
            <span className="digdex-evo-name">{entry.template.name}</span>
          </>
        ) : (
          <>
            <span className="digdex-evo-unknown">?</span>
            <span className="digdex-evo-name" style={{ color: 'var(--muted, #8892a0)' }}>Unknown</span>
          </>
        )}
      </div>
      {showArrowAfter ? <span className="digdex-evo-arrow" aria-hidden>·</span> : null}
    </>
  );
}
