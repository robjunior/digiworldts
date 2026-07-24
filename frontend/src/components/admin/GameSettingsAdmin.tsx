import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';

import {
  ADMIN_DAMAGE_RATE_MAX,
  ADMIN_DAMAGE_RATE_MIN,
  ADMIN_XP_RATE_MAX,
  ADMIN_XP_RATE_MIN,
  getAdminGameSettings,
  updateAdminGameSettings,
  type AdminGameSettings,
} from '../../lib/api-admin';
import { AdminMessage, AdminSection, ErrorText, Field } from './AdminShared';

const GAME_SETTINGS_QUERY_KEY = ['admin', 'game-settings'] as const;
const XP_RATE_PRESETS = [0.5, 1, 1.5, 2, 3, 5] as const;
const XP_RATE_WARN_ABOVE = 3;
const DAMAGE_RATE_PRESETS = [0.5, 1, 1.2, 1.5, 2, 3] as const;
const DAMAGE_RATE_WARN_ABOVE = 2.5;

export function GameSettingsAdmin(): JSX.Element {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: GAME_SETTINGS_QUERY_KEY, queryFn: getAdminGameSettings });
  const updateMutation = useMutation({
    mutationFn: updateAdminGameSettings,
    onSuccess: (response) => {
      queryClient.setQueryData(GAME_SETTINGS_QUERY_KEY, response);
    },
  });

  const current = settingsQuery.data?.settings ?? null;

  return (
    <AdminSection
      title="Game settings"
      lede="Global multipliers applied at match/training resolution. Stacks multiplicatively with item buffs."
    >
      <ErrorText error={settingsQuery.error ?? updateMutation.error ?? null} />
      {settingsQuery.isPending ? <AdminMessage tone="muted">Loading current settings…</AdminMessage> : null}
      {current ? (
        <GameSettingsForm
          settings={current}
          busy={updateMutation.isPending}
          onSubmit={(input) => updateMutation.mutateAsync(input)}
        />
      ) : null}
    </AdminSection>
  );
}

