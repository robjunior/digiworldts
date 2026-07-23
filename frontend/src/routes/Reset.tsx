import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ApiError, authResetConsume } from '../lib/api';

export function Reset(): JSX.Element {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const hasToken = token.length === 64;

  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [doneUsername, setDoneUsername] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await authResetConsume({ token, newPassword });
      setDoneUsername(result.username);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        return;
      }
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-label="Password reset">
        <div className="auth-card-in">
          <div>
            <div className="eyebrow">DigiWorld</div>
            <h1>Reset password</h1>
            <p className="lede">
              {doneUsername
                ? `Password reset for ${doneUsername}. Sign in with your new password.`
                : hasToken
                ? 'Set a new password. All other sessions will be revoked.'
                : 'This link is missing a reset token. Ask an admin to issue one.'}
            </p>
          </div>

          {doneUsername ? (
            <div className="stack">
              <div className="auth-hint">All sessions for this account have been signed out.</div>
              <Link className="btn btn--wide" to="/login">Continue to sign in</Link>
            </div>
          ) : hasToken ? (
            <form className="stack" noValidate onSubmit={submit}>
              <label className="field">
                New password
                <input
                  className="input"
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={256}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.currentTarget.value)}
                />
              </label>
              <label className="field">
                Confirm password
                <input
                  className="input"
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={256}
                  value={confirm}
                  onChange={(event) => setConfirm(event.currentTarget.value)}
                />
              </label>
              <div className="auth-error" role="alert">{error}</div>
              <button className="btn btn--wide" type="submit" disabled={submitting}>
                {submitting ? 'Resetting…' : 'Reset password'}
              </button>
            </form>
          ) : (
            <div className="stack">
              <Link className="btn btn--wide" to="/login">Return to sign in</Link>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
