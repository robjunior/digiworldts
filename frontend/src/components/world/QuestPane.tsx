import type { CSSProperties, ReactNode } from 'react';

import type { QuestObjective, QuestObjectiveProgress, QuestWithProgress, UserQuestState } from '@digiworld/shared/quest';
import type { Biome, WorldRegion } from '@digiworld/shared/world';
import { BIOME_ELEMENT, BIOME_LABEL, BIOMES } from '@digiworld/shared/world';

const BIOME_SET: ReadonlySet<string> = new Set(BIOMES);

const STATE_LABEL: Record<UserQuestState, string> = {
  active: 'Active',
  available: 'Available',
  completed: 'Completed',
  claimed: 'Claimed',
  locked: 'Locked',
};

const STATE_ORDER: Record<UserQuestState, number> = {
  active: 0,
  completed: 1,
  available: 2,
  locked: 3,
  claimed: 4,
};

type QuestPaneProps = {
  readonly quests: readonly QuestWithProgress[];
  readonly regions: readonly WorldRegion[];
  readonly loading: boolean;
  readonly onAreaClick: (biome: Biome) => void;
  readonly onAccept: (questId: string) => void;
  readonly onClaim: (questId: string) => void;
  readonly onLocate: (biome: Biome) => void;
  readonly pendingIds: ReadonlySet<string>;
};

export function QuestPane({ quests, regions, loading, onAreaClick, onAccept, onClaim, onLocate, pendingIds }: QuestPaneProps): JSX.Element {
  const biomeMeta = new Map<string, WorldRegion>();
  for (const r of regions) biomeMeta.set(r.biome, r);

  const activeCount = quests.filter((q) => q.state === 'active').length;
  const sorted = [...quests].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);

  return (
    <>
      <div className="rhead">
        <div className="rt">Quests</div>
        <div className="rs"><b>{activeCount}</b> active · click an <b>area</b> in a quest to find it on the globe</div>
      </div>
      <div className="qlist" role="log" aria-label="Quest log">
        {loading ? (
          <div className="rempty">Loading quests…</div>
        ) : sorted.length === 0 ? (
          <div className="rempty">No quests available yet. Talk to the Tamer Guild.</div>
        ) : (
          sorted.map((q) => (
            <QuestCard
              key={q.id}
              quest={q}
              biomeMeta={biomeMeta}
              busy={pendingIds.has(q.id)}
              onAreaClick={onAreaClick}
              onAccept={onAccept}
              onClaim={onClaim}
              onLocate={onLocate}
            />
          ))
        )}
      </div>
    </>
  );
}

type QuestCardProps = {
  readonly quest: QuestWithProgress;
  readonly biomeMeta: ReadonlyMap<string, WorldRegion>;
  readonly busy: boolean;
  readonly onAreaClick: (biome: Biome) => void;
  readonly onAccept: (questId: string) => void;
  readonly onClaim: (questId: string) => void;
  readonly onLocate: (biome: Biome) => void;
};

function QuestCard({ quest, biomeMeta, busy, onAreaClick, onAccept, onClaim, onLocate }: QuestCardProps): JSX.Element {
  const done = quest.objectives.filter((o) => o.doneAt !== null).length;
  const total = quest.objectives.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const firstUnfinished = quest.objectives.find((o) => o.doneAt === null);
  const firstUnfinishedBiome = firstUnfinished !== undefined
    && (firstUnfinished.kind === 'travel' || firstUnfinished.kind === 'defeat')
    ? firstUnfinished.biome
    : null;
  const showProgress = quest.state === 'active' || quest.state === 'completed';

  return (
    <article className={`qcard is-${quest.state}`} aria-label={`Quest ${quest.name}, ${STATE_LABEL[quest.state]}`}>
      <div className="qhd">
        <span className="qnm">
          {quest.name}
          <span className="qk">{quest.giver}</span>
        </span>
        <span className="qstate">{STATE_LABEL[quest.state]}</span>
      </div>

      <div className="qobj">
        {quest.objectives.map((obj, i) => (
          <ObjectiveRow key={i} obj={obj} biomeMeta={biomeMeta} onAreaClick={onAreaClick} />
        ))}
      </div>

      {showProgress && total > 0 ? (
        <div className="qprog">
          <div className="pl"><span>Progress</span><b>{done}/{total}</b></div>
          <div className="pbar"><i style={{ width: `${pct}%` } as CSSProperties} /></div>
        </div>
      ) : null}

      <QuestFooter
        quest={quest}
        busy={busy}
        firstUnfinishedBiome={firstUnfinishedBiome}
        onAccept={onAccept}
        onClaim={onClaim}
        onLocate={onLocate}
      />
    </article>
  );
}

