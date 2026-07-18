import type { BattleOutcome, BattleView } from '@digiworld/shared/battle';
import { Link } from 'react-router';

import type { ItemDrop, XpAward } from '../../lib/api-world';

type PveResults = {
  readonly xpAwards: readonly XpAward[];
  readonly itemDrop?: ItemDrop;
};

type EndCardProps = {
  readonly battle: BattleView;
  readonly onNewEncounter: () => void;
  readonly pveResults?: PveResults | null;
};

export function EndCard({ battle, onNewEncounter, pveResults }: EndCardProps): JSX.Element | null {
  if (battle.status !== 'ended' && battle.outcome === null) {
    return null;
  }
  const outcome = battle.outcome ?? 'abandoned';
  const tone = outcomeTone(outcome, battle.yourSide);
  const mmr = extractPvpMmr(battle);
  const hpLeftPct = averageHpLeftPct(battle);
  const isPve = battle.mode === 'pve';
  return (
    <section className={`end-card ${tone}`} data-od-id="end-card">
      <span className="outcome-pill">{outcomeLabel(outcome, battle.yourSide)}</span>
      <h2 className="headline">{headline(outcome, battle.yourSide, battle)}</h2>
      <div className="rewards">
        <div className="r"><span className="k">Rounds</span><span>{battle.round}</span></div>
        {isPve ? null : (
          <>
            <div className="r"><span className="k">Credits</span><span>+{creditsFor(tone)}</span></div>
            <div className="r"><span className="k">HP left</span><span>{hpLeftPct}%</span></div>
          </>
        )}
        {battle.mode === 'pvp' && mmr !== null ? (
          <div className="r" data-od-id="end-card-mmr">
            <span className="k">MMR</span>
            <span>
              <span className="mmr-before">{mmr.before}</span>
              <span className="mmr-arrow"> → </span>
              <b className={`mmr-after mmr-${tone}`}>{mmr.after}</b>
              <span className={`mmr-delta mmr-${tone}`}> ({mmr.delta >= 0 ? '+' : ''}{mmr.delta})</span>
            </span>
          </div>
        ) : null}
        {isPve ? <div className="r"><span className="k">HP left</span><span>{hpLeftPct}%</span></div> : null}
      </div>
      {isPve && pveResults ? <PveRewards results={pveResults} /> : null}
      <div className="cta-row">
        <button className="btn" type="button" onClick={onNewEncounter} data-od-id="btn-new-encounter">New Encounter</button>
        <Link className="btn btn--secondary" to="/lobby">Back to Menu</Link>
      </div>
    </section>
  );
}

