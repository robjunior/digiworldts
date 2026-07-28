import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  deleteRosterMon,
  getUserRoster,
  getUsers,
  issueUserResetToken,
  spawnRosterMon,
  updateRosterMon,
  updateUserCredits,
  updateUserFlags,
  type AdminResetTokenResponse,
  type AdminRosterStatus,
  type AdminRosterView,
  type RosterInput,
  type UserListEntry,
} from '../../lib/api-admin';
import { AdminMessage, AdminSection, ErrorText, Field } from './AdminShared';

const USERS_QUERY_KEY = ['admin', 'users'] as const;
const USER_LIMIT = 50;

export function UserTable(): JSX.Element {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const usersQuery = useQuery({ queryKey: [...USERS_QUERY_KEY, query, offset], queryFn: () => getUsers({ q: query, limit: USER_LIMIT, offset }) });
  const users = usersQuery.data?.users ?? [];

  // Auto-select first user when list loads or selection is stale.
  useEffect(() => {
    if (users.length === 0) return;
    if (selectedId === null || !users.some((u) => u.id === selectedId)) {
      setSelectedId(users[0]?.id ?? null);
    }
  }, [users, selectedId]);

  const selectedUser = users.find((u) => u.id === selectedId) ?? null;
  const flagsMutation = useMutation({
    mutationFn: (input: UserFlagMutationInput) => updateUserFlags(input.id, toFlags(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  });
  const creditsMutation = useMutation({
    mutationFn: ({ id, credits }: { readonly id: string; readonly credits: number }) => updateUserCredits(id, credits),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  });

  const total = usersQuery.data?.total ?? 0;
  const hasMore = usersQuery.data?.hasMore ?? false;

  return (
    <div className="admin-users-layout">
      <AdminSection title="Users" lede={`Search accounts and pick one to inspect. ${total} total.`}>
        <ErrorText error={usersQuery.error ?? flagsMutation.error ?? creditsMutation.error} />
        <div className="admin-filter-bar">
          <Field label="Search users">
            <input
              className="input"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setOffset(0); }}
              placeholder="username"
            />
          </Field>
        </div>
        <div className="admin-user-list">
          {usersQuery.isPending ? (
            <AdminMessage tone="muted">Loading users…</AdminMessage>
          ) : users.length === 0 ? (
            <AdminMessage tone="muted">No users match this filter.</AdminMessage>
          ) : (
            users.map((user) => (
              <UserListItem
                key={user.id}
                user={user}
                selected={user.id === selectedId}
                onSelect={() => setSelectedId(user.id)}
              />
            ))
          )}
        </div>
        <div className="admin-pager">
          <button
            className="btn btn--secondary btn--sm"
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - USER_LIMIT))}
          >
            Previous
          </button>
          <span className="admin-pager-count">
            {usersQuery.data ? `${offset + 1}-${Math.min(offset + USER_LIMIT, total)} of ${total}` : '—'}
          </span>
          <button
            className="btn btn--secondary btn--sm"
            type="button"
            disabled={!hasMore}
            onClick={() => setOffset(offset + USER_LIMIT)}
          >
            Next
          </button>
        </div>
      </AdminSection>

      {selectedUser ? (
        <UserDetail
          user={selectedUser}
          busy={flagsMutation.isPending || creditsMutation.isPending}
          onFlags={(flags) => void flagsMutation.mutate({ id: selectedUser.id, ...flags })}
          onCredits={(credits) => void creditsMutation.mutate({ id: selectedUser.id, credits })}
        />
      ) : (
        <AdminSection title="Account" lede="Select a user on the left to view roster, party, and controls.">
          <AdminMessage tone="muted">No user selected.</AdminMessage>
        </AdminSection>
      )}
    </div>
  );
}

