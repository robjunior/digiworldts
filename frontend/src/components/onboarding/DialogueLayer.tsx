type DialogueLayerProps = {
  readonly paragraphs: readonly string[];
  readonly visible: boolean;
  readonly dismissed: boolean;
  readonly onSkip: () => void;
};

export function DialogueLayer({ paragraphs, visible, dismissed, onSkip }: DialogueLayerProps): JSX.Element {
  const layerClassName = [visible ? '' : 'hidden', dismissed ? 'is-hidden' : ''].filter(Boolean).join(' ');
  const actionDelay = paragraphs.length > 1 ? `${paragraphs.length * 1.5}s` : undefined;

  return (
    <div id="dialogue-layer" className={layerClassName}>
      <div className="dialog-panel" id="dialogue-content">
        {paragraphs.map((paragraph, index) => (
          <p key={paragraph} style={{ animationDelay: `${index * 1.5}s` }}>
            {renderLines(paragraph)}
          </p>
        ))}
      </div>
      <div className={paragraphs.length > 1 ? 'dialog-actions' : 'dialog-actions hidden'} id="dialogue-actions" style={{ animationDelay: actionDelay }}>
        <button className="btn btn--secondary" type="button" onClick={onSkip}>
          Skip Intro
        </button>
      </div>
    </div>
  );
}

function renderLines(paragraph: string): readonly JSX.Element[] {
  return paragraph.split('\n').map((line, index) => (
    <span key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}
