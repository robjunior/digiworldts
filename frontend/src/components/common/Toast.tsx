import { useEffect, useState, type JSX, type ReactNode } from 'react';

/**
 * Unified toast component.
 *
 * Consolidates the pattern from Factory, Adventure, Nursery, Market, World, Dungeon, Training routes:
 * ```tsx
 * <div className={`toast ${notice ? 'show' : ''}`} role="status" aria-live="polite">
 *   {notice}
 * </div>
 * ```
 *
 * All page-scoped `.toast` and `.toast.show` styles in extensions-*.css continue to apply
 * because we emit the same class names.
 */
export function Toast({
  message,
  variant = 'default',
  extraClassName,
}: {
  readonly message: string | null | undefined;
  readonly variant?: 'default' | 'error';
  readonly extraClassName?: string;
}): JSX.Element {
  const show = message !== null && message !== undefined && message !== '';
  const cls = [
    'toast',
    extraClassName ?? '',
    show ? 'show' : '',
    variant === 'error' ? 'is-error' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const style = variant === 'error' ? { background: 'var(--battle)', color: '#fff' } : undefined;
  return (
    <div className={cls} role="status" aria-live="polite" {...(style ? { style } : {})}>
      {message}
    </div>
  );
}

/**
 * Self-managing toast that auto-dismisses after `durationMs`.
 * Use when the parent only needs "flash this message and forget."
 */
export function AutoToast({
  message,
  durationMs = 2200,
  onDismiss,
  variant,
  extraClassName,
}: {
  readonly message: string | null;
  readonly durationMs?: number;
  readonly onDismiss?: () => void;
  readonly variant?: 'default' | 'error';
  readonly extraClassName?: string;
}): JSX.Element {
  const [visible, setVisible] = useState<string | null>(message);
  useEffect(() => {
    setVisible(message);
    if (message === null || message === '') return;
    const t = window.setTimeout(() => {
      setVisible(null);
      onDismiss?.();
    }, durationMs);
    return () => window.clearTimeout(t);
  }, [message, durationMs, onDismiss]);
  return (
    <Toast
      message={visible}
      {...(variant !== undefined ? { variant } : {})}
      {...(extraClassName !== undefined ? { extraClassName } : {})}
    />
  );
}

/**
 * Slot for cases where the parent wants complete control of a toast-shaped message
 * but still needs the standard container semantics.
 */
export function ToastShell({
  show,
  children,
  role = 'status',
  extraClassName,
}: {
  readonly show: boolean;
  readonly children: ReactNode;
  readonly role?: 'status' | 'alert';
  readonly extraClassName?: string;
}): JSX.Element {
  const cls = ['toast', extraClassName ?? '', show ? 'show' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} role={role} aria-live="polite">
      {children}
    </div>
  );
}
