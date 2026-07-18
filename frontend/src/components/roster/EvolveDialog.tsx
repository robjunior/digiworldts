import type { EvolutionGate } from '../../lib/api-roster';

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
  const message = evolveMessage(gate);
  return (
    <>
      <div className={`evolve-gate ${gate.eligible ? 'ok' : 'warn'}`}>{message}</div>
      {gate.options.map((option) => (
        <button key={option.catalogId} className={`evolve-option ${gate.eligible ? 'is-clickable' : 'is-disabled'}`} type="button" disabled={!gate.eligible || busy} onClick={() => onEvolve(option.catalogId)}>
          <img src={option.portrait} alt={option.name} loading="lazy" />
          <span className="info"><span className="name">{option.name}</span><span className="sub">{option.stage}</span></span>
        </button>
      ))}
    </>
  );
}

function evolveMessage(gate: EvolutionGate): string {
  if (gate.eligible) {
    return `Ready to evolve into ${gate.nextStage ?? 'next stage'}. This will consume 1 ${gate.requiredItemId ?? 'chip'} and reset XP to 0.`;
  }
  switch (gate.reason) {
    case 'level-too-low':
      return `Reach level ${gate.requiredLevel} to evolve into ${gate.nextStage ?? 'next stage'}. Currently Lv ${gate.currentLevel}.`;
    case 'no-chip':
      return `Missing required item: ${gate.requiredItemId ?? 'evolution chip'}. Buy one from the shop.`;
    case 'no-mood':
      return `Raise mood to ${gate.requiredMood} before evolving. Current mood is ${gate.currentMood}.`;
    case 'no-paths':
    case 'stage-cap':
      return 'No evolution paths available for this Digimon.';
    case undefined:
      return 'Not eligible.';
  }
  return 'Not eligible.';
}
