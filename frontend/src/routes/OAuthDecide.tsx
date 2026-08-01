import type { FormEvent, JSX } from 'react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';

import { ApiError } from '../lib/api';
import {
  fetchPendingPreview,
  submitDecision,
  type OAuthDecideRequest,
  type OAuthPendingPreview,
} from '../lib/api-oauth';

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  discord: 'Discord',
  google: 'Google',
  facebook: 'Facebook',
};

export function OAuthDecide(): JSX.Element {
  const location = useLocation();
  const token = useMemo(() => new URLSearchParams(location.search).get('token') ?? '', [location.search]);

  const preview = useQuery({
    queryKey: ['oauth', 'pending', token],
    queryFn: () => fetchPendingPreview(token),
    enabled: token.length > 0,
    retry: false,
  });

  const decide = useMutation({
    mutationFn: (body: OAuthDecideRequest) => submitDecision(body),
    onSuccess: (result) => {
      const returnTo = result.returnTo.startsWith('/') && !result.returnTo.startsWith('//')
        ? result.returnTo
        : '/';
      window.location.replace(returnTo);
    },
  });

  const [linkUsername, setLinkUsername] = useState('');
  const [linkPassword, setLinkPassword] = useState('');

  if (token.length === 0) {
    return <FailShell message="Nenhum token de OAuth foi passado nesta URL." />;
  }
  if (preview.isLoading) {
    return <FailShell message="Carregando…" />;
  }
  if (preview.isError || !preview.data) {
    const message = preview.error instanceof ApiError && preview.error.status === 404
      ? 'Este link já expirou (10 minutos). Volte pra tela de login e tente novamente.'
      : 'Não consegui carregar essa decisão. Volte pro login e tente de novo.';
    return <FailShell message={message} />;
  }

  const data: OAuthPendingPreview = preview.data;
  const providerLabel = PROVIDER_LABELS[data.provider] ?? data.provider;
  const errorMessage = decide.error instanceof ApiError ? decide.error.message : '';

  const submitCreate = (): void => {
    decide.mutate({ choice: 'create', pendingToken: token });
  };

  const submitLink = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    decide.mutate({
      choice: 'link',
      pendingToken: token,
      username: linkUsername.trim(),
      password: linkPassword,
    });
  };

  return (
    <main className="oauth-decide-shell">
      <section className="oauth-decide-card" aria-label={`Escolha OAuth ${providerLabel}`}>
        <div className="oauth-decide-card-in">
          <header className="oauth-decide-header">
            {data.providerAvatar !== null ? (
              <img
                className="oauth-decide-avatar"
                src={data.providerAvatar}
                alt={data.providerUsername ?? providerLabel}
              />
            ) : (
              <div className="oauth-decide-avatar-fallback" aria-hidden="true">
                {(data.providerUsername ?? providerLabel).slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="oauth-decide-who">
              <div className="eyebrow">{providerLabel} · autenticado</div>
              <h1>Olá, {data.providerUsername ?? providerLabel}!</h1>
              <p className="lede">Esse {providerLabel} ainda não está vinculado a nenhuma conta DigiWorld.</p>
            </div>
          </header>

          <div className={`oauth-decide-choice${!data.canCreate ? ' is-disabled' : ''}`}>
            <h2>Criar uma conta nova</h2>
            <p>
              Vou criar uma conta DigiWorld já vinculada ao seu {providerLabel}. Nada de senha — você entra sempre pelo {providerLabel}.
              {!data.canCreate ? ' Registro está fechado neste servidor; peça a um admin para abrir.' : ''}
            </p>
            <button
              type="button"
              className="btn btn--wide"
              onClick={submitCreate}
              disabled={!data.canCreate || decide.isPending}
            >
              {decide.isPending && decide.variables?.choice === 'create' ? 'Criando…' : 'Criar conta nova'}
            </button>
          </div>

          <div className="oauth-decide-choice">
            <h2>Já tenho uma conta DigiWorld</h2>
            <p>Entre com sua conta existente e vamos vincular o {providerLabel} nela.</p>
            <form className="stack" noValidate onSubmit={submitLink}>
              <label className="field">
                Usuário
                <input
                  className="input"
                  type="text"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={40}
                  value={linkUsername}
                  onChange={(event) => setLinkUsername(event.currentTarget.value)}
                />
              </label>
              <label className="field">
                Senha
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={1}
                  value={linkPassword}
                  onChange={(event) => setLinkPassword(event.currentTarget.value)}
                />
              </label>
              <button
                type="submit"
                className="btn btn--wide"
                disabled={decide.isPending || linkUsername.trim().length === 0 || linkPassword.length === 0}
              >
                {decide.isPending && decide.variables?.choice === 'link' ? 'Vinculando…' : `Entrar e vincular ${providerLabel}`}
              </button>
            </form>
          </div>

          <div className="oauth-decide-error" role="alert">{errorMessage}</div>
        </div>
      </section>
    </main>
  );
}

function FailShell({ message }: { readonly message: string }): JSX.Element {
  return (
    <main className="oauth-decide-shell">
      <section className="oauth-decide-card">
        <div className="oauth-decide-card-in">
          <div className="oauth-decide-who">
            <h1>Ops.</h1>
            <p className="lede">{message}</p>
          </div>
          <a className="btn btn--wide" href="/login">Voltar pro login</a>
        </div>
      </section>
    </main>
  );
}
