import type { ReactElement } from 'react';

export const ICON_SIZE = 24;
export const ICON_STROKE = 1.7;

function Icon({ children }: { readonly children: ReactElement | readonly ReactElement[] }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={ICON_SIZE}
      height={ICON_SIZE}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function RosterIcon(): ReactElement {
  return (
    <Icon>
      <circle cx="9" cy="7" r="3.2" />
      <path d="M3 18.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.5a3 3 0 0 1 0 5.4" />
      <path d="M18 18.5c0-2.4-1.4-4.3-3.4-5" />
    </Icon>
  );
}

export function DigidexIcon(): ReactElement {
  return (
    <Icon>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 3v18" />
      <path d="M4 7.5l8 4.5 8-4.5" />
    </Icon>
  );
}

export function QuestsIcon(): ReactElement {
  return (
    <Icon>
      <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </Icon>
  );
}

export function InventoryIcon(): ReactElement {
  return (
    <Icon>
      <path d="M8 4h8l2 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8z" />
      <path d="M6 8h12M10 12h4" strokeLinecap="round" />
    </Icon>
  );
}

export function ReviveIcon(): ReactElement {
  return (
    <Icon>
      <path d="M12 21s-8-5.5-8-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.5-8 11-8 11z" />
      <path d="M9 12h6M12 9v6" strokeLinecap="round" />
    </Icon>
  );
}

export function XpIcon(): ReactElement {
  return (
    <Icon>
      <path d="M12 3l2.4 6.6L21 11l-5 4.5L17.4 22 12 18.5 6.6 22 8 15.5 3 11l6.6-1.4z" />
    </Icon>
  );
}

export function CharacterIcon(): ReactElement {
  return (
    <Icon>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5 18.5c0-3.5 3-6 7-6s7 2.5 7 6" />
    </Icon>
  );
}

export function MapIcon(): ReactElement {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5S14.5 18.1 12 20.5C9.5 18.1 8.2 15.1 8.2 12S9.5 5.9 12 3.5z" />
    </Icon>
  );
}

export function FriendsIcon(): ReactElement {
  return (
    <Icon>
      <circle cx="6" cy="7" r="3" />
      <path d="M2 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="18" cy="7" r="3" />
      <path d="M14 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    </Icon>
  );
}

export function GuildIcon(): ReactElement {
  return (
    <Icon>
      <path d="M3 20V10l5 3V10l5 3V6l6 4v10z" />
      <path d="M7 20v-4" />
      <path d="M12 20v-4" />
      <path d="M17 20v-4" />
    </Icon>
  );
}

export function ChatIcon(): ReactElement {
  return (
    <Icon>
      <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.8A8 8 0 1 1 21 12z" />
    </Icon>
  );
}

export function LeaveIcon(): ReactElement {
  return (
    <Icon>
      <path d="M15 5l-7 7 7 7" />
      <path d="M21 12H8" />
    </Icon>
  );
}
