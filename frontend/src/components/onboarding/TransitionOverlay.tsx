type TransitionOverlayProps = {
  readonly active: boolean;
};

export function TransitionOverlay({ active }: TransitionOverlayProps): JSX.Element {
  return <div id="transition-overlay" className={active ? 'is-active' : undefined} />;
}
