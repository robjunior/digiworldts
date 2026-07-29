import type { BattleOutcome, BattleView } from '@digiworld/shared/battle';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';

import type { ItemDrop, StatSnapshot, XpAward } from '../../lib/api-world';

type PveResults = {
  readonly xpAwards: readonly XpAward[];
  readonly itemDrops?: readonly ItemDrop[];
  readonly creditsGained?: number;
  readonly bitsGained?: number;
};

type EndCardProps = {
  readonly battle: BattleView;
  readonly pveResults?: PveResults | null;
  readonly onClose?: () => void;
};

export function EndCard({ battle, pveResults, onClose }: EndCardProps): JSX.Element | null {
  useEffect(() => {
    if (!onClose) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (battle.status !== 'ended' && battle.outcome === null) {
    return null;
  }
  const outcome = battle.outcome ?? 'abandoned';
  const tone = outcomeTone(outcome, battle.yourSide);
  const mmr = extractPvpMmr(battle);
  const hpLeftPct = averageHpLeftPct(battle);
  const isPve = battle.mode === 'pve';
  const stopPropagation = (event: React.MouseEvent): void => event.stopPropagation();

  const card = (
    <section className={`end-card ${tone}`} data-od-id="end-card">
      {onClose ? (
        <button className="end-card-close" type="button" onClick={onClose} aria-label="Close">×</button>
      ) : null}
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
        {isPve && pveResults?.creditsGained !== undefined && pveResults.creditsGained > 0 ? (
          <div className="r" data-od-id="end-card-pve-credits"><span className="k">Credits</span><span>+{pveResults.creditsGained}</span></div>
        ) : null}
        {isPve && pveResults?.bitsGained !== undefined && pveResults.bitsGained > 0 ? (
          <div className="r" data-od-id="end-card-pve-bits"><span className="k">Bits</span><span>+{pveResults.bitsGained}</span></div>
        ) : null}
        {isPve ? <div className="r"><span className="k">HP left</span><span>{hpLeftPct}%</span></div> : null}
      </div>
      {isPve && pveResults ? <PveRewards results={pveResults} /> : null}
      <div className="cta-row">
        {isPve ? (
          <button type="button" className="btn" onClick={onClose} data-od-id="end-card-return-world">
            Return to World
          </button>
        ) : (
          <Link className="btn btn--secondary" to="/lobby">Back to Menu</Link>
        )}
      </div>
    </section>
  );

  if (!onClose) return card;

  // Portal to document.body — bulletproofs `position: fixed` against any
  // ancestor with `transform`, `filter`, `perspective`, `will-change`, or
  // `contain: layout/paint` (all of which create a new containing block
  // for fixed elements per the CSS spec and would relocate/clip the modal).
  // Chromium is more forgiving here; Firefox enforces the spec strictly,
  // so escaping the subtree makes the modal render identically on both.
  return createPortal(
    <div className="end-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Battle results">
      <div className="end-modal-content" onClick={stopPropagation}>
        {card}
      </div>
    </div>,
    document.body,
  );
}

function PveRewards({ results }: { readonly results: PveResults }): JSX.Element | null {
  const drops: readonly ItemDrop[] = results.itemDrops ?? [];
  const hasLoot = drops.length > 0;
  const hasXp = results.xpAwards.length > 0;
  const [activeIdx, setActiveIdx] = useState(0);
  if (!hasLoot && !hasXp) return null;
  return (
    <div className="pve-results" data-od-id="pve-results">
      {hasLoot ? (
        <div className="pve-block">
          <span className="pve-block-k">Looted</span>
          <div className="pve-loot-list">
            {drops.map((drop, index) => (
              <span key={`${drop.itemId}-${index}`} className="pve-loot-item">
                <span className="pve-loot-dot" aria-hidden="true" />
                <b>{drop.name}</b>
                <span className="pve-loot-qty">× {drop.qty}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {hasXp ? (
        <div className="pve-block">
          <span className="pve-block-k">Party XP</span>
          <div className="pve-xp-list">
            {results.xpAwards.map((award, i) => (
              <PveXpRow
                key={award.monId}
                award={award}
                active={i === activeIdx}
                onDone={() => setActiveIdx((prev) => Math.max(prev, i + 1))}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const STAT_KEYS = ['hp', 'en', 'atk', 'def', 'int', 'spd'] as const;
type StatKey = (typeof STAT_KEYS)[number];

function PveXpRow({ award, active, onDone }: { readonly award: XpAward; readonly active: boolean; readonly onDone: () => void }): JSX.Element {
  const leveledUp = award.gainedLevels > 0;
  const beforeBracket = Math.max(1, award.xpNextBefore - award.xpFloorBefore);
  const afterBracket = Math.max(1, award.xpNext - award.xpFloor);
  const pctBefore = leveledUp
    ? Math.max(0, Math.min(100, ((award.xpBefore - award.xpFloorBefore) / beforeBracket) * 100))
    : Math.max(0, Math.min(100, ((award.xpBefore - award.xpFloor) / afterBracket) * 100));
  const pctAfter = Math.max(0, Math.min(100, ((award.xpAfter - award.xpFloor) / afterBracket) * 100));
  const deltaLabel = award.defeated
    ? `Defeated · ${award.delta} xp`
    : award.delta > 0 ? `+${award.delta} xp` : award.delta < 0 ? `${award.delta} xp` : 'no xp';
  const [done, setDone] = useState(false);
  const startedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    if (!active || startedRef.current) return;
    startedRef.current = true;
    const writePct = (pct: number): void => {
      if (fillRef.current !== null) fillRef.current.style.width = `${pct}%`;
      if (wrapperRef.current !== null) {
        const tremble = Math.max(0, Math.min(1, (pct - 55) / 45));
        wrapperRef.current.style.setProperty('--tremble', String(tremble));
      }
    };
    let cancelled = false;
    const animate = (from: number, to: number, ms: number): Promise<void> =>
      new Promise((resolve) => {
        const start = performance.now();
        const tick = (now: number): void => {
          if (cancelled) { resolve(); return; }
          const t = Math.min(1, (now - start) / ms);
          const eased = 1 - (1 - t) * (1 - t);
          writePct(from + (to - from) * eased);
          if (t < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
    const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

    (async () => {
      if (award.defeated) {
        await animate(pctBefore, pctAfter, 600);
      } else if (leveledUp) {
        await animate(pctBefore, 100, 900);
        if (cancelled) return;
        for (let i = 1; i < award.gainedLevels; i++) {
          writePct(0);
          await delay(120);
          if (cancelled) return;
          await animate(0, 100, 550);
          if (cancelled) return;
        }
        writePct(0);
        await delay(150);
        if (cancelled) return;
        await animate(0, pctAfter, 700);
      } else {
        await animate(pctBefore, pctAfter, 800);
      }
      if (cancelled) return;
      await delay(leveledUp ? 260 : 180);
      if (cancelled) return;
      setDone(true);
      onDoneRef.current();
    })().catch(() => {});

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const showLevelUp = done && leveledUp;
  const displayLevel = showLevelUp ? award.newLevel : award.previousLevel;
  const portraitUrl = `/assets/digimon/${award.catalogId}/dot.gif`;
  const rowClass = ['pve-xp-row', award.defeated ? 'is-defeated' : '', leveledUp ? 'is-levelup' : '', showLevelUp ? 'is-lvlup-open' : ''].filter(Boolean).join(' ');
  return (
    <div className={rowClass} data-od-id={`pve-xp-${award.monId}`}>
      <div className="pve-xp-actor">
        <img className="pve-xp-portrait" src={portraitUrl} alt="" aria-hidden="true" />
        <div className="pve-xp-info">
          <b className="pve-xp-nick">{award.nickname}</b>
          <span className="pve-xp-lvl">Lv <b>{displayLevel}</b></span>
        </div>
      </div>
      {showLevelUp ? (
        <div className="pve-xp-lvlup" role="status">
          <span className="pve-lvlup-badge">LVLUP+</span>
          <div className="pve-lvlup-stats">
            {STAT_KEYS.map((k) => {
              const before = award.statsBefore[k as StatKey];
              const after = award.statsAfter[k as StatKey];
              const gain = after - before;
              const changed = gain !== 0;
              return (
                <div key={k} className={`pve-lvlup-stat ${gain > 0 ? 'is-up' : gain < 0 ? 'is-down' : ''}`}>
                  <span className="pve-lvlup-stat-k">{k.toUpperCase()}</span>
                  <b className="pve-lvlup-stat-new">{after}</b>
                  {changed ? (
                    <span className="pve-lvlup-stat-old" title="previous value">{before}</span>
                  ) : (
                    <span className="pve-lvlup-stat-old pve-lvlup-stat-old--same" aria-hidden="true">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="pve-xp-progress" ref={wrapperRef} style={{ ['--tremble' as string]: 0 }}>
          <div className="pve-xp-bar" title={`${award.xpBefore} → ${award.xpAfter} / ${award.xpNext}`}>
            <div className="pve-xp-fill" ref={fillRef} style={{ width: `${pctBefore}%` }} />
          </div>
          <span className={`pve-xp-delta ${award.defeated ? 'pve-xp-loss' : award.delta > 0 ? 'pve-xp-win' : 'pve-xp-muted'}`}>{deltaLabel}</span>
        </div>
      )}
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
  const isPve = battle.mode === 'pve';
  switch (tone) {
    case 'win':
      if (outcome === 'captured_a') return 'Wild target captured.';
      if (rivalName !== null) return `Cleared ${rivalName}'s team.`;
      return isPve ? 'You won the fight.' : 'You cleared the arena.';
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
