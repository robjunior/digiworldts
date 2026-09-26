import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { ELEMENTS, STAGES } from '@digiworld/shared/digimon';

import { DigimonSprite } from '../components/common/DigimonSprite';
import { isDowned } from '../components/roster/types';
import { useT } from '../hooks/useLocale';
import { getRoster, type RosterView } from '../lib/api';
import {
  activateTeam,
  buyTeamSlot,
  createTeam,
  deleteTeam,
  getTeams,
  renameTeam,
  setTeamMembers,
  TEAM_SLOT_PRICE,
  type TeamView,
} from '../lib/api-teams';
import '../styles/extensions-roster.css';

const TEAMS_KEY = ['teams'] as const;
const ROSTER_KEY = ['roster'] as const;

/** Rows rendered per lazy-load batch in the digimon grid. */
const GRID_STEP = 30;

const elementOf = (mon: RosterView): string => mon.template?.element ?? 'null';

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

/** Why a mon cannot stand in the party right now: null = available. */
function partyBlockReason(mon: RosterView, now: number): 'down' | 'listed' | 'busy' | null {
  if (isDowned(mon, now)) return 'down';
  if (mon.listedAt !== null) return 'listed';
  if (mon.status !== 'resting' && mon.status !== 'party') return 'busy';
  return null;
}

