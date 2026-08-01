import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';

import type { DialogueTextPart } from '@digiworld/shared';

import {
  abandonDialogueSession,
  advanceDialogueSession,
  getDialogue,
  startDialogueSession,
  type DialogueView,
} from '../../lib/api-dialogues';

type InteractiveIntroProps = {
  readonly dialogueId: string;
  readonly playerName: string;
  readonly visible: boolean;
  readonly onFinish: () => void;
  readonly onUnrecoverable: (message: string) => void;
};

/**
 * Runtime-driven intro. Replaces the paragraph DialogueLayer whenever the
 * admin has set `onboarding_config.intro_dialogue_id`. It:
 *   1. Fetches the dialogue definition once (client cache via react-query).
 *   2. Starts a server session so any `@do set_flag(...)` or `@do give_item(...)`
 *      in the intro actually applies to the user's real state.
 *   3. Renders speaker + text + choice buttons, advancing each pick through
 *      the same runtime the dungeon overlay uses.
 *   4. Calls `onFinish` when the dialogue reaches END — same UX contract as
 *      DialogueLayer's `onSkip`, so the parent transitions to team select.
 *
 * On any unrecoverable error (missing dialogue, server rejection) it calls
 * `onUnrecoverable` so `Intro.tsx` can fall back to the paragraph layer.
 */
export function InteractiveIntro({ dialogueId, playerName, visible, onFinish, onUnrecoverable }: InteractiveIntroProps): JSX.Element | null {
  const [view, setView] = useState<DialogueView | null>(null);
  const [busy, setBusy] = useState(false);
  const [portraitFailed, setPortraitFailed] = useState<string | null>(null);
  const startedRef = useRef<string | null>(null);

  const definitionQuery = useQuery({
    queryKey: ['onboarding-intro-dialogue', dialogueId],
    queryFn: () => getDialogue(dialogueId),
    retry: false,
  });

  useEffect(() => {
    if (definitionQuery.error) {
      onUnrecoverable(definitionQuery.error instanceof Error ? definitionQuery.error.message : 'failed to fetch intro dialogue');
    }
  }, [definitionQuery.error, onUnrecoverable]);

  useEffect(() => {
    if (startedRef.current === dialogueId) return;
    if (!definitionQuery.data) return;
    startedRef.current = dialogueId;
    let cancelled = false;
    void startDialogueSession(dialogueId)
      .then((res) => { if (!cancelled) setView(res.view); })
      .catch((err) => { if (!cancelled) onUnrecoverable(err instanceof Error ? err.message : 'failed to start intro session'); });
    return () => { cancelled = true; };
  }, [definitionQuery.data, dialogueId, onUnrecoverable]);

  useEffect(() => {
    return () => {
      void abandonDialogueSession().catch(() => undefined);
    };
  }, []);

  const choose = useCallback((choiceId: string): void => {
    if (busy || view === null) return;
    setBusy(true);
    void advanceDialogueSession(dialogueId, choiceId)
      .then((res) => {
        if (res.view.done) {
          onFinish();
        } else {
          setView(res.view);
        }
      })
      .catch((err) => onUnrecoverable(err instanceof Error ? err.message : 'advance failed'))
      .finally(() => setBusy(false));
  }, [busy, dialogueId, onFinish, onUnrecoverable, view]);

  if (!visible || definitionQuery.data === undefined || view === null) return null;

  const definition = definitionQuery.data.dialogue.definition;
  const node = definition.nodes[view.nodeId];
  if (node === undefined) return null;

  const allowed = new Set(view.allowedChoiceIds);
  const choices = node.choices.filter((choice) => allowed.has(choice.id));
  const speaker = node.speaker;
  const body = renderText(node.text, { player_name: playerName });
  const portraitSrc = speaker === null ? null : `/assets/npc/${speaker.npcId}/${speaker.expression}.png`;
  const showPortrait = portraitSrc !== null && portraitSrc !== portraitFailed;

  return (
    <div className="dlg-overlay onboarding-dialogue" role="dialog" aria-modal="true" aria-label={speaker?.npcId ?? 'Intro'}>
      <div className="dlg-frame">
        {showPortrait && speaker !== null ? (
          <div className="dlg-portrait" data-expression={speaker.expression}>
            <img src={portraitSrc} alt="" onError={() => setPortraitFailed(portraitSrc)} />
          </div>
        ) : null}
        <div className="dlg-window">
          {speaker !== null ? <div className="dlg-speaker">{speaker.npcId}</div> : null}
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
            <button type="button" className="dlg-choice dlg-continue" onClick={onFinish}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function renderText(parts: readonly DialogueTextPart[], variables: Readonly<Record<string, string | number | boolean>>): string {
  return parts
    .map((part) => (part.kind === 'text' ? part.value : String(variables[part.name] ?? `{${part.name}}`)))
    .join('');
}
