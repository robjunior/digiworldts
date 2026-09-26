/**
 * Regression test for stale adventure reports.
 *
 * Before the `foundDigimons` rewrite (b618875), reports stored in the DB
 * lacked the newer fields (foundDigimons, xpDeltas, koedMonIds, premiumBonus).
 * ReportPanel read `report.foundDigimons.length` directly and crashed on old
 * rows. This test proves an old-shaped report still renders without throwing,
 * and that a modern report renders the "Digimon found" chips.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { flushSync } from 'react-dom';

import type { AdventureReport, AdventureView } from '../../lib/api-adventure';
import { ReportPanel } from './ReportPanel';

function mount(report: AdventureReport, adventure: AdventureView): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const root = createRoot(host);
  act(() => {
    flushSync(() => {
      root.render(createElement(ReportPanel, { report, adventure }));
    });
  });

  return host;
}

function baseAdventure(report: AdventureReport): AdventureView {
  return {
    id: 'a1',
    slot: 0,
    startedAt: 0,
    distanceMs: 3.6e6,
    finishesAt: 0,
    remainingMs: 0,
    ready: true,
    meatSpent: 0,
    party: [],
    collectedAt: 1,
    report,
  };
}

describe('ReportPanel', () => {
  it('renders a stale report (missing newer fields) without throwing', () => {
    // A report as it was stored BEFORE the `foundDigimons` rewrite.
    const stale = {
      encounters: [],
      wins: 3,
      losses: 2,
      totals: { meat: 0, bits: 0, data: 0, netcore: 0 },
    } as unknown as AdventureReport;

    const host = mount(stale, baseAdventure(stale));
    const html = host.innerHTML;
    expect(html).toContain('Wins');
    expect(html).toContain('3');
    expect(html).toContain('No loot this run.');
  });

  it('renders a modern report with found-digimon chips', () => {
    const fresh: AdventureReport = {
      encounters: [],
      wins: 1,
      losses: 0,
      totals: { meat: 5, bits: 0, data: 0, netcore: 0 },
      xpDeltas: [
        { monId: 'm1', xpGained: 120, levelBefore: 3, levelAfter: 4, gainedLevels: 1 },
      ],
      koedMonIds: [],
      foundDigimons: [
        { catalogId: 'agumon', name: 'Agumon', stage: 'Rookie', element: 'fire', count: 1 },
      ],
      premium: false,
      premiumBonus: { meat: 0, bits: 0, data: 0, netcore: 0, xp: 0 },
    };

    const host = mount(fresh, baseAdventure(fresh));
    const html = host.innerHTML;
    expect(html).toContain('Digimon found');
    expect(html).toContain('Agumon');
    expect(html).toContain('Meat');
  });
});