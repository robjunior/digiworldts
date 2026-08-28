import { useQuery } from '@tanstack/react-query';
import { getFriends, type FriendsResponse } from '../../lib/api';

type FriendsPanelProps = {
  readonly sub?: string;
};

export function FriendsPanel({ sub }: FriendsPanelProps): JSX.Element {
  const { data, isLoading, error } = useQuery<FriendsResponse>({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 30_000,
  });

  if (isLoading) return <div className="fn-skeleton" />;
  if (error !== undefined) {
    return <div className="fn-error">Falha ao carregar amigos.</div>;
  }

  const list = data?.friends ?? [];
  return (
    <div className="friends-panel">
      {list.length === 0 ? (
        <div className="friends-empty">Nenhum amigo ainda.</div>
      ) : (
        list.map((friend) => (
          <div key={friend.userId} className="friend-row">
            <span className="friend-name">{friend.displayName}</span>
            <span className={`friend-status ${friend.online ? 'online' : 'offline'}`}>
              {friend.online ? 'Online' : 'Offline'}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
