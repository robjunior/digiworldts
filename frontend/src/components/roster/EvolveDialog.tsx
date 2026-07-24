import type { EvolutionGate, EvolutionOption, EvolutionReason } from '../../lib/api-roster';

export function EvolveDialog({ gate, monName, busy, onClose, onEvolve }: { readonly gate: EvolutionGate | null; readonly monName: string | null; readonly busy: boolean; readonly onClose: () => void; readonly onEvolve: (targetCatalogId: string) => void }): JSX.Element {
  const open = monName !== null;
  return (
    <div className={`modal-overlay ${open ? 'show' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card">
        <div className="modal-header">
          <h3>{gate ? `Evolve — ${gate.currentStage} Lv ${gate.currentLevel}` : `Evolve ${monName ?? ''}`}</h3>
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {gate === null ? <div className="evolve-gate warn">Loading…</div> : <EvolveBody gate={gate} busy={busy} onEvolve={onEvolve} />}
      </div>
    </div>
  );
}

function EvolveBody({ gate, busy, onEvolve }: { readonly gate: EvolutionGate; readonly busy: boolean; readonly onEvolve: (targetCatalogId: string) => void }): JSX.Element {
  if (gate.reason === 'stage-cap' || gate.reason === 'no-paths' || gate.options.length === 0) {
    return <div className="evolve-gate warn">No evolution paths available for this Digimon.</div>;
  }
  const anyEligible = gate.options.some((o) => o.eligible);
  return (
    <>
      <div className={`evolve-gate ${anyEligible ? 'ok' : 'warn'}`}>
        {anyEligible ? `Pick a path — ${gate.options.filter((o) => o.eligible).length} of ${gate.options.length} available.` : 'No path currently eligible. See per-path requirements below.'}
      </div>
      {gate.options.map((option) => (
        <EvolveOptionCard
          key={option.catalogId}
          option={option}
          gate={gate}
          busy={busy}
          onEvolve={onEvolve}
        />
      ))}
    </>
  );
}

function EvolveOptionCard({ option, gate, busy, onEvolve }: {
  readonly option: EvolutionOption;
  readonly gate: EvolutionGate;
  readonly busy: boolean;
  readonly onEvolve: (targetCatalogId: string) => void;
}): JSX.Element {
  const detail = optionMessage(option, gate);
  return (
    <button
      className={`evolve-option ${option.eligible ? 'is-clickable' : 'is-disabled'}`}
      type="button"
      disabled={!option.eligible || busy}
      onClick={() => onEvolve(option.catalogId)}
    >
      <img src={option.portrait} alt={option.name} loading="lazy" />
      <span className="info">
        <span className="name">{option.name}</span>
        <span className="sub">{option.stage}</span>
        <span className={`sub ${option.eligible ? 'evolve-option-ok' : 'evolve-option-warn'}`}>{detail}</span>
      </span>
    </button>
  );
}

function optionMessage(option: EvolutionOption, gate: EvolutionGate): string {
  if (option.eligible) {
    return 'Ready';
  }
  return reasonDetail(option.reason, option, gate);
}

function reasonDetail(reason: EvolutionReason | undefined, option: EvolutionOption, gate: EvolutionGate): string {
  switch (reason) {
    case 'level-too-low':
      return `Needs Lv ${option.requiredLevel} (currently ${gate.currentLevel})`;
    case 'no-mood':
      return `Needs mood ${option.requiredMood} (currently ${gate.currentMood})`;
    case 'attribute-mismatch':
      return `Requires ${option.requiredAttribute ?? '?'} attribute`;
    case 'no-paths':
    case 'stage-cap':
      return 'No path';
    case undefined:
      return 'Not eligible';
  }
  return 'Not eligible';
}
