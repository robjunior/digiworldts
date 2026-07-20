import type { Element, TemplateDigimon } from '@digiworld/shared/digimon';
import type { CSSProperties } from 'react';

import type { RosterView } from '../../lib/api';

const PARTY_SLOTS = [0, 1, 2] as const;
const FULL_METER_STYLE: MeterStyle = { '--pct': '100%' };

export type PartyHeroProps = {
  readonly roster: readonly RosterView[];
};

type PartyMember = RosterView & {
  readonly template: TemplateDigimon;
};

type ElementStyle = CSSProperties & {
  readonly '--el': string;
};

type MeterStyle = CSSProperties & {
  readonly '--pct': string;
};

export function PartyHero({ roster }: PartyHeroProps): JSX.Element {
  const party = PARTY_SLOTS.map((slot) => roster.find((mon) => mon.status === 'party' && mon.slot === slot) ?? null);
  return (
    <div className="party-hero" role="list" aria-label="Active party">
      {party.map((mon, index) => (isPartyMember(mon) ? <FilledSlot key={mon.id} mon={mon} /> : <EmptySlot key={index} slot={index} />))}
    </div>
  );
}

function FilledSlot({ mon }: { readonly mon: PartyMember }): JSX.Element {
  const stats = mon.template.baseStats;
  const hpMax = stats.hp + mon.statBonus.hp;
  const enMax = stats.en + mon.statBonus.en;
  return (
    <a
      className="party-slot"
      role="listitem"
      href="/roster"
      style={elementStyle(mon.template.element)}
      aria-label={`${displayName(mon)}, Level ${mon.level} ${mon.template.stage}, HP ${hpMax} of ${hpMax}, EN ${enMax} of ${enMax}`}
    >
      <span className="ph-rail" aria-hidden="true" />
      <div className="ph-head">
        <span className="name">{displayName(mon)}</span>
        <span className="lvl">
          Lv <b>{mon.level}</b>
        </span>
      </div>
      <div className="ph-art">
        {mon.template.assets.portrait.length > 0 ? (
          <img className="ph-portrait" src={mon.template.assets.portrait} alt={mon.template.name} loading="lazy" />
        ) : (
          <ElementGlyph element={mon.template.element} />
        )}
      </div>
      <div className="ph-body">
        <div className="ph-sub">
          <span className="el-dot" aria-hidden="true" />
          {mon.template.element} · {mon.template.stage}
        </div>
        <div className="ph-stat ph-stat--hp">
          <span className="k">HP</span>
          <div className="meter meter--hp" role="progressbar" aria-valuenow={hpMax} aria-valuemin={0} aria-valuemax={hpMax}>
            <i style={FULL_METER_STYLE} />
          </div>
          <span className="v">
            {hpMax}/{hpMax}
          </span>
        </div>
        <div className="ph-stat ph-stat--en">
          <span className="k">EN</span>
          <div className="meter meter--en" role="progressbar" aria-valuenow={enMax} aria-valuemin={0} aria-valuemax={enMax}>
            <i style={FULL_METER_STYLE} />
          </div>
          <span className="v">
            {enMax}/{enMax}
          </span>
        </div>
      </div>
    </a>
  );
}

function EmptySlot({ slot }: { readonly slot: number }): JSX.Element {
  return (
    <a className="party-slot is-empty" role="listitem" href="/roster" aria-label={`Slot ${slot + 1} empty — click to assign a Digimon`}>
      <span className="ph-rail" aria-hidden="true" />
      <div className="ph-empty">
        <span className="g" aria-hidden="true">
          +
        </span>
        <div className="txt">
          <b>Slot {slot + 1}</b>
          <br />
          tap to assign
        </div>
      </div>
    </a>
  );
}

function ElementGlyph({ element }: { readonly element: Element }): JSX.Element {
  switch (element) {
    case 'fire':
      return (
        <span className="glyph" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none"><path d="M34 6c10 11 2 17 12 27 5 5 7 12 3 18-5 9-20 11-30 2-8-8-7-21 2-29 0 8 4 11 8 12-2-11 8-16 5-30Z" stroke="currentColor" strokeWidth="4" /></svg>
        </span>
      );
    case 'water':
      return (
        <span className="glyph" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none"><path d="M32 6C20 20 14 31 14 42c0 10 8 17 18 17s18-7 18-17C50 31 44 20 32 6Z" stroke="currentColor" strokeWidth="4" /></svg>
        </span>
      );
    case 'plant':
      return (
        <span className="glyph" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none"><path d="M11 38C12 18 27 8 53 9c0 25-11 41-32 43 7-18 17-26 32-43" stroke="currentColor" strokeWidth="4" /></svg>
        </span>
      );
    case 'electricity':
      return (
        <span className="glyph" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none"><path d="M38 4 15 35h17l-6 25 23-33H32l6-23Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" /></svg>
        </span>
      );
    case 'null':
      return (
        <span className="glyph" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none"><path d="M32 8 54 20v24L32 56 10 44V20L32 8Z" stroke="currentColor" strokeWidth="4" /><path d="M10 20 32 32l22-12M32 32v24" stroke="currentColor" strokeWidth="4" /></svg>
        </span>
      );
    case 'ice':
    case 'earth':
    case 'steel':
    case 'wind':
    case 'light':
    case 'dark':
      return (
        <span className="glyph" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none"><path d="M32 8 54 20v24L32 56 10 44V20L32 8Z" stroke="currentColor" strokeWidth="4" /><path d="M10 20 32 32l22-12M32 32v24" stroke="currentColor" strokeWidth="4" /></svg>
        </span>
      );
    default:
      element satisfies never;
      return <span className="glyph" aria-hidden="true" />;
  }
}

function isPartyMember(mon: RosterView | null): mon is PartyMember {
  return mon !== null && mon.template !== null;
}

function displayName(mon: PartyMember): string {
  return mon.nickname.length > 0 ? mon.nickname : mon.template.name;
}

function elementStyle(element: Element): ElementStyle {
  return { '--el': elementToken(element) };
}

function elementToken(element: Element): string {
  switch (element) {
    case 'fire':
      return 'var(--el-fire)';
    case 'water':
      return 'var(--el-water)';
    case 'plant':
      return 'var(--el-nature)';
    case 'electricity':
      return 'var(--el-electric)';
    case 'null':
      return 'var(--el-neutral)';
    case 'ice':
    case 'earth':
    case 'steel':
    case 'wind':
    case 'light':
    case 'dark':
      return 'var(--el-neutral)';
    default:
      element satisfies never;
      return 'var(--el-neutral)';
  }
}