function UserListItem({ user, selected, onSelect }: { readonly user: UserListEntry; readonly selected: boolean; readonly onSelect: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className={`admin-user-item${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="admin-user-item-head">
        <span className="admin-user-item-name">{user.displayName}</span>
        <span className="admin-user-item-role">
          {user.isAdmin ? <span className="badge badge--admin">ADMIN</span> : null}
          {user.disabled ? <span className="badge badge--disabled">OFF</span> : null}
        </span>
      </span>
      <span className="admin-user-item-meta">
        <span>@{user.username}</span>
        <span className="admin-user-item-stats">
          <span title="Credits">{user.credits}c</span>
          <span title="Mons">{user.monCount}m</span>
        </span>
      </span>
    </button>
  );
}

type UserFlagMutationInput = {
  readonly id: string;
  readonly isAdmin?: boolean;
  readonly disabled?: boolean;
};

function toFlags(input: UserFlagMutationInput): { readonly isAdmin?: boolean; readonly disabled?: boolean } {
  return {
    ...(input.isAdmin === undefined ? {} : { isAdmin: input.isAdmin }),
    ...(input.disabled === undefined ? {} : { disabled: input.disabled }),
  };
}

function UserDetail({ user, busy, onFlags, onCredits }: {
  readonly user: UserListEntry;
  readonly busy: boolean;
  readonly onFlags: (flags: { readonly isAdmin?: boolean; readonly disabled?: boolean }) => void;
  readonly onCredits: (credits: number) => void;
}): JSX.Element {
  const [credits, setCredits] = useState(String(user.credits));
  const [resetResult, setResetResult] = useState<AdminResetTokenResponse | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  useEffect(() => { setCredits(String(user.credits)); }, [user.id, user.credits]);
  useEffect(() => { setResetResult(null); setCopied(false); }, [user.id]);

  const resetMutation = useMutation({
    mutationFn: () => issueUserResetToken(user.id),
    onSuccess: (result) => { setResetResult(result); setCopied(false); },
  });

  const resetUrl = useMemo(() => {
    if (resetResult === null) return '';
    if (resetResult.url.startsWith('http')) return resetResult.url;
    return `${window.location.origin}${resetResult.url}`;
  }, [resetResult]);

  const handleCopy = async (): Promise<void> => {
    if (resetUrl === '') return;
    try {
      await navigator.clipboard.writeText(resetUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <AdminSection title={user.displayName} lede={`@${user.username} · joined ${formatDate(user.createdAt)}${user.lastLoginAt ? ` · last seen ${formatDate(user.lastLoginAt)}` : ''}`}>
      <div className="admin-user-controls">
        <label className="admin-toggle">
          <input type="checkbox" checked={user.isAdmin} disabled={busy} onChange={(event) => onFlags({ isAdmin: event.target.checked })} />
          <span>Admin</span>
        </label>
        <label className="admin-toggle">
          <input type="checkbox" checked={user.disabled} disabled={busy} onChange={(event) => onFlags({ disabled: event.target.checked })} />
          <span>Disabled</span>
        </label>
        <Field label="Credits">
          <input
            className="input admin-credit-input"
            value={credits}
            onChange={(event) => setCredits(event.target.value)}
            onBlur={() => {
              const parsed = Number(credits);
              if (Number.isFinite(parsed) && parsed !== user.credits) onCredits(Math.max(0, Math.floor(parsed)));
            }}
          />
        </Field>
        <div className="admin-user-controls-stat">
          <span className="lbl">Mons</span>
          <span className="val">{user.monCount}</span>
        </div>
      </div>
      <div className="admin-user-reset">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={resetMutation.isPending}
          onClick={() => resetMutation.mutate()}
          title="Issue a one-time password reset URL (15 min TTL). DM the URL to the player; they set their own password."
        >
          {resetMutation.isPending ? 'Issuing…' : (resetResult === null ? 'Issue reset URL' : 'Issue new reset URL')}
        </button>
        {resetMutation.error ? <ErrorText error={resetMutation.error} /> : null}
        {resetResult !== null ? (
          <div className="admin-user-reset-result">
            <input
              className="input admin-user-reset-url"
              value={resetUrl}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Password reset URL"
            />
            <button type="button" className="btn btn--sm" onClick={() => void handleCopy()}>{copied ? 'Copied ✓' : 'Copy'}</button>
            <span className="admin-user-reset-meta">Expires {formatDateTime(resetResult.expiresAt)}</span>
          </div>
        ) : null}
      </div>
      <UserRoster userId={user.id} />
    </AdminSection>
  );
}

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function UserRoster({ userId }: { readonly userId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const rosterKey = ['admin', 'user-roster', userId] as const;
  const rosterQuery = useQuery({ queryKey: rosterKey, queryFn: () => getUserRoster(userId) });
  const spawnMutation = useMutation({
    mutationFn: (catalogId: string) => spawnRosterMon(userId, { catalogId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rosterKey }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ monId, input }: { readonly monId: string; readonly input: RosterInput }) => updateRosterMon(monId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rosterKey }),
  });
  const deleteMutation = useMutation({
    mutationFn: (monId: string) => deleteRosterMon(monId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rosterKey }),
  });

  const roster = rosterQuery.data?.roster ?? [];
  const partyBySlot = useMemo(() => {
    const map = new Map<number, AdminRosterView>();
    for (const mon of roster) if (mon.status === 'party' && mon.slot !== null) map.set(mon.slot, mon);
    return map;
  }, [roster]);
  const nonPartyRoster = roster.filter((mon) => mon.status !== 'party');
  const busy = spawnMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  const assignToSlot = (mon: AdminRosterView, slot: number): void => {
    void updateMutation.mutate({ monId: mon.id, input: { status: 'party', slot } });
  };
  const clearSlot = (mon: AdminRosterView): void => {
    void updateMutation.mutate({ monId: mon.id, input: { status: 'resting', slot: null } });
  };

  return (
    <>
      <ErrorText error={rosterQuery.error ?? spawnMutation.error ?? updateMutation.error ?? deleteMutation.error} />

      <h3 className="admin-subheading">Party</h3>
      <div className="admin-party-slots">
        {[0, 1, 2].map((slot) => {
          const mon = partyBySlot.get(slot) ?? null;
          return (
            <div key={slot} className={`admin-party-slot${mon ? ' is-filled' : ''}`}>
              <div className="admin-party-slot-label">Slot {slot + 1}</div>
              {mon ? (
                <>
                  {mon.catalogPortrait ? <img className="admin-party-slot-portrait" src={mon.catalogPortrait} alt="" /> : <div className="admin-party-slot-portrait admin-party-slot-portrait--empty" />}
                  <div className="admin-party-slot-name">{mon.nickname}</div>
                  <div className="admin-party-slot-sub">{mon.catalogName ?? mon.catalogId} · Lv {mon.level}</div>
                  <button className="btn btn--secondary btn--sm" type="button" disabled={busy} onClick={() => clearSlot(mon)}>Remove</button>
                </>
              ) : (
                <div className="admin-party-slot-empty">Empty</div>
              )}
            </div>
          );
        })}
      </div>

      <h3 className="admin-subheading">Roster ({roster.length})</h3>
      <form
        className="admin-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const catalogId = formData.get('catalogId');
          if (typeof catalogId === 'string' && catalogId.trim()) {
            void spawnMutation.mutate(catalogId.trim());
            event.currentTarget.reset();
          }
        }}
      >
        <Field label="Spawn from Catalog ID">
          <input className="input" name="catalogId" placeholder="skb-1" />
        </Field>
        <button className="btn btn--sm" type="submit" disabled={spawnMutation.isPending}>Spawn</button>
      </form>

      <div className="admin-roster-grid">
        {rosterQuery.isPending ? (
          <AdminMessage tone="muted">Loading roster…</AdminMessage>
        ) : roster.length === 0 ? (
          <AdminMessage tone="muted">No Digimon on this account.</AdminMessage>
        ) : (
          [
            ...roster.filter((mon) => mon.status === 'party').sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)),
            ...nonPartyRoster,
          ].map((mon) => (
            <RosterCard
              key={mon.id}
              mon={mon}
              partyBySlot={partyBySlot}
              busy={busy}
              onAssign={(slot) => assignToSlot(mon, slot)}
              onClear={() => clearSlot(mon)}
              onUpdate={(input) => void updateMutation.mutate({ monId: mon.id, input })}
              onDelete={() => {
                if (window.confirm(`Delete "${mon.nickname}"? This cannot be undone.`)) void deleteMutation.mutate(mon.id);
              }}
            />
          ))
        )}
      </div>
    </>
  );
}

function RosterCard({ mon, partyBySlot, busy, onAssign, onClear, onUpdate, onDelete }: {
  readonly mon: AdminRosterView;
  readonly partyBySlot: ReadonlyMap<number, AdminRosterView>;
  readonly busy: boolean;
  readonly onAssign: (slot: number) => void;
  readonly onClear: () => void;
  readonly onUpdate: (input: RosterInput) => void;
  readonly onDelete: () => void;
}): JSX.Element {
  const [nickname, setNickname] = useState(mon.nickname);
  const [level, setLevel] = useState(String(mon.level));
  useEffect(() => { setNickname(mon.nickname); }, [mon.id, mon.nickname]);
  useEffect(() => { setLevel(String(mon.level)); }, [mon.id, mon.level]);

  const inParty = mon.status === 'party';
  const currentSlot = inParty ? mon.slot : null;

  const commitNickname = (): void => {
    const trimmed = nickname.trim();
    if (trimmed && trimmed !== mon.nickname) onUpdate({ nickname: trimmed });
  };
  const commitLevel = (): void => {
    const parsed = Number(level);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed !== mon.level) onUpdate({ level: parsed });
  };
  const setStatus = (status: AdminRosterStatus): void => {
    if (status === mon.status) return;
    if (status === 'party') return; // party assignment is via slot buttons
    onUpdate({ status, slot: null });
  };

  return (
    <div className={`admin-roster-card${inParty ? ' is-party' : ''}`}>
      <div className="admin-roster-card-head">
        {mon.catalogPortrait ? <img src={mon.catalogPortrait} alt="" width={44} height={44} /> : <div className="admin-roster-card-portrait-empty" />}
        <div className="admin-roster-card-titles">
          <input
            className="input admin-roster-nickname"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            onBlur={commitNickname}
            aria-label="Nickname"
          />
          <div className="admin-roster-card-sub">{mon.catalogName ?? mon.catalogId}</div>
        </div>
        <div className="admin-roster-card-status">
          <span className={`badge badge--${mon.status}`}>{mon.status}</span>
          {inParty && currentSlot !== null ? <span className="badge">Slot {currentSlot + 1}</span> : null}
        </div>
      </div>

      <div className="admin-roster-card-stats">
        <label className="admin-roster-field">
          <span>Lv</span>
          <input
            className="input"
            type="number"
            min={1}
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            onBlur={commitLevel}
          />
        </label>
        <div className="admin-roster-stat">
          <span className="lbl">Mood</span>
          <span className="val">{mon.mood}</span>
        </div>
        <div className="admin-roster-stat">
          <span className="lbl">XP</span>
          <span className="val">{mon.xp}</span>
        </div>
      </div>

      <div className="admin-roster-card-actions">
        <div className="admin-roster-slot-group" role="group" aria-label="Party slot">
          {[0, 1, 2].map((slot) => {
            const occupant = partyBySlot.get(slot);
            const isMe = occupant?.id === mon.id;
            const willReplace = occupant !== undefined && !isMe;
            const label = isMe ? `● ${slot + 1}` : `${slot + 1}`;
            return (
              <button
                key={slot}
                type="button"
                className={`btn btn--sm${isMe ? ' btn--primary' : ' btn--secondary'}`}
                disabled={busy || isMe}
                title={willReplace ? `Replace ${occupant.nickname} in slot ${slot + 1}` : `Assign to slot ${slot + 1}`}
                onClick={() => onAssign(slot)}
              >
                {label}
              </button>
            );
          })}
          {inParty ? (
            <button className="btn btn--sm btn--secondary" type="button" disabled={busy} onClick={onClear}>
              Bench
            </button>
          ) : null}
        </div>
        <div className="admin-roster-status-group" role="group" aria-label="Roster status">
          {(['resting', 'training'] as const).map((status) => (
            <button
              key={status}
              type="button"
              className={`btn btn--sm${mon.status === status ? ' btn--primary' : ' btn--secondary'}`}
              disabled={busy || mon.status === status}
              onClick={() => setStatus(status)}
            >
              {status}
            </button>
          ))}
        </div>
        <button className="btn btn--sm btn--danger" type="button" disabled={busy} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
