import type { WorldObject } from '../../lib/api-world';

type WorldObjectHintProps = {
  readonly object: WorldObject | null;
};

export function WorldObjectHint({ object }: WorldObjectHintProps): JSX.Element | null {
  if (object === null) {
    return null;
  }

  const title = object.label ?? object.kind;

  return (
    <section className="world-object-hint" aria-label="Nearby quest object">
      <div className="world-object-hint__eyebrow">Adjacent signal</div>
      <div className="world-object-hint__title">{title}</div>
      <button className="world-object-hint__button" type="button" onClick={() => console.info('world.object.approach', { id: object.id, questId: object.questId })}>
        Approach
      </button>
    </section>
  );
}
