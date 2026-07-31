import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DIALOGUE_END_NODE } from '@digiworld/shared';
import type { DialogueDefinition, DialogueNode, DialogueTextPart } from '@digiworld/shared';

export type DialogueVariables = Readonly<Record<string, string | number | boolean>>;

type DialogueOverlayProps = {
  readonly definition: DialogueDefinition;
  readonly variables?: DialogueVariables;
  readonly speakerName?: (npcId: string) => string;
  readonly onClose: () => void;
};

function renderText(parts: readonly DialogueTextPart[], variables: DialogueVariables): string {
  return parts
    .map((part) => (part.kind === 'text' ? part.value : String(variables[part.name] ?? `{${part.name}}`)))
    .join('');
}

/**
 * Walks jumps before showing a node. Conditions are not evaluated here: this
 * slice ships navigation and rendering only, so an unconditional jump is
 * followed and a conditional one is ignored. When the server-side cursor
 * lands, both jumps and choice gating move behind the advance endpoint.
 */
function resolveNode(definition: DialogueDefinition, nodeId: string): DialogueNode | null {
  const seen = new Set<string>();
  let current = nodeId;
  for (;;) {
    if (current === DIALOGUE_END_NODE || seen.has(current)) return null;
    seen.add(current);
    const node = definition.nodes[current];
    if (node === undefined) return null;
    const unconditional = node.jumps.find((jump) => jump.condition === null);
    if (unconditional === undefined) return node;
    current = unconditional.target;
  }
}

export function DialogueOverlay({ definition, variables = {}, speakerName, onClose }: DialogueOverlayProps): JSX.Element | null {
  const [nodeId, setNodeId] = useState(definition.startNodeId);

  useEffect(() => { setNodeId(definition.startNodeId); }, [definition]);

  const node = useMemo(() => resolveNode(definition, nodeId), [definition, nodeId]);

  const advance = useCallback((target: string): void => {
    if (target === DIALOGUE_END_NODE || definition.nodes[target] === undefined) {
      onClose();
      return;
    }
    setNodeId(target);
  }, [definition, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (node === null) return null;

  const speaker = node.speaker;
  const label = speaker === null ? null : speakerName?.(speaker.npcId) ?? speaker.npcId;
  const body = renderText(node.text, variables);

  return (
    <div className="dlg-overlay" role="dialog" aria-modal="true" aria-label={label ?? 'Dialogue'}>
      <div className="dlg-frame">
        {speaker !== null ? (
          <div className="dlg-portrait" data-expression={speaker.expression}>
            <img
              src={`/assets/npc/${speaker.npcId}/${speaker.expression}.png`}
              alt=""
              onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }}
            />
          </div>
        ) : null}

        <div className="dlg-window">
          {label !== null ? <div className="dlg-speaker">{label}</div> : null}
          <p className="dlg-text">{body}</p>

          {node.choices.length > 0 ? (
            <ul className="dlg-choices">
              {node.choices.map((choice) => (
                <li key={choice.id}>
                  <button type="button" className="dlg-choice" onClick={() => advance(choice.target)}>
                    {choice.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <button type="button" className="dlg-choice dlg-continue" onClick={onClose}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