function PveRewards({ results }: { readonly results: PveResults }): JSX.Element | null {
  const hasLoot = results.itemDrop !== undefined;
  const hasXp = results.xpAwards.length > 0;
  if (!hasLoot && !hasXp) return null;
  return (
    <div className="pve-results" data-od-id="pve-results">
      {hasLoot ? (
        <div className="pve-block">
          <span className="pve-block-k">Looted</span>
          <span className="pve-loot-item">
            <span className="pve-loot-dot" aria-hidden="true" />
            <b>{results.itemDrop!.name}</b>
            <span className="pve-loot-qty">× {results.itemDrop!.qty}</span>
          </span>
        </div>
      ) : null}
      {hasXp ? (
        <div className="pve-block">
          <span className="pve-block-k">Party XP</span>
          <div className="pve-xp-list">
            {results.xpAwards.map((award) => <PveXpRow key={award.monId} award={award} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PveXpRow({ award }: { readonly award: XpAward }): JSX.Element {
  const bracket = Math.max(1, award.xpNext - award.xpFloor);
  const pctAfter = Math.max(0, Math.min(100, ((award.xpAfter - award.xpFloor) / bracket) * 100));
  const pctBefore = Math.max(0, Math.min(100, ((award.xpBefore - award.xpFloor) / bracket) * 100));
  const leveledUp = award.gainedLevels > 0;
  const deltaTone = award.defeated ? 'loss' : award.delta > 0 ? 'win' : 'muted';
  const deltaLabel = award.defeated
    ? `Defeated · ${award.delta} xp`
    : award.delta > 0 ? `+${award.delta} xp` : award.delta < 0 ? `${award.delta} xp` : 'no xp';
  const rowClass = ['pve-xp-row', award.defeated ? 'is-defeated' : '', leveledUp ? 'is-levelup' : ''].filter(Boolean).join(' ');
  return (
    <div className={rowClass} data-od-id={`pve-xp-${award.monId}`}>
      <span className="pve-xp-mon">
        <b className="pve-xp-nick">{award.nickname}</b>
        <span className="pve-xp-lvl">
          {leveledUp ? (
            <>Lv <span className="prev">{award.previousLevel}</span> <span className="arrow">→</span> <b>{award.newLevel}</b></>
          ) : (
            <>Lv <b>{award.newLevel}</b></>
          )}
        </span>
      </span>
      <span className="pve-xp-bar" title={`${award.xpBefore} → ${award.xpAfter} / ${award.xpNext - award.xpFloor + award.xpFloor}`}>
        <span className="pve-xp-fill pve-xp-fill--before" style={{ width: `${pctBefore}%` }} />
        <span className="pve-xp-fill pve-xp-fill--after" style={{ width: `${pctAfter}%` }} />
      </span>
      <span className={`pve-xp-delta pve-xp-${deltaTone}`}>{deltaLabel}</span>
    </div>
  );
}

type OutcomeTone = 'win' | 'loss' | 'draw';

function outcomeTone(outcome: BattleOutcome, yourSide: 'a' | 'b'): OutcomeTone {
  switch (outcome) {
    case 'win_a':
    case 'captured_a':
      return yourSide === 'a' ? 'win' : 'loss';
    case 'win_b':
      return yourSide === 'b' ? 'win' : 'loss';
    case 'fled_a':
      return yourSide === 'a' ? 'loss' : 'win';
    case 'fled_b':
      return yourSide === 'b' ? 'loss' : 'win';
    case 'draw':
    case 'abandoned':
      return 'draw';
    default:
      outcome satisfies never;
      return 'draw';
  }
}

function outcomeLabel(outcome: BattleOutcome, yourSide: 'a' | 'b'): string {
  const tone = outcomeTone(outcome, yourSide);
  switch (tone) {
    case 'win': return outcome === 'captured_a' ? 'Captured' : 'Victory';
    case 'loss': return 'Defeat';
    case 'draw': return 'Draw';
    default:
      tone satisfies never;
      return 'Battle ended';
  }
}

function headline(outcome: BattleOutcome, yourSide: 'a' | 'b', battle: BattleView): string {
  const tone = outcomeTone(outcome, yourSide);
  const opponent = battle.opponentDisplayName;
  const rivalName = battle.mode === 'pvp' && opponent !== undefined && opponent.length > 0 ? opponent : null;
  switch (tone) {
    case 'win':
      if (outcome === 'captured_a') return 'Wild target captured.';
      if (rivalName !== null) return `Cleared ${rivalName}'s team.`;
      return 'You cleared the arena.';
    case 'loss':
      if (rivalName !== null) return `Defeated by ${rivalName}.`;
      return 'Your team was cleared.';
    case 'draw': return 'A hard-fought draw.';
    default:
      tone satisfies never;
      return 'Battle resolved.';
  }
}

function creditsFor(tone: OutcomeTone): number {
  switch (tone) {
    case 'win': return 60;
    case 'draw': return 25;
    case 'loss': return 15;
    default:
      tone satisfies never;
      return 0;
  }
}

function extractPvpMmr(battle: BattleView): { before: number; after: number; delta: number } | null {
  for (let i = battle.log.length - 1; i >= 0; i--) {
    const event = battle.log[i];
    if (event !== undefined && event.type === 'end' && event.pvpMmr !== undefined) {
      return event.pvpMmr;
    }
  }
  return null;
}

function averageHpLeftPct(battle: BattleView): number {
  if (battle.friendly.length === 0) return 0;
  let sum = 0;
  for (const unit of battle.friendly) {
    sum += unit.hpMax > 0 ? unit.hp / unit.hpMax : 0;
  }
  return Math.round((sum / battle.friendly.length) * 100);
}
