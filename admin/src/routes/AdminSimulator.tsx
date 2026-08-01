import { useMutation, useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';

import type { Npc } from '@digiworld/shared/npc';

import { AdminGuard } from '../components/admin/AdminGuard';
import { AdminMessage, AdminSection, ErrorText } from '../components/admin/AdminShared';
import {
  listDialogues,
  simulateDialogue,
  type SimulatorFactOverrides,
  type SimulatorStep,
  type SimulatorView,
} from '../lib/api-dialogues';
import { listNpcs, npcPortraitUrl } from '../lib/api-npcs';
import '../styles/extensions-admin.css';

const NPCS_KEY = ['admin', 'npcs'] as const;
const DIALOGUES_KEY = ['admin', 'dialogues'] as const;

type OverrideForm = {
  readonly level: number;
  readonly playerName: string;
  readonly flagsText: string;
  readonly itemsText: string;
};

const DEFAULT_FORM: OverrideForm = {
  level: 1,
  playerName: 'Tester',
  flagsText: '',
  itemsText: '',
};

function parseFlags(text: string): readonly string[] {
  return text.split(/[,\s\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseItems(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split(/[,\n]+/)) {
    const [id, qtyRaw] = line.split(/[:=]/);
    if (!id || id.trim().length === 0) continue;
    const qty = Number(qtyRaw ?? 1);
    out[id.trim()] = Number.isFinite(qty) && qty > 0 ? qty : 1;
  }
  return out;
}

function formToOverrides(form: OverrideForm): SimulatorFactOverrides {
  return {
    level: form.level,
    playerName: form.playerName.trim().length > 0 ? form.playerName.trim() : 'Tester',
    flags: parseFlags(form.flagsText),
    items: parseItems(form.itemsText),
  };
}

function ChoiceRow({
  choice,
  onPick,
  disabled,
}: {
  readonly choice: SimulatorView['choices'][number];
  readonly onPick: () => void;
  readonly disabled: boolean;
}): JSX.Element {
  return (
    <div className={`sim-choice ${choice.visible ? 'is-visible' : 'is-hidden'}`}>
      <div className="sim-choice-head">
        <span className={`sim-badge ${choice.visible ? 'is-ok' : 'is-off'}`}>
          {choice.visible ? '✓ visible' : '× hidden'}
        </span>
        <span className="sim-choice-target">→ {choice.target}</span>
      </div>
      <div className="sim-choice-label">{choice.label}</div>
      {choice.conditionSummary !== null ? (
        <code className="sim-choice-condition">{choice.conditionSummary}</code>
      ) : null}
      <button
        type="button"
        className="btn btn--sm"
        disabled={disabled || !choice.visible}
        onClick={onPick}
      >
        {choice.visible ? 'Pick' : 'Blocked by condition'}
      </button>
    </div>
  );
}

function ActionRow({ action }: { readonly action: SimulatorView['actionsAtEntry'][number] }): JSX.Element {
  const tone = action.appliedSuccessfully ? 'is-ok' : 'is-off';
  return (
    <div className={`sim-action ${tone}`}>
      <span className={`sim-badge ${tone}`}>{action.appliedSuccessfully ? '✓' : '×'}</span>
      <code>{action.name}({action.args.map((a) => (typeof a === 'string' ? `"${a}"` : String(a))).join(', ')})</code>
      {action.note !== null ? <span className="sim-action-note">{action.note}</span> : null}
    </div>
  );
}

function SpeakerBar({
  view,
  npcs,
}: {
  readonly view: SimulatorView;
  readonly npcs: readonly Npc[];
}): JSX.Element | null {
  if (view.speaker === null) return null;
  const npc = npcs.find((n) => n.id === view.speaker!.npcId);
  const expression = npc?.expressions.find((e) => e.key === view.speaker!.expression);
  const showPortrait = expression?.hasPortrait ?? false;
  return (
    <div className="sim-speaker">
      {showPortrait ? (
        <img
          src={npcPortraitUrl(view.speaker.npcId, view.speaker.expression)}
          alt=""
          className="sim-portrait"
        />
      ) : (
        <div className="sim-portrait sim-portrait-empty">no portrait</div>
      )}
      <div>
        <div className="sim-speaker-name">{npc?.displayName ?? view.speaker.npcId}</div>
        <div className="sim-speaker-expr">{view.speaker.expression}</div>
        {npc === undefined ? (
          <AdminMessage tone="error">
            NPC "{view.speaker.npcId}" is not in the registry. This would refuse re-import.
          </AdminMessage>
        ) : expression === undefined ? (
          <AdminMessage tone="error">
            NPC "{npc.id}" has no expression "{view.speaker.expression}".
          </AdminMessage>
        ) : null}
      </div>
    </div>
  );
}

export function AdminSimulator(): JSX.Element {
  const { id: routeId } = useParams<{ id: string }>();
  const dialogueId = routeId ?? '';

  const dialoguesQuery = useQuery({ queryKey: DIALOGUES_KEY, queryFn: listDialogues });
  const npcsQuery = useQuery({ queryKey: NPCS_KEY, queryFn: listNpcs });
  const npcs = npcsQuery.data?.npcs ?? [];

  const [form, setForm] = useState<OverrideForm>(DEFAULT_FORM);
  const [history, setHistory] = useState<readonly SimulatorStep[]>([]);
  const [view, setView] = useState<SimulatorView | null>(null);

  const simulate = useMutation({
    mutationFn: () => simulateDialogue(dialogueId, {
      overrides: formToOverrides(form),
      history,
    }),
    onSuccess: (data) => setView(data.view),
  });

  const restart = (): void => {
    setHistory([]);
    setView(null);
    setTimeout(() => simulate.mutate(), 0);
  };

  const advance = (choiceId: string): void => {
    if (view === null) return;
    setHistory((prev) => [...prev, { nodeId: view.nodeId, choiceId }]);
    setTimeout(() => simulate.mutate(), 0);
  };

  const dialogueOptions = useMemo(
    () => (dialoguesQuery.data?.dialogues ?? []).map((d) => ({ id: d.dialogueId, title: d.title })),
    [dialoguesQuery.data?.dialogues],
  );

  return (
    <AdminGuard>
      <main className="admin-simulator">
        <header className="sim-header">
          <div>
            <h1>Dialogue simulator — <code>{dialogueId}</code></h1>
            <p className="lede">Dry-run every branch. No ledger writes, no side effects on player state.</p>
          </div>
          <div className="sim-header-actions">
            <select
              value={dialogueId}
              onChange={(e) => { window.location.href = `/dialogues/${encodeURIComponent(e.target.value)}/simulate`; }}
            >
              <option value="">— pick dialogue —</option>
              {dialogueOptions.map((d) => (
                <option key={d.id} value={d.id}>{d.id} — {d.title}</option>
              ))}
            </select>
            <Link to="/?tab=dialogues" className="btn btn--secondary">Back to Dialogues</Link>
          </div>
        </header>

        <div className="sim-layout">
          <aside className="sim-sidebar">
            <AdminSection title="Fact overrides" lede="Values the simulator injects as `level`, `player_name`, flags, and inventory.">
              <label className="field">
                <span>Level ({form.level})</span>
                <input
                  type="range"
                  min={1}
                  max={99}
                  value={form.level}
                  onChange={(e) => setForm({ ...form, level: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Player name</span>
                <input
                  type="text"
                  value={form.playerName}
                  onChange={(e) => setForm({ ...form, playerName: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Flags (one per line or comma-separated)</span>
                <textarea
                  rows={4}
                  placeholder="dialogue.elder.met&#10;quest.q_ridge.started"
                  value={form.flagsText}
                  onChange={(e) => setForm({ ...form, flagsText: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Items (id:qty per line)</span>
                <textarea
                  rows={4}
                  placeholder="meat_pack:3&#10;shrine_token:1"
                  value={form.itemsText}
                  onChange={(e) => setForm({ ...form, itemsText: e.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn"
                disabled={simulate.isPending || dialogueId.length === 0}
                onClick={restart}
              >
                {simulate.isPending ? 'Simulating…' : view === null ? 'Start simulation' : 'Restart with these facts'}
              </button>
            </AdminSection>

            <AdminSection title="History">
              {history.length === 0 ? (
                <AdminMessage tone="muted">No steps yet.</AdminMessage>
              ) : (
                <ol className="sim-history">
                  {history.map((step, i) => (
                    <li key={i}>
                      <code>{step.nodeId}</code> → <code>{step.choiceId}</code>
                    </li>
                  ))}
                </ol>
              )}
              {history.length > 0 ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setHistory((h) => h.slice(0, -1));
                    setTimeout(() => simulate.mutate(), 0);
                  }}
                >
                  Undo last step
                </button>
              ) : null}
            </AdminSection>
          </aside>

          <section className="sim-center">
            <ErrorText error={simulate.error} />
            {view === null ? (
              <AdminMessage tone="muted">
                Press <b>Start simulation</b> to walk the dialogue from its start node.
              </AdminMessage>
            ) : view.done ? (
              <AdminSection title="Dialogue ended">
                <AdminMessage tone="success">Reached the END node after {history.length} step(s).</AdminMessage>
                <StateReadout view={view} />
              </AdminSection>
            ) : (
              <>
                <AdminSection title={`Node: ${view.nodeId}`}>
                  {view.jumpTrail.length > 0 ? (
                    <AdminMessage tone="muted">
                      Jumped through: {view.jumpTrail.map((n) => <code key={n}>{n}</code>).reduce((acc, el) => acc === null ? el : <>{acc} → {el}</>, null as JSX.Element | null)}
                    </AdminMessage>
                  ) : null}
                  <SpeakerBar view={view} npcs={npcs} />
                  <div className="sim-text">{view.text}</div>
                  {view.tags.length > 0 ? (
                    <div className="sim-tags">
                      {view.tags.map((t) => <span key={t} className="sim-tag">#{t}</span>)}
                    </div>
                  ) : null}
                </AdminSection>

                {view.actionsAtEntry.length > 0 ? (
                  <AdminSection title="Entry actions" lede="Applied when this node was entered.">
                    <div className="sim-actions-list">
                      {view.actionsAtEntry.map((a) => <ActionRow key={a.id} action={a} />)}
                    </div>
                  </AdminSection>
                ) : null}

                <AdminSection title="Choices">
                  <div className="sim-choices-list">
                    {view.choices.length === 0 ? (
                      <AdminMessage tone="muted">No choices defined on this node.</AdminMessage>
                    ) : (
                      view.choices.map((c) => (
                        <ChoiceRow
                          key={c.id}
                          choice={c}
                          onPick={() => advance(c.id)}
                          disabled={simulate.isPending}
                        />
                      ))
                    )}
                  </div>
                </AdminSection>

                <StateReadout view={view} />
              </>
            )}
          </section>
        </div>
      </main>
    </AdminGuard>
  );
}

function StateReadout({ view }: { readonly view: SimulatorView }): JSX.Element {
  const itemEntries = Object.entries(view.items);
  return (
    <AdminSection title="Simulated state">
      <div className="sim-state">
        <div>
          <h3>Flags ({view.flags.length})</h3>
          {view.flags.length === 0 ? (
            <span className="lede">— none —</span>
          ) : (
            <ul>{view.flags.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
          )}
        </div>
        <div>
          <h3>Inventory ({itemEntries.length})</h3>
          {itemEntries.length === 0 ? (
            <span className="lede">— empty —</span>
          ) : (
            <ul>{itemEntries.map(([id, qty]) => <li key={id}><code>{id}</code> × {qty}</li>)}</ul>
          )}
        </div>
      </div>
    </AdminSection>
  );
}
