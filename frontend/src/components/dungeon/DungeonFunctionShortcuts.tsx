import type { ReactElement } from 'react';

type FnItem = {
  readonly id: string;
  readonly label: string;
  readonly soon: boolean;
  readonly sub: string;
  readonly icon: string;
};

const ITEMS: readonly FnItem[] = [
  { id: 'roster', label: 'Roster', soon: false, sub: 'Seus Digimon e a party ativa.', icon: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 5.5a3 3 0 0 1 0 5.4M18 19c0-2.4-1.4-4.3-3.4-5"/>' },
  { id: 'digidex', label: 'DigiDex', soon: false, sub: 'Códice de espécies capturadas.', icon: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 3v18M4 7.5l8 4.5 8-4.5"/>' },
  { id: 'quests', label: 'Quests', soon: false, sub: 'Missões ativas e recompensas.', icon: '<path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z"/><path d="M9.5 12l1.8 1.8L15 10"/>' },
  { id: 'inventory', label: 'Inventário', soon: false, sub: 'Itens, consumíveis e equip.', icon: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>' },
  { id: 'character', label: 'Personagem', soon: false, sub: 'Status do Tamer e atributos.', icon: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21c0-3.5 3-6 7-6s7 2.5 7 6"/>' },
  { id: 'map', label: 'Mapa Mundi', soon: false, sub: 'O mundo e regiões liberadas.', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5S14.5 18.1 12 20.5C9.5 18.1 8.2 15.1 8.2 12S9.5 5.9 12 3.5z"/>' },
  { id: 'friends', label: 'Amigos', soon: true, sub: 'Lista de amigos e presença.', icon: '<path d="M12 21C7 17 4 13.5 4 10a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 3.5-3 7-8 11z"/>' },
  { id: 'guild', label: 'Guilda', soon: true, sub: 'Sua guilda e membros.', icon: '<path d="M3 20V10l5 3V10l5 3V6l6 4v10z"/><path d="M7 20v-4M12 20v-4M17 20v-4"/>' },
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
