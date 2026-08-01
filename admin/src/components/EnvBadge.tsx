import { useEffect, useMemo, useState } from 'react';

import { adminEnv, type AdminEnvLabel } from '../env';

const BADGE_STYLE: Readonly<Record<AdminEnvLabel, { bg: string; fg: string; symbol: string; text: string }>> = {
  dev: { bg: '#0f6d2b', fg: '#effff2', symbol: '●', text: 'DEV' },
  staging: { bg: '#7a5400', fg: '#fff5d9', symbol: '●', text: 'STAGING' },
  production: { bg: '#8f0e0e', fg: '#ffe0e0', symbol: '⚠', text: 'PRODUCTION' },
};

/**
 * Fixed banner across the top of every admin page identifying which
 * environment the app is currently talking to. Non-collapsible on
 * production so the operator can't forget mid-flow.
 */
export function EnvBadge(): JSX.Element | null {
  const style = BADGE_STYLE[adminEnv.label] ?? BADGE_STYLE.dev;
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [prodConfirmed, setProdConfirmed] = useState<boolean>(() => {
    if (!adminEnv.isProduction) return true;
    return typeof window === 'undefined' ? false : window.sessionStorage.getItem('admin.prod.ack') === '1';
  });

  useEffect(() => {
    if (adminEnv.isProduction && !prodConfirmed && typeof window !== 'undefined') {
      const ok = window.confirm(
        `You are about to open the admin against PRODUCTION.\n\nBackend: ${adminEnv.backendUrl}\n\nEvery write hits real players. Continue?`,
      );
      if (!ok) {
        window.location.href = 'about:blank';
        return;
      }
      window.sessionStorage.setItem('admin.prod.ack', '1');
      setProdConfirmed(true);
    }
  }, [prodConfirmed]);

  const collapsedText = useMemo(() => `${style.symbol} ${style.text}`, [style]);

  if (dismissed && !adminEnv.isProduction) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`admin-env-badge admin-env-${adminEnv.label}`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: style.bg,
        color: style.fg,
        padding: '4px 12px',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.05em',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 1px 0 rgba(0,0,0,0.4)',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div>
        <span aria-hidden="true">{collapsedText}</span>
        <span style={{ opacity: 0.75, fontWeight: 500, marginLeft: 12 }}>
          {adminEnv.backendUrl}
        </span>
      </div>
      {!adminEnv.isProduction ? (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss environment banner"
          style={{
            background: 'transparent',
            color: style.fg,
            border: '1px solid rgba(255,255,255,0.35)',
            borderRadius: 4,
            padding: '0 8px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
