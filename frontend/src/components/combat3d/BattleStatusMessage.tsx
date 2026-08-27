import { memo } from 'react';

/**
 * Renders a battle error banner (e.g. a failed world-battle dispatch) or
 * nothing when there is no error.
 */
export const BattleStatusMessage = memo(function BattleStatusMessage({
  error,
}: {
  error: string | null;
}): JSX.Element | null {
  if (error === null) return null;
  return (
    <div
      className="box"
      style={{
        position: 'absolute',
        zIndex: 50,
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        color: 'var(--signal)',
      }}
    >
      {error}
    </div>
  );
});
