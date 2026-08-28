import type { RosterView } from '../../lib/api';

type RosterPanelProps = {
  readonly roster: readonly RosterView[];
};

export function RosterPanel({ roster }: RosterPanelProps): JSX.Element {
  return (
    <div className="roster-panel">
      {roster.length === 0 ? (
        <div className="roster-empty">Nenhum Digimon no roster.</div>
      ) : (
        roster.map((mon) => (
          <div key={mon.id} className="roster-row">
            <div className="roster-main">
              <span className="roster-name">{mon.nickname}</span>
              <span className="roster-meta">
                Lv.{mon.level} · {mon.status}
              </span>
            </div>
            <div className="roster-stats">
              <span>HP {mon.currentHp ?? mon.hpMax}/{mon.hpMax}</span>
              <span>EN {mon.currentEn ?? mon.enMax}/{mon.enMax}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
