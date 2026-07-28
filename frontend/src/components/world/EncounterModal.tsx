import type { WorldEncounter } from '../../lib/api-world';

type EncounterModalProps = {
  readonly encounter: WorldEncounter | null;
  readonly message: string | null;
  readonly onDismiss: () => void;
};

export function EncounterModal({ encounter, message, onDismiss }: EncounterModalProps): JSX.Element | null {
  if (encounter?.kind === 'item') {
    return <WorldToast message={`+${encounter.item.qty} ${encounter.item.name}`} onDismiss={onDismiss} />;
  }
  return message ? <WorldToast message={message} onDismiss={onDismiss} /> : null;
}

type WorldToastProps = {
  readonly message: string;
  readonly onDismiss: () => void;
};

function WorldToast({ message, onDismiss }: WorldToastProps): JSX.Element {
  return (
    <div className="toast show" id="toast" role="status" onClick={onDismiss}>
      <span>{message}</span>
    </div>
  );
}
