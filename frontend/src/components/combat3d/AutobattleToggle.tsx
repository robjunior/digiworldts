export function AutobattleToggle({ on, onToggle }: { readonly on: boolean; readonly onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="auto-toggle"
      aria-pressed={on}
      onClick={onToggle}
    >
      <span className="dot" style={{ background: on ? 'var(--signal)' : 'transparent' }}></span>Auto: {on ? 'On' : 'Off'}
    </button>
  );
}