function ObjectiveRow({
  obj,
  biomeMeta,
  onAreaClick,
}: {
  readonly obj: QuestObjective & QuestObjectiveProgress;
  readonly biomeMeta: ReadonlyMap<string, WorldRegion>;
  readonly onAreaClick: (biome: Biome) => void;
}): JSX.Element {
  const done = obj.doneAt !== null;
  const progressLabel = obj.kind === 'defeat' ? `${obj.counter}/${obj.count}` : done ? '✓' : '—';
  return (
    <div className={`qo${done ? ' done' : ''}`}>
      <span className="qtick" aria-hidden="true">
        {done ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
            <path d="M5 13l4 4L19 7" />
          </svg>
        ) : null}
      </span>
      <span className="qtxt">{renderText(obj.text, biomeMeta, onAreaClick)}</span>
      <span className="qn">{progressLabel}</span>
    </div>
  );
}

function QuestFooter({
  quest,
  busy,
  firstUnfinishedBiome,
  onAccept,
  onClaim,
  onLocate,
}: {
  readonly quest: QuestWithProgress;
  readonly busy: boolean;
  readonly firstUnfinishedBiome: Biome | null;
  readonly onAccept: (questId: string) => void;
  readonly onClaim: (questId: string) => void;
  readonly onLocate: (biome: Biome) => void;
}): JSX.Element {
  if (quest.state === 'locked') {
    return (
      <div className="qlock">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <span>{quest.lockHint ?? 'Locked'}</span>
      </div>
    );
  }
  if (quest.state === 'completed') {
    return (
      <div className="qfoot">
        <span className="qrew"><b>Reward:</b> {quest.rewardText}</span>
        <button
          className="qbtn"
          type="button"
          disabled={busy}
          onClick={() => onClaim(quest.id)}
        >
          Claim
        </button>
      </div>
    );
  }
  if (quest.state === 'available') {
    return (
      <div className="qfoot">
        <span className="qrew"><b>Reward:</b> {quest.rewardText}</span>
        <button
          className="qbtn"
          type="button"
          disabled={busy}
          onClick={() => onAccept(quest.id)}
        >
          Accept
        </button>
      </div>
    );
  }
  return (
    <div className="qfoot">
      <span className="qrew"><b>Reward:</b> {quest.rewardText}</span>
      <button
        className="qbtn ghost"
        type="button"
        disabled={firstUnfinishedBiome === null}
        onClick={() => firstUnfinishedBiome !== null && onLocate(firstUnfinishedBiome)}
      >
        Locate
      </button>
    </div>
  );
}

function renderText(
  text: string,
  biomeMeta: ReadonlyMap<string, WorldRegion>,
  onAreaClick: (biome: Biome) => void,
): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\[\[(\w+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const biomeId = match[1] as Biome;
    if (!BIOME_SET.has(biomeId)) {
      parts.push(match[0]);
    } else {
      const region = biomeMeta.get(biomeId);
      const label = region?.label ?? BIOME_LABEL[biomeId] ?? biomeId;
      const element = region?.element ?? BIOME_ELEMENT[biomeId] ?? 'null';
      parts.push(
        <button
          key={`${match.index}-${biomeId}`}
          type="button"
          className="qarea"
          style={{ '--ael': `var(--el-${element})` } as CSSProperties}
          onClick={() => onAreaClick(biomeId)}
          aria-label={`Go to ${label} on the globe`}
        >
          {label}
        </button>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
