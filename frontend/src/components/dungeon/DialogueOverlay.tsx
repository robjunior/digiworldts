import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DialogueDefinition, DialogueTextPart } from '@digiworld/shared';

import { abandonDialogueSession, advanceDialogueSession, startDialogueSession, type DialogueView } from '../../lib/api-dialogues';

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

export function DialogueOverlay({ definition, variables = {}, speakerName, onClose }: DialogueOverlayProps): JSX.Element | null {
  const [view, setView] = useState<DialogueView | null>(null);
  const [busy, setBusy] = useState(false);
  /** Stores the src, not a boolean, so the fallback resets itself when the speaker or expression changes. */
  const [failedPortraitSrc, setFailedPortraitSrc] = useState<string | null>(null);
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (startedFor.current === definition.dialogueId) return;
    startedFor.current = definition.dialogueId;
    let cancelled = false;
    void startDialogueSession(definition.dialogueId)
      .then((res) => { if (!cancelled) setView(res.view); })
      .catch(() => { if (!cancelled) onClose(); });
    return () => { cancelled = true; };
  }, [definition.dialogueId, onClose]);

  const leave = useCallback((): void => {
    void abandonDialogueSession().catch(() => undefined);
    onClose();
  }, [onClose]);

  /** Every branch is taken server-side; the click only asks, it never decides. */
  const choose = useCallback((choiceId: string): void => {
    if (busy) return;
    setBusy(true);
    void advanceDialogueSession(definition.dialogueId, choiceId)
      .then((res) => {
        if (res.view.done) onClose();
        else setView(res.view);
      })
      .catch(() => onClose())
      .finally(() => setBusy(false));
  }, [busy, definition.dialogueId, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        leave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leave]);

  if (view === null) return null;
  const node = definition.nodes[view.nodeId];
  if (node === undefined) return null;

  const allowed = new Set(view.allowedChoiceIds);
  const choices = node.choices.filter((choice) => allowed.has(choice.id));

  const speaker = node.speaker;
  const label = speaker === null ? null : speakerName?.(speaker.npcId) ?? speaker.npcId;
  const body = renderText(node.text, variables);
  const portraitSrc = speaker === null ? null : `/assets/npc/${speaker.npcId}/${speaker.expression}.png`;
  const showPortrait = portraitSrc !== null && portraitSrc !== failedPortraitSrc;

  return (
    <div className="dlg-overlay" role="dialog" aria-modal="true" aria-label={label ?? 'Dialogue'}>
      <div className="dlg-frame">
        {showPortrait && speaker !== null ? (
          <div className="dlg-portrait" data-expression={speaker.expression}>
            <img src={portraitSrc} alt="" onError={() => setFailedPortraitSrc(portraitSrc)} />
          </div>
        ) : null}

        <div className="dlg-window">
          {label !== null ? <div className="dlg-speaker">{label}</div> : null}
          <p className="dlg-text">{body}</p>

          {choices.length > 0 ? (
            <ul className="dlg-choices">
              {choices.map((choice) => (
                <li key={choice.id}>
                  <button type="button" className="dlg-choice" disabled={busy} onClick={() => choose(choice.id)}>
                    {choice.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <button type="button" className="dlg-choice dlg-continue" onClick={leave}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
