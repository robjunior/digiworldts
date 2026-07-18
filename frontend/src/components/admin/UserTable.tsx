import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getUserRoster, getUsers, spawnRosterMon, updateUserCredits, updateUserFlags, type AdminRosterView, type UserListEntry } from '../../lib/api-admin';
import { AdminMessage, AdminSection, ErrorText, Field } from './AdminShared';

const USERS_QUERY_KEY = ['admin', 'users'] as const;
const USER_LIMIT = 25;

export function UserTable(): JSX.Element {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedUser, setSelectedUser] = useState<UserListEntry | null>(null);
  const usersQuery = useQuery({ queryKey: [...USERS_QUERY_KEY, query, offset], queryFn: () => getUsers({ q: query, limit: USER_LIMIT, offset }) });
  const flagsMutation = useMutation({ mutationFn: (input: UserFlagMutationInput) => updateUserFlags(input.id, toFlags(input)), onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }) });
  const creditsMutation = useMutation({ mutationFn: ({ id, credits }: { readonly id: string; readonly credits: number }) => updateUserCredits(id, credits), onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }) });
  const users = usersQuery.data?.users ?? [];
  const rosterUserId = selectedUser?.id ?? users[0]?.id ?? null;

  return (
    <div className="admin-two-column">
      <AdminSection title="Users" lede="Search accounts, toggle flags, and set wallet credits.">
        <ErrorText error={usersQuery.error ?? flagsMutation.error ?? creditsMutation.error} />
        <div className="admin-filter-bar">
          <Field label="Search users"><input className="input" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="username" /></Field>
        </div>
        <div className="admin-scroll">
          <table className="admin-table">
            <thead><tr><th>User</th><th>Admin</th><th>Disabled</th><th>Credits</th><th>Mons</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <UserRow key={user.id} user={user} selected={user.id === rosterUserId} busy={flagsMutation.isPending || creditsMutation.isPending} onSelect={() => setSelectedUser(user)} onFlags={(flags) => void flagsMutation.mutate({ id: user.id, ...flags })} onCredits={(credits) => void creditsMutation.mutate({ id: user.id, credits })} />
              ))}
            </tbody>
          </table>
        </div>
        {usersQuery.isPending ? <AdminMessage tone="muted">Loading users…</AdminMessage> : null}
        <div className="admin-pager">
          <button className="btn btn--secondary btn--sm" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - USER_LIMIT))}>Previous</button>
          <span>{usersQuery.data ? `${offset + 1}-${Math.min(offset + USER_LIMIT, usersQuery.data.total)} of ${usersQuery.data.total}` : '—'}</span>
          <button className="btn btn--secondary btn--sm" type="button" disabled={usersQuery.data?.hasMore !== true} onClick={() => setOffset(offset + USER_LIMIT)}>Next</button>
        </div>
      </AdminSection>
      {rosterUserId ? <UserRoster userId={rosterUserId} /> : <AdminMessage tone="muted">Select a user to inspect roster.</AdminMessage>}
    </div>
  );
}

function UserRow({ user, selected, busy, onSelect, onFlags, onCredits }: { readonly user: UserListEntry; readonly selected: boolean; readonly busy: boolean; readonly onSelect: () => void; readonly onFlags: (flags: { readonly isAdmin?: boolean; readonly disabled?: boolean }) => void; readonly onCredits: (credits: number) => void }): JSX.Element {
  const [credits, setCredits] = useState(String(user.credits));
  return (
    <tr className={selected ? 'is-selected' : undefined}>
      <td><button className="admin-link-button" type="button" onClick={onSelect}>{user.displayName}<span>{user.username}</span></button></td>
      <td><input type="checkbox" checked={user.isAdmin} disabled={busy} onChange={(event) => onFlags({ isAdmin: event.target.checked })} aria-label={`Toggle admin for ${user.username}`} /></td>
      <td><input type="checkbox" checked={user.disabled} disabled={busy} onChange={(event) => onFlags({ disabled: event.target.checked })} aria-label={`Toggle disabled for ${user.username}`} /></td>
      <td><input className="input admin-credit-input" value={credits} onChange={(event) => setCredits(event.target.value)} onBlur={() => onCredits(Number(credits))} /></td>
      <td>{user.monCount}</td>
      <td><button className="btn btn--secondary btn--sm" type="button" onClick={onSelect}>Roster</button></td>
    </tr>
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

function UserRoster({ userId }: { readonly userId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const rosterQuery = useQuery({ queryKey: ['admin', 'user-roster', userId], queryFn: () => getUserRoster(userId) });
  const spawnMutation = useMutation({ mutationFn: (catalogId: string) => spawnRosterMon(userId, { catalogId }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'user-roster', userId] }) });
  const roster = rosterQuery.data?.roster ?? [];
  return (
    <AdminSection title="Player Digimon" lede="Inspect roster entries and spawn a catalog template by ID.">
      <ErrorText error={rosterQuery.error ?? spawnMutation.error} />
      <form className="admin-inline-form" onSubmit={(event) => { event.preventDefault(); const catalogId = new FormData(event.currentTarget).get('catalogId'); if (typeof catalogId === 'string' && catalogId.trim()) void spawnMutation.mutate(catalogId.trim()); }}>
        <Field label="Catalog ID"><input className="input" name="catalogId" placeholder="skb-1" /></Field>
        <button className="btn btn--sm" type="submit" disabled={spawnMutation.isPending}>Spawn</button>
      </form>
      <div className="admin-scroll compact">
        <table className="admin-table">
          <thead><tr><th>Mon</th><th>Catalog</th><th>Level</th><th>Mood</th><th>Status</th></tr></thead>
          <tbody>{roster.map((mon) => <RosterRow key={mon.id} mon={mon} />)}</tbody>
        </table>
      </div>
    </AdminSection>
  );
}

function RosterRow({ mon }: { readonly mon: AdminRosterView }): JSX.Element {
  return (
    <tr>
      <td>{mon.catalogPortrait ? <img src={mon.catalogPortrait} alt="" width="36" height="36" /> : null}{mon.nickname}</td>
      <td>{mon.catalogName ?? mon.catalogId}</td>
      <td>{mon.level}</td>
      <td>{mon.mood}</td>
      <td><span className="badge">{mon.status}{mon.slot === null ? '' : ` · ${mon.slot}`}</span></td>
    </tr>
  );
}