function GameSettingsForm({
  settings,
  busy,
  onSubmit,
}: {
  readonly settings: AdminGameSettings;
  readonly busy: boolean;
  readonly onSubmit: (input: { xpRate?: number; damageRate?: number }) => Promise<unknown>;
}): JSX.Element {
  const [xpRate, setXpRate] = useState<string>(settings.xpRate.toString());
  const [damageRate, setDamageRate] = useState<string>(settings.damageRate.toString());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setXpRate(settings.xpRate.toString());
    setDamageRate(settings.damageRate.toString());
  }, [settings.xpRate, settings.damageRate, settings.updatedAt]);

  const parsedXp = Number(xpRate);
  const parsedDmg = Number(damageRate);
  const xpValid = Number.isFinite(parsedXp) && parsedXp >= ADMIN_XP_RATE_MIN && parsedXp <= ADMIN_XP_RATE_MAX;
  const dmgValid = Number.isFinite(parsedDmg) && parsedDmg >= ADMIN_DAMAGE_RATE_MIN && parsedDmg <= ADMIN_DAMAGE_RATE_MAX;
  const xpChanged = xpValid && Math.abs(parsedXp - settings.xpRate) > 1e-9;
  const dmgChanged = dmgValid && Math.abs(parsedDmg - settings.damageRate) > 1e-9;
  const anyChanged = xpChanged || dmgChanged;
  const showHighXpWarning = xpValid && parsedXp > XP_RATE_WARN_ABOVE;
  const showHighDmgWarning = dmgValid && parsedDmg > DAMAGE_RATE_WARN_ABOVE;

  const applyXpPreset = (value: number): void => {
    setXpRate(value.toString());
    setError(null);
    setStatus(null);
  };
  const applyDmgPreset = (value: number): void => {
    setDamageRate(value.toString());
    setError(null);
    setStatus(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!xpValid) {
      setError(`XP rate must be between ${ADMIN_XP_RATE_MIN} and ${ADMIN_XP_RATE_MAX}.`);
      return;
    }
    if (!dmgValid) {
      setError(`Damage rate must be between ${ADMIN_DAMAGE_RATE_MIN} and ${ADMIN_DAMAGE_RATE_MAX}.`);
      return;
    }
    setError(null);
    setStatus(null);
    const patch: { xpRate?: number; damageRate?: number } = {};
    if (xpChanged) patch.xpRate = parsedXp;
    if (dmgChanged) patch.damageRate = parsedDmg;
    try {
      await onSubmit(patch);
      setStatus('Settings updated.');
    } catch {
      // ErrorText renders mutation.error; nothing else to do.
    }
  };

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <div className="admin-stat-grid" style={{ marginBottom: '1rem' }}>
        <div className="stat-tile">
          <span className="lbl">Current XP rate</span>
          <span className="val">{formatRate(settings.xpRate)}×</span>
        </div>
        <div className="stat-tile">
          <span className="lbl">Current damage rate</span>
          <span className="val">{formatRate(settings.damageRate)}×</span>
        </div>
        <div className="stat-tile">
          <span className="lbl">Last updated</span>
          <span className="val">{formatTimestamp(settings.updatedAt)}</span>
        </div>
      </div>

      <Field label={`XP rate (${ADMIN_XP_RATE_MIN}× – ${ADMIN_XP_RATE_MAX}×)`}>
        <input
          className="input"
          type="number"
          name="xpRate"
          min={ADMIN_XP_RATE_MIN}
          max={ADMIN_XP_RATE_MAX}
          step={0.01}
          value={xpRate}
          onChange={(event) => {
            setXpRate(event.target.value);
            setError(null);
            setStatus(null);
          }}
          required
        />
      </Field>

      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        <span className="muted" style={{ alignSelf: 'center' }}>XP presets:</span>
        {XP_RATE_PRESETS.map((preset) => {
          const active = xpValid && Math.abs(parsedXp - preset) < 1e-9;
          return (
            <button
              key={preset}
              type="button"
              className={`btn btn--sm ${active ? '' : 'btn--secondary'}`}
              onClick={() => applyXpPreset(preset)}
            >
              {preset}×
            </button>
          );
        })}
      </div>

      <Field label={`Damage rate (${ADMIN_DAMAGE_RATE_MIN}× – ${ADMIN_DAMAGE_RATE_MAX}×)`}>
        <input
          className="input"
          type="number"
          name="damageRate"
          min={ADMIN_DAMAGE_RATE_MIN}
          max={ADMIN_DAMAGE_RATE_MAX}
          step={0.01}
          value={damageRate}
          onChange={(event) => {
            setDamageRate(event.target.value);
            setError(null);
            setStatus(null);
          }}
          required
        />
      </Field>

      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        <span className="muted" style={{ alignSelf: 'center' }}>Damage presets:</span>
        {DAMAGE_RATE_PRESETS.map((preset) => {
          const active = dmgValid && Math.abs(parsedDmg - preset) < 1e-9;
          return (
            <button
              key={preset}
              type="button"
              className={`btn btn--sm ${active ? '' : 'btn--secondary'}`}
              onClick={() => applyDmgPreset(preset)}
            >
              {preset}×
            </button>
          );
        })}
      </div>

      {showHighXpWarning ? (
        <AdminMessage tone="error">
          Warning: XP rate above {XP_RATE_WARN_ABOVE}× will heavily accelerate all player progression.
        </AdminMessage>
      ) : null}
      {showHighDmgWarning ? (
        <AdminMessage tone="error">
          Warning: Damage rate above {DAMAGE_RATE_WARN_ABOVE}× will make matches very short — most attacks one-shot at high tier.
        </AdminMessage>
      ) : null}
      {error ? <p className="auth-error">{error}</p> : null}
      {status ? <AdminMessage tone="success">{status}</AdminMessage> : null}

      <div className="row spread">
        <span className="muted">
          XP rate: match-end XP (PvP + PvE) + training gains. Damage rate: every damage roll in combat, frozen per-match at battle start.
        </span>
        <button className="btn" type="submit" disabled={busy || !xpValid || !dmgValid || !anyChanged}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}

function formatRate(value: number): string {
  if (!Number.isFinite(value)) return '1';
  const rounded = Math.round(value * 100) / 100;
  return rounded.toString();
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'never';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return 'unknown';
  }
}