export function Roster(): JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const teamsQuery = useQuery({ queryKey: TEAMS_KEY, queryFn: getTeams });
  const rosterQuery = useQuery({ queryKey: ROSTER_KEY, queryFn: getRoster });

  const [now, setNow] = useState(() => Date.now());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ teamId: string; slot: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [element, setElement] = useState('all');
  const [stage, setStage] = useState('all');
  const [visible, setVisible] = useState(GRID_STEP);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const teams = teamsQuery.data?.teams ?? [];
  const limit = teamsQuery.data?.limit ?? 3;
  const roster = rosterQuery.data?.roster ?? [];

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Expand the active team by default; otherwise the first one.
  useEffect(() => {
    if (expandedId !== null || teams.length === 0) return;
    setExpandedId(teams.find((team) => team.active)?.id ?? teams[0]!.id);
  }, [teams, expandedId]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: TEAMS_KEY });
    void queryClient.invalidateQueries({ queryKey: ROSTER_KEY });
  };

  const monById = useMemo(() => new Map(roster.map((mon) => [mon.id, mon] as const)), [roster]);
  const partyHasMons = useMemo(() => roster.some((mon) => typeof mon.slot === 'number'), [roster]);

  const createMut = useMutation({
    mutationFn: (input: { seedFromParty: boolean }) => createTeam(input),
    onSuccess: (team) => {
      setNotice(t('roster.create_empty') + ' ✓');
      setExpandedId(team.id);
      invalidate();
    },
    onError: (error) => setNotice(errMsg(error)),
  });
  const membersMut = useMutation({
    mutationFn: ({ teamId, monIds }: { teamId: string; monIds: readonly (string | null)[] }) => setTeamMembers(teamId, monIds),
    onSuccess: (team) => {
      setNotice(team.active ? 'Party sync ✓' : 'Time atualizado ✓');
      setPicking(null);
      invalidate();
    },
    onError: (error) => setNotice(errMsg(error)),
  });
  const activateMut = useMutation({
    mutationFn: activateTeam,
    onSuccess: (team) => {
      setNotice(`“${team.name}” ${t('roster.set_active').toLowerCase()} ✓`);
      invalidate();
    },
    onError: (error) => setNotice(errMsg(error)),
  });
  const renameMut = useMutation({
    mutationFn: ({ teamId, name }: { teamId: string; name: string }) => renameTeam(teamId, name),
    onSuccess: () => { setNotice('✓'); invalidate(); },
    onError: (error) => setNotice(errMsg(error)),
  });
  const deleteMut = useMutation({
    mutationFn: deleteTeam,
    onSuccess: () => {
      setNotice('Time excluído');
      setPendingDelete(null);
      setExpandedId(null);
      setPicking(null);
      invalidate();
    },
    onError: (error) => setNotice(errMsg(error)),
  });
  const buyMut = useMutation({
    mutationFn: buyTeamSlot,
    onSuccess: () => { setNotice(t('roster.extra_slot_title') + ' +1 ✓'); invalidate(); },
    onError: (error) => setNotice(errMsg(error)),
  });

  // ---- grid filter + lazy loading -----------------------------------------
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return roster.filter((mon) => {
      if (element !== 'all' && elementOf(mon) !== element) return false;
      if (stage !== 'all' && mon.template?.stage !== stage) return false;
      if (query) {
        const hay = `${mon.nickname} ${mon.catalogId} ${mon.template?.name ?? ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [roster, q, element, stage]);

  const elCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const mon of roster) {
      const e = elementOf(mon);
      counts[e] = (counts[e] ?? 0) + 1;
    }
    return counts;
  }, [roster]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const mon of roster) {
      const s = mon.template?.stage ?? 'Unknown';
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [roster]);

  useEffect(() => { setVisible(GRID_STEP); }, [q, element, stage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (sentinel === null || root === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible((v) => Math.min(filtered.length, v + GRID_STEP));
        }
      },
      { root, rootMargin: '240px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [filtered.length]);
  const visibleMons = filtered.slice(0, visible);

  // ---- team/slot interactions ---------------------------------------------
  const assignToSlot = (team: TeamView, slot: number, monId: string): void => {
    const next = team.monIds.slice() as (string | null)[];
    if (next[slot] === monId) {
      setPicking(null);
      return;
    }
    next[slot] = monId;
    membersMut.mutate({ teamId: team.id, monIds: next });
  };

  const onGridClick = (mon: RosterView): void => {
    if (picking === null) {
      navigate(`/creature/${encodeURIComponent(mon.id)}`);
      return;
    }
    const team = teams.find((candidate) => candidate.id === picking.teamId);
    if (team === undefined) {
      setPicking(null);
      return;
    }
    assignToSlot(team, picking.slot, mon.id);
  };

  const togglePick = (teamId: string, slot: number): void => {
    setPicking((current) => (current !== null && current.teamId === teamId && current.slot === slot ? null : { teamId, slot }));
  };

  const chips = [
    { v: 'all', l: 'ALL', n: roster.length },
    ...ELEMENTS.map((e) => ({ v: e, l: e.toUpperCase(), n: elCounts[e] ?? 0 })),
  ];
  const stageChips = [
    { v: 'all', l: 'ALL', n: roster.length },
    ...STAGES.map((s) => ({ v: s, l: s.toUpperCase(), n: stageCounts[s] ?? 0 })),
  ];
  const filterActive = q.trim().length > 0 || element !== 'all' || stage !== 'all';

  return (
    <section className="detail roster2" data-od-id="roster-teams">
      <div className="roster2-cols">
        {/* ===================== LEFT: teams ===================== */}
        <aside className="roster2-teams" data-od-id="roster-teams-list">
          <div className="roster2-teams-head">
            <span className="kick">{t('roster.title')}</span>
            <h2>{t('roster.teams_title')}
              <span className="cnt" data-od-id="roster-team-count">{teams.length}/{limit}</span>
            </h2>
            <button
              type="button"
              className="btn-primary"
              disabled={createMut.isPending || teams.length >= limit}
              title={teams.length >= limit ? t('roster.limit_reached') : undefined}
              data-od-id="roster-add-team"
              onClick={() => createMut.mutate({ seedFromParty: false })}
            >
              + {t('roster.add_team')}
            </button>
          </div>

          {notice !== null ? (
            <div className="roster2-notice" role="status" onClick={() => setNotice(null)}>{notice}</div>
          ) : null}

          <div className="roster2-teams-scroll">
            {teamsQuery.isLoading ? (
              <div className="roster2-empty">{'…'}</div>
            ) : teams.length === 0 ? (
              <div className="roster2-empty" data-od-id="roster-teams-empty">
                <p className="em">{t('roster.empty_teams_title')}</p>
                <p className="sub">{t('roster.empty_teams_hint')}</p>
                {partyHasMons ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={createMut.isPending}
                    onClick={() => createMut.mutate({ seedFromParty: true })}
                  >
                    {t('roster.create_from_party')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={createMut.isPending}
                  onClick={() => createMut.mutate({ seedFromParty: false })}
                >
                  {t('roster.create_empty')}
                </button>
              </div>
            ) : (
              teams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  monById={monById}
                  now={now}
                  t={t}
                  expanded={team.id === expandedId}
                  picking={picking !== null && picking.teamId === team.id ? picking.slot : null}
                  pendingDelete={pendingDelete === team.id}
                  nameDraft={nameDrafts[team.id] ?? team.name}
                  busy={
                    membersMut.isPending || activateMut.isPending || renameMut.isPending || deleteMut.isPending
                  }
                  onToggle={() => {
                    setExpandedId((current) => (current === team.id ? null : team.id));
                    setPendingDelete(null);
                  }}
                  onPickSlot={(slot) => togglePick(team.id, slot)}
                  onRenameDraft={(value) => setNameDrafts((drafts) => ({ ...drafts, [team.id]: value }))}
                  onSaveName={() => {
                    const name = (nameDrafts[team.id] ?? team.name).trim();
                    if (name.length > 0 && name !== team.name) renameMut.mutate({ teamId: team.id, name });
                    setNameDrafts((drafts) => {
                      const next = { ...drafts };
                      delete next[team.id];
                      return next;
                    });
                  }}
                  onActivate={() => activateMut.mutate(team.id)}
                  onDelete={() => {
                    if (pendingDelete === team.id) {
                      deleteMut.mutate(team.id);
                    } else {
                      setPendingDelete(team.id);
                      window.setTimeout(() => setPendingDelete((current) => (current === team.id ? null : current)), 3000);
                    }
                  }}
                />
              ))
            )}
          </div>

          <div className="roster2-slot-upsell" data-od-id="roster-slot-upsell">
            <div className="usc-icon" aria-hidden="true">+</div>
            <div className="usc-body">
              <b>{t('roster.extra_slot_title')}</b>
              <span>{t('roster.extra_slot_desc', { price: String(TEAM_SLOT_PRICE) })}</span>
            </div>
            <button
              type="button"
              className="btn-buy"
              disabled={buyMut.isPending || limit >= 12}
              title={limit >= 12 ? t('roster.slots_maxed') : undefined}
              onClick={() => buyMut.mutate()}
            >
              {t('roster.buy_slot')}
            </button>
          </div>
        </aside>

        {/* ===================== RIGHT: digimon grid ===================== */}
        <section className="roster2-panel" data-od-id="roster-grid-panel">
          <div className="roster2-filters">
            <label className="search" aria-label={t('common.search')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
              <input
                type="search"
                placeholder={t('roster.search_placeholder')}
                autoComplete="off"
                value={q}
                onChange={(event) => setQ(event.currentTarget.value)}
              />
            </label>
            <div className="filters" role="group" aria-label={t('roster.filter_by_element')}>
              {chips.map(({ v, l, n }) => (
                <button
                  key={`el-${v}`}
                  type="button"
                  className="chip"
                  data-el={v === 'all' ? undefined : v}
                  aria-pressed={element === v}
                  onClick={() => setElement(v)}
                >
                  {l}<span className="n">{n}</span>
                </button>
              ))}
            </div>
            <div className="filters" role="group" aria-label={t('roster.filter_stage')}>
              {stageChips.map(({ v, l, n }) => (
                <button
                  key={`st-${v}`}
                  type="button"
                  className="chip"
                  aria-pressed={stage === v}
                  onClick={() => setStage(v)}
                >
                  {l}<span className="n">{n}</span>
                </button>
              ))}
            </div>
            {filterActive ? (
              <button
                type="button"
                className="clearf"
                onClick={() => { setQ(''); setElement('all'); setStage('all'); }}
              >
                {t('roster.clear_filters')}
              </button>
            ) : null}
          </div>

          {picking !== null ? (
            <div className="roster2-pickbar" data-od-id="roster-pickbar">
              <span>{t('roster.pick_hint')}</span>
              <button type="button" className="btn-ghost" onClick={() => setPicking(null)}>{t('roster.pick_cancel')}</button>
            </div>
          ) : null}

          <div className="roster2-grid-scroll" ref={scrollRef}>
            {rosterQuery.isLoading ? (
              <div className="roster2-empty">{'…'}</div>
            ) : visibleMons.length === 0 ? (
              <div className="roster2-empty">
                <p className="em">{roster.length === 0 ? t('roster.party_empty') : t('roster.no_mons')}</p>
                {filterActive ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => { setQ(''); setElement('all'); setStage('all'); }}
                  >
                    {t('roster.clear_filters')}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="roster2-grid" data-od-id="roster-grid">
                {visibleMons.map((mon) => (
                  <MonCard
                    key={mon.id}
                    mon={mon}
                    now={now}
                    t={t}
                    picking={picking !== null}
                    assignedToPickingTeam={picking !== null && teams.find((team) => team.id === picking.teamId)?.monIds.includes(mon.id) === true}
                    onPick={() => onGridClick(mon)}
                  />
                ))}
                <div ref={sentinelRef} className="roster2-grid-sentinel" aria-hidden="true" />
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

// ============================================================================
// Team card (left column)
// ============================================================================

type TeamCardProps = {
  readonly team: TeamView;
  readonly monById: ReadonlyMap<string, RosterView>;
  readonly now: number;
  readonly t: (key: string, params?: Readonly<Record<string, string | number>>) => string;
  readonly expanded: boolean;
  readonly picking: number | null;
  readonly pendingDelete: boolean;
  readonly nameDraft: string;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly onPickSlot: (slot: number) => void;
  readonly onRenameDraft: (value: string) => void;
  readonly onSaveName: () => void;
  readonly onActivate: () => void;
  readonly onDelete: () => void;
};

function TeamCard({
  team, monById, now, t, expanded, picking, pendingDelete, nameDraft, busy,
  onToggle, onPickSlot, onRenameDraft, onSaveName, onActivate, onDelete,
}: TeamCardProps): JSX.Element {
  return (
    <article className={`team-card${team.active ? ' team-card--active' : ''}${expanded ? ' team-card--open' : ''}`} data-od-id={`team-card-${team.id}`}>
      <button type="button" className="team-row" aria-expanded={expanded} onClick={onToggle}>
        <span className="team-row-main">
          <span className="team-name">{team.name}</span>
          {team.active ? <span className="team-active">{t('roster.active')}</span> : null}
        </span>
        <span className="team-avatars">
          {[0, 1, 2].map((slot) => {
            const monId = team.monIds[slot];
            const mon = monId == null ? undefined : monById.get(monId);
            return mon === undefined ? (
              <span key={slot} className="team-avatar team-avatar--empty" aria-label={t('roster.slot_empty')}>?</span>
            ) : (
              <span key={slot} className="team-avatar" data-el={elementOf(mon)}>
                <DigimonSprite catalogId={mon.catalogId} alt={mon.nickname} />
              </span>
            );
          })}
        </span>
        <svg className="team-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded ? (
        <div className="team-detail" data-od-id={`team-detail-${team.id}`}>
          <div className="team-slots">
            {[0, 1, 2].map((slot) => {
              const monId = team.monIds[slot];
              const mon = monId == null ? undefined : monById.get(monId);
              const isPicking = picking === slot;
              return (
                <div key={slot} className={`team-slot${isPicking ? ' team-slot--picking' : ''}${mon === undefined ? ' team-slot--empty' : ''}`}>
                  <span className="ts-mug">
                    {mon === undefined ? <span className="ts-q">?</span> : <DigimonSprite catalogId={mon.catalogId} alt={mon.nickname} />}
                  </span>
                  <span className="ts-info">
                    {mon === undefined ? (
                      <>
                        <b>{t('roster.slot_empty')}</b>
                        <span>Slot {slot + 1}</span>
                      </>
                    ) : (
                      <>
                        <b>{mon.nickname}</b>
                        <span>{mon.template?.name ?? mon.catalogId}</span>
                        <span className="ts-meta">
                          LV {mon.level} · {mon.template?.stage ?? '?'} · {(mon.template?.element ?? '?').toUpperCase()}
                        </span>
                        <SlotsWarn mon={mon} now={now} t={t} />
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    className={`btn-ghost ts-change${isPicking ? ' is-picking' : ''}`}
                    disabled={busy}
                    onClick={() => onPickSlot(slot)}
                  >
                    {isPicking ? t('roster.pick_cancel') : t('roster.slot_change')}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="team-actions">
            <label className="team-rename">
              <input
                type="text"
                maxLength={24}
                value={nameDraft}
                placeholder={team.name}
                onChange={(event) => onRenameDraft(event.currentTarget.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') onSaveName(); }}
              />
              <button type="button" className="btn-ghost" disabled={busy} onClick={onSaveName}>{t('roster.rename_team')}</button>
            </label>
            {!team.active ? (
              <button type="button" className="btn-primary" disabled={busy} onClick={onActivate}>{t('roster.set_active')}</button>
            ) : null}
            <button
              type="button"
              className={`btn-danger${pendingDelete ? ' is-armed' : ''}`}
              disabled={busy}
              onClick={onDelete}
            >
              {pendingDelete ? 'Confirmar?' : t('roster.delete_team')}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function SlotsWarn({ mon, now, t }: { readonly mon: RosterView; readonly now: number; readonly t: (key: string) => string }): JSX.Element | null {
  const reason = partyBlockReason(mon, now);
  if (reason === null) return null;
  const label = reason === 'down' ? t('roster.status_down') : reason === 'listed' ? t('roster.status_listed') : t('roster.status_busy');
  return <span className="ts-warn" title={reason === 'busy' ? mon.status : label}>{label}</span>;
}

// ============================================================================
// Grid card (right column)
// ============================================================================

type MonCardProps = {
  readonly mon: RosterView;
  readonly now: number;
  readonly t: (key: string) => string;
  readonly picking: boolean;
  readonly assignedToPickingTeam: boolean;
  readonly onPick: () => void;
};

function MonCard({ mon, now, t, picking, assignedToPickingTeam, onPick }: MonCardProps): JSX.Element {
  const template = mon.template;
  const element = elementOf(mon);
  const reason = partyBlockReason(mon, now);
  const blocked = reason !== null;
  return (
    <button
      type="button"
      className={`mon-card${blocked ? ' mon-card--blocked' : ''}${picking ? ' mon-card--pickable' : ''}${assignedToPickingTeam ? ' mon-card--in-team' : ''}`}
      data-el={element}
      data-status={mon.status}
      aria-label={`${mon.nickname}, ${template?.name ?? mon.catalogId}, Level ${mon.level}`}
      onClick={onPick}
    >
      <span className="mc-mug"><DigimonSprite catalogId={mon.catalogId} alt="" /></span>
      {assignedToPickingTeam ? <span className="mc-check" aria-hidden="true">✓</span> : null}
      <span className="mc-name">{mon.nickname}</span>
      <span className="mc-species">{template?.name ?? mon.catalogId}</span>
      <span className="mc-meta">{template?.stage ?? '?'} · {element.charAt(0).toUpperCase() + element.slice(1)} · LV {mon.level}</span>
      {reason !== null ? <span className="mc-badge">{reason === 'down' ? t('roster.status_down') : reason === 'listed' ? t('roster.status_listed') : t('roster.status_busy')}</span> : null}
    </button>
  );
}