import { Digdex } from '../../routes/Digdex';
import '../../styles/extensions-dungeon.css';
import '../../styles/extensions-digdex.css';

type DigidexPanelProps = {
  readonly sub?: string;
};

export function DigidexPanel({ sub }: DigidexPanelProps): JSX.Element {
  return (
    <div className="digidex-panel">
      <Digdex />
    </div>
  );
}
