export type DigiCreditsProps = {
  readonly value: number;
  readonly title?: string;
};

export function DigiCredits({ value, title }: DigiCreditsProps): JSX.Element {
  const rounded = Math.round(value);
  const display = rounded.toLocaleString();
  return (
    <span
      className="digi-credits"
      role="status"
      aria-label={`${display} DigiCredits`}
      title={title ?? `${display} DigiCredits`}
      data-od-id="digi-credits"
    >
      <span className="dc-mark" aria-hidden="true" />
      <b className="dc-val">{display}</b>
      <span className="dc-lbl">DGC</span>
    </span>
  );
}
