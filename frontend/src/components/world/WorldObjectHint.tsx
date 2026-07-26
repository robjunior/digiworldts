import type { WorldObject } from '../../lib/api-world';
import { useNavigate } from 'react-router';

type WorldObjectHintProps = {
  readonly object: WorldObject | null;
};

export function WorldObjectHint({ object }: WorldObjectHintProps): JSX.Element | null {
  const navigate = useNavigate();
  if (object === null) {
    return (
      <div className="rdetail" id="rdetail">
        <div className="rempty">Explore to discover points of interest.</div>
      </div>
    );
  }

  const title = object.label ?? object.kind;

  return (
    <div className="rdetail" id="rdetail">
      <div className="dk">Adjacent Signal</div>
      <h3>{title}</h3>
      <div className="dmeta" style={{ '--el': 'var(--el-light)' } as React.CSSProperties}>
        <span className="rchip"><span className="cx"></span>Object</span>
      </div>
      <div className="dblurb">You detected a {object.kind} nearby.</div>
      <div className="dgauge">
        <div className="gl"><span>Range</span><b>1 / 5</b></div>
        <div className="gbar"><i style={{ width: '20%' }}></i></div>
      </div>
      <button className="dbtn" type="button" onClick={() => {
          if (object.dungeonId) navigate(`/dungeon/${object.dungeonId}`);
          else console.info('world.object.approach', { id: object.id, questId: object.questId, dungeonId: object.dungeonId });
        }}>
        Approach
      </button>
    </div>
  );
}
