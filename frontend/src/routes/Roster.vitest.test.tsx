/**
 * Render smoke test for the new two-column Roster screen (teams + digimon
 * grid). Uses react-dom/client + happy-dom with react-query + router, mocked
 * at the API layer, following the repo's existing vitest pattern.
 *
 * Asserts:
 *   - teams column renders name + count pill + active badge
 *   - grid renders the owned digimon cards
 *   - element chip filters the grid
 *   - clicking a slot's "Change" enters pick mode (pickbar appears) and
 *     clicking a grid card assigns via setTeamMembers with the slot replaced
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { Element } from '@digiworld/shared/digimon';

import { Roster } from './Roster';
import type { RosterView } from '../lib/api';

vi.mock('../lib/api', () => ({
  getRoster: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getTeams: vi.fn(),
  createTeam: vi.fn(),
  renameTeam: vi.fn(),
  setTeamMembers: vi.fn(),
  activateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  buyTeamSlot: vi.fn(),
}));

vi.mock('../lib/api-teams', () => ({
  getTeams: api.getTeams,
  createTeam: api.createTeam,
  renameTeam: api.renameTeam,
  setTeamMembers: api.setTeamMembers,
  activateTeam: api.activateTeam,
  deleteTeam: api.deleteTeam,
  buyTeamSlot: api.buyTeamSlot,
  TEAM_SLOT_ITEM_ID: 'itm-team-slot',
  TEAM_SLOT_PRICE: 200,
}));

import { getRoster } from '../lib/api';

const STAGES = ['Baby', 'In-Training', 'Rookie', 'Champion', 'Ultimate', 'Mega'] as const;

function mkMon(id: string, catalogId: string, nickname: string, level = 5, status: RosterView['status'] = 'resting', slot: number | null = null): RosterView {
  const stage = STAGES[level % STAGES.length] ?? 'Rookie';
  return {
    id,
    catalogId,
    nickname,
    level,
    xp: 0,
    xpFloor: 0,
    xpNext: 100,
    statBonus: { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: 0 },
    mood: 50,
    status,
    slot,
    reviveAt: null,
    currentHp: null,
    currentEn: null,
    hpMax: 300,
    enMax: 30,
    listedAt: null,
    evolutionHistory: [],
    equippedSkillIds: null,
    stagePools: null,
    template: {
      id: catalogId,
      name: catalogId,
      stage,
      attribute: 'Vaccine' as const,
      element: 'fire' as Element,
      baseStats: { hp: 300, en: 30, atk: 100, def: 80, int: 90, spd: 100 },
      skillPool: [],
      assets: { portrait: '', dot: '' },
    },
  };
}

function mount(): { host: HTMLElement; root: ReturnType<typeof createRoot> } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Harness(): JSX.Element {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, { initialEntries: ['/roster'] }, createElement(Roster)),
    );
  }
  const root = createRoot(host);
  act(() => {
    flushSync(() => root.render(createElement(Harness)));
  });
  return { host, root };
}

/** Flush query/mutation microtasks so mocked API resolutions re-render. */
async function settle(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe('Roster (teams screen)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the two columns: team card + digimon grid', async () => {
    const mons = [mkMon('mon_a', 'agumon', 'Agumon', 10, 'party', 0), mkMon('mon_b', 'gabumon', 'Gabumon'), mkMon('mon_c', 'palmon', 'Palmon')];
    vi.mocked(getRoster).mockResolvedValue({ roster: mons });
    api.getTeams.mockResolvedValue({
      teams: [{ id: 'team_1', name: 'Time 1', active: true, monIds: ['mon_a', 'mon_b', 'mon_c'] }],
      limit: 3,
      premium: false,
      extraSlots: 0,
    });

    const { host, root } = mount();
    await settle();
    try {
      expect(host.textContent).toContain('Time 1');
      expect(host.textContent).toContain('1/3');
      expect(host.textContent).toContain('ACTIVE');
      expect(host.textContent).toContain('Agumon');
      expect(host.textContent).toContain('Gabumon');
      expect(host.textContent).toContain('Palmon');
      expect(host.querySelector('[data-od-id="roster-grid"]')).toBeTruthy();
      expect(host.querySelector('[data-od-id="roster-teams-list"]')).toBeTruthy();
      // The active team expands by default → slot details are visible.
      expect(host.textContent).toContain('Change');
      expect(host.textContent).toContain('Buy slot');
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it('grid filters by element chips', async () => {
    vi.mocked(getRoster).mockResolvedValue({
      roster: [mkMon('mon_a', 'aga', 'Agumon', 3, 'resting'), mkMon('mon_b', 'gab', 'Gabumon', 4, 'resting')],
    });
    api.getTeams.mockResolvedValue({ teams: [], limit: 3, premium: false, extraSlots: 0 });

    const { host, root } = mount();
    await settle();
    try {
      expect(host.textContent).toContain('Agumon');
      expect(host.textContent).toContain('Gabumon');
      // Click the FIRE chip (both fixtures are fire) → ALL chips still include
      // both, but the WATER chip must clear the grid.
      const waterChip = Array.from(host.querySelectorAll('.chip')).find((c) => (c.textContent ?? '').startsWith('WATER'));
      expect(waterChip).toBeTruthy();
      act(() => flushSync(() => (waterChip as HTMLElement).click()));
      expect(host.textContent).not.toContain('Agumon');
      expect(host.textContent).not.toContain('Gabumon');
      expect(host.textContent).toContain('No Digimon match these filters.');
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it('pick mode: Change on a slot, then clicking a grid card assigns', async () => {
    const mons = [mkMon('mon_a', 'aga', 'Agumon', 10, 'party', 0), mkMon('mon_b', 'gab', 'Gabumon'), mkMon('mon_c', 'pal', 'Palmon')];
    vi.mocked(getRoster).mockResolvedValue({ roster: mons });
    api.getTeams.mockResolvedValue({
      teams: [{ id: 'team_1', name: 'Time 1', active: true, monIds: ['mon_a', 'mon_b', 'mon_c'] }],
      limit: 3,
      premium: false,
      extraSlots: 0,
    });
    api.setTeamMembers.mockResolvedValue({
      id: 'team_1', name: 'Time 1', active: true, monIds: ['mon_a', 'mon_a', 'mon_c'],
    });

    const { host, root } = mount();
    await settle();
    try {
      const changeButtons = Array.from(host.querySelectorAll('.ts-change'));
      const slot1Change = changeButtons[1] as HTMLElement;
      act(() => flushSync(() => slot1Change.click()));
      await settle();
      expect(host.querySelector('[data-od-id="roster-pickbar"]')).toBeTruthy();

      // Click the first grid card (Agumon) → assigns into slot 1.
      const card = host.querySelector('.mon-card') as HTMLElement;
      act(() => flushSync(() => card.click()));
      await settle();
      expect(api.setTeamMembers).toHaveBeenCalledWith('team_1', ['mon_a', 'mon_a', 'mon_c']);
      expect(host.querySelector('[data-od-id="roster-pickbar"]')).toBeNull();
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});