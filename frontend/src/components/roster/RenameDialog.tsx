import { useEffect, useState } from 'react';

import type { RosterMon } from './types';

export function RenameDialog({ mon, busy, onClose, onSave }: { readonly mon: RosterMon | null; readonly busy: boolean; readonly onClose: () => void; readonly onSave: (nickname: string) => void }): JSX.Element {
  const [nickname, setNickname] = useState('');
  useEffect(() => setNickname(mon?.nickname ?? ''), [mon]);
  return (
    <div className={`modal-overlay ${mon ? 'show' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card roster-rename-card">
        <div className="modal-header">
          <h3>Rename {mon?.nickname ?? 'Digimon'}</h3>
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <label className="field">
          Nickname
          <input className="input" value={nickname} maxLength={24} onChange={(event) => setNickname(event.currentTarget.value)} />
        </label>
        <div className="modal-actions">
          <button className="btn btn--secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn" type="button" disabled={busy || nickname.trim().length === 0} onClick={() => onSave(nickname.trim())}>Save</button>
        </div>
      </div>
    </div>
  );
}
