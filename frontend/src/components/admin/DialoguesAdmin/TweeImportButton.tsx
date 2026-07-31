import { useMutation } from '@tanstack/react-query';
import type { ChangeEvent, JSX } from 'react';
import { useState } from 'react';

import { parseTwee } from '@digiworld/shared';
import type { DialogueDiagnostic, DialogueParseResult } from '@digiworld/shared';

import { importDialogue } from '../../../lib/api-dialogues';
import { AdminMessage, ErrorText, Field } from '../AdminShared';

type TweeImportButtonProps = {
  readonly onImported: () => void;
};

function idFromFilename(name: string): string {
  return name.replace(/\.(twee|tw)$/i, '');
}

function DiagnosticList({ items, tone }: { readonly items: readonly DialogueDiagnostic[]; readonly tone: 'error' | 'warn' }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <ul className={`twee-diagnostics is-${tone}`}>
      {items.map((item, index) => (
        <li key={`${item.passage ?? '-'}-${item.line}-${index}`}>
          <code>{item.passage ?? 'file'}{item.line > 0 ? `:${item.line}` : ''}</code> {item.message}
        </li>
      ))}
    </ul>
  );
}

export function TweeImportButton({ onImported }: TweeImportButtonProps): JSX.Element {
  const [source, setSource] = useState<string | null>(null);
  const [dialogueId, setDialogueId] = useState('');
  const [parsed, setParsed] = useState<DialogueParseResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: importDialogue,
    onSuccess: () => {
      setSource(null);
      setParsed(null);
      setDialogueId('');
      onImported();
    },
  });

  const onFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setReadError(null);
    const nextId = idFromFilename(file.name);
    void file.text().then((text) => {
      setSource(text);
      setDialogueId(nextId);
      setParsed(parseTwee(text, { dialogueId: nextId }));
    }).catch((error: unknown) => {
      setReadError(error instanceof Error ? error.message : 'could not read the file');
    });
  };

  const canImport = parsed?.definition != null && dialogueId.trim().length > 0;

  return (
    <div className="twee-import">
      <Field label="Twee file (.twee / .tw)">
        <input type="file" accept=".twee,.tw,text/plain" onChange={onFile} />
      </Field>

      {readError !== null ? <AdminMessage tone="error">{readError}</AdminMessage> : null}

      {parsed !== null ? (
        <div className="twee-preview">
          <Field label="Dialogue ID">
            <input
              className="input"
              value={dialogueId}
              onChange={(event) => setDialogueId(event.target.value)}
              spellCheck={false}
            />
          </Field>

          <div className="twee-stats">
            <span><b>{parsed.stats.nodes}</b> nodes</span>
            <span><b>{parsed.stats.choices}</b> choices</span>
            <span><b>{parsed.stats.actions}</b> actions</span>
            <span><b>{parsed.stats.conditions}</b> conditions</span>
            <span><b>{parsed.stats.jumps}</b> jumps</span>
            <span><b>{parsed.stats.speakers}</b> speakers</span>
          </div>

          {parsed.definition !== null ? (
            <AdminMessage tone="success">
              Parsed “{parsed.definition.title}” · starts at <code>{parsed.definition.startNodeId}</code>
              {parsed.definition.npcIds.length > 0 ? <> · speakers: {parsed.definition.npcIds.join(', ')}</> : null}
            </AdminMessage>
          ) : (
            <AdminMessage tone="error">This file has errors and cannot be imported.</AdminMessage>
          )}

          <DiagnosticList items={parsed.errors} tone="error" />
          <DiagnosticList items={parsed.warnings} tone="warn" />

          <ErrorText error={importMutation.error} />

          <button
            className="btn"
            type="button"
            disabled={!canImport || importMutation.isPending}
            onClick={() => { if (source !== null) importMutation.mutate({ dialogueId: dialogueId.trim(), source }); }}
          >
            {importMutation.isPending ? 'Importing…' : 'Import dialogue'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
