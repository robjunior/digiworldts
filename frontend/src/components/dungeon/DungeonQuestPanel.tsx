import type { ReactElement } from 'react';
import type { QuestWithProgress } from '@digiworld/shared';

type DungeonQuestPanelProps = {
  readonly quest: QuestWithProgress | null;
};

export function DungeonQuestPanel({ quest }: DungeonQuestPanelProps): ReactElement {
  if (!quest) {
    return (
      <div className="dp-quest" style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
        <div className="rhead">
          <div className="rt">Quest</div>
          <div className="rs">No quest tied to this dungeon.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dp-quest" style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      <div className="rhead">
        <div className="rt">Quest</div>
        <div className="rs">
          <b>{quest.name}</b>
        </div>
      </div>
      <div className="log" role="log" style={{ color: 'var(--ink)' }}>
        <p style={{ margin: '0 0 12px 0', font: '600 11px/1.45 var(--font)', color: 'var(--muted)' }}>
          {quest.description}
        </p>
        <div className="quest-objectives" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {quest.objectives.map((obj, i) => {
            const isDone = obj.doneAt !== null;
            return (
              <div key={i} className={`lrow ${isDone ? 'item' : ''}`} style={{ opacity: isDone ? 0.6 : 1 }}>
                <span className="lt" style={{ minWidth: 20 }}>{isDone ? '✓' : '○'}</span>
                <span className="lx">
                  {obj.text}
                  {obj.kind === 'defeat' && obj.count > 1 && (
                    <span style={{ marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
                      ({obj.counter}/{obj.count})
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {quest.rewardText && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--hair)', font: '600 11px/1.45 var(--font)' }}>
            <span style={{ color: 'var(--muted)' }}>Reward:</span> <b>{quest.rewardText}</b>
          </div>
        )}
      </div>
    </div>
  );
}
