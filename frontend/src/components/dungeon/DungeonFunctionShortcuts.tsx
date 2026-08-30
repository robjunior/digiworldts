import type { ReactElement } from 'react';
import {
  CharacterIcon,
  DigidexIcon,
  FriendsIcon,
  GuildIcon,
  InventoryIcon,
  MapIcon,
  QuestsIcon,
  RosterIcon,
} from './icons';

type FnItem = {
  readonly id: string;
  readonly label: string;
  readonly soon: boolean;
  readonly sub: string;
  readonly icon: ReactElement;
};

const ITEMS: readonly FnItem[] = [
  { id: 'roster', label: 'Roster', soon: false, sub: 'Seus Digimon e a party ativa.', icon: <RosterIcon /> },
  { id: 'digidex', label: 'DigiDex', soon: false, sub: 'Códice de espécies capturadas.', icon: <DigidexIcon /> },
  { id: 'quests', label: 'Quests', soon: false, sub: 'Missões ativas e recompensas.', icon: <QuestsIcon /> },
  { id: 'inventory', label: 'Inventário', soon: false, sub: 'Itens, consumíveis e equip.', icon: <InventoryIcon /> },
  { id: 'character', label: 'Personagem', soon: false, sub: 'Status do Tamer e atributos.', icon: <CharacterIcon /> },
  { id: 'map', label: 'Mapa Mundi', soon: false, sub: 'O mundo e regiões liberadas.', icon: <MapIcon /> },
  { id: 'friends', label: 'Amigos', soon: true, sub: 'Lista de amigos e presença.', icon: <FriendsIcon /> },
  { id: 'guild', label: 'Guilda', soon: true, sub: 'Sua guilda e membros.', icon: <GuildIcon /> },
];

export type DungeonFunctionShortcutsProps = {
  readonly onOpen: (id: string) => void;
};

export function DungeonFunctionShortcuts({ onOpen }: DungeonFunctionShortcutsProps): ReactElement {
  return (
    <div className="fn-rail">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="fn-btn"
          aria-label={item.label}
          title={item.label}
          onClick={() => onOpen(item.id)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            {item.icon}
          </svg>
          <span className="tip">
            {item.label}
            {item.soon ? ' · Em breve' : ''}
          </span>
        </button>
      ))}
    </div>
  );
}
