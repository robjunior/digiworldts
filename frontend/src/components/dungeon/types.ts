export type LogEntry = {
  readonly text: string;
  readonly cls: '' | 'hit' | 'item';
  readonly step: number;
};

export type PendingUnlock = {
  readonly doorId: string;
  readonly keyItemId: string;
};
