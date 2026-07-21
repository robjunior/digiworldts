import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';

import {
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
      lede="Global multipliers applied to XP awards and training stat gains. Stacks multiplicatively with item buffs."
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
  readonly onSubmit: (input: { xpRate: number }) => Promise<unknown>;
}): JSX.Element {
  const [xpRate, setXpRate] = useState<string>(settings.xpRate.toString());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setXpRate(settings.xpRate.toString());
  }, [settings.xpRate, settings.updatedAt]);

  const parsedRate = Number(xpRate);
  const rateValid =
    Number.isFinite(parsedRate) && parsedRate >= ADMIN_XP_RATE_MIN && parsedRate <= ADMIN_XP_RATE_MAX;
  const rateChanged = rateValid && Math.abs(parsedRate - settings.xpRate) > 1e-9;
  const showHighRateWarning = rateValid && parsedRate > XP_RATE_WARN_ABOVE;

  const applyPreset = (value: number): void => {
    setXpRate(value.toString());
    setError(null);
    setStatus(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!Number.isFinite(parsedRate)) {
      setError('XP rate must be a valid number.');
      return;
    }
    if (parsedRate < ADMIN_XP_RATE_MIN || parsedRate > ADMIN_XP_RATE_MAX) {
      setError(`XP rate must be between ${ADMIN_XP_RATE_MIN} and ${ADMIN_XP_RATE_MAX}.`);
      return;
    }
    setError(null);
    setStatus(null);
    try {
      await onSubmit({ xpRate: parsedRate });
      setStatus('Settings updated.');
    } catch {
      // ErrorText will render mutation.error; nothing else to do.
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
        <span className="muted" style={{ alignSelf: 'center' }}>Presets:</span>
        {XP_RATE_PRESETS.map((preset) => {
          const active = rateValid && Math.abs(parsedRate - preset) < 1e-9;
          return (
            <button
              key={preset}
              type="button"
              className={`btn btn--sm ${active ? '' : 'btn--secondary'}`}
              onClick={() => applyPreset(preset)}
            >
              {preset}×
            </button>
          );
        })}
      </div>

      {showHighRateWarning ? (
        <AdminMessage tone="error">
          Warning: XP rate above {XP_RATE_WARN_ABOVE}× will heavily accelerate all player progression.
        </AdminMessage>
      ) : null}
      {error ? <p className="auth-error">{error}</p> : null}
      {status ? <AdminMessage tone="success">{status}</AdminMessage> : null}

      <div className="row spread">
        <span className="muted">
          Affects: match-end XP (PvP + PvE) and training stat gains.
        </span>
        <button className="btn" type="submit" disabled={busy || !rateValid || !rateChanged}>
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
