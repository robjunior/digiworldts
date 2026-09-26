import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';

import { DialogueLayer } from '../components/onboarding/DialogueLayer';
import { FallbackMessage } from '../components/onboarding/FallbackMessage';
import { InteractiveIntro } from '../components/onboarding/InteractiveIntro';
import { TeamsLayer } from '../components/onboarding/TeamsLayer';
import { TransitionOverlay } from '../components/onboarding/TransitionOverlay';
import { AUTH_ME_KEY, useAuth } from '../hooks/useAuth';
import { ApiError } from '../lib/api';
import { getOnboardingState, selectOnboardingTeam, type OnboardingTeamView } from '../lib/api-onboarding';
import '../styles/extensions-onboarding.css';

const INTRO_QUERY_KEY = ['onboarding'] as const;
const INTRO_FALLBACK = 'Welcome to DigiWorld.';

export function Intro(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [dialogueDismissed, setDialogueDismissed] = useState(false);
  const [teamsVisible, setTeamsVisible] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [transitionActive, setTransitionActive] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const introQuery = useQuery({ queryKey: INTRO_QUERY_KEY, queryFn: getOnboardingState, retry: false });
  const selectTeamMutation = useMutation({ mutationFn: selectOnboardingTeam });

  const data = introQuery.data;
  const config = data?.config;
  const teams = data?.completed === false ? data.teams : [];
  const paragraphs = useMemo(() => splitDialogue(config?.introDialogue ?? INTRO_FALLBACK), [config?.introDialogue]);
  const showFallback = shouldShowFallback(introQuery.error, data, teams);
  const [interactiveFailed, setInteractiveFailed] = useState(false);
  const introDialogueId = config?.introDialogueId ?? null;
  const useInteractive = introDialogueId !== null && introDialogueId.length > 0 && !interactiveFailed;

  useEffect(() => {
    document.body.classList.add('onboarding');
    const safeBg = toSafeBgUrl(config?.bgImage);
    if (safeBg !== null) {
      document.body.classList.remove('fallback-bg');
      document.body.style.setProperty('background-image', `url(${JSON.stringify(safeBg)})`);
    } else {
      document.body.classList.add('fallback-bg');
      document.body.style.setProperty('background-image', '');
    }
    return () => {
      document.body.classList.remove('onboarding', 'fallback-bg');
      document.body.style.setProperty('background-image', '');
    };
  }, [config?.bgImage]);

  if (user?.onboardingCompleted === true || data?.completed === true) {
    return <Navigate to="/" replace />;
  }

  const revealTeams = (): void => {
    setDialogueDismissed(true);
    window.setTimeout(() => {
      if (teams.length === 0) {
        setSelectionError('Onboarding teams have not been configured yet. Ask an admin to seed them.');
        return;
      }
      setTeamsVisible(true);
    }, 500);
  };

  const selectTeam = async (team: OnboardingTeamView): Promise<void> => {
    if (selectedTeamId !== null) return;
    setSelectionError(null);
    setSelectedTeamId(team.id);

    try {
      const result = await selectTeamMutation.mutateAsync(team.id);
      sessionStorage.setItem('digiworld:just-onboarded', team.slug || result.teamSlug);
      await queryClient.invalidateQueries({ queryKey: AUTH_ME_KEY });
      window.setTimeout(() => {
        setTransitionActive(true);
        window.setTimeout(() => navigate('/', { replace: true }), 800);
      }, 600);
    } catch (error) {
      setSelectedTeamId(null);
      if (error instanceof ApiError && error.status === 409) {
        navigate('/', { replace: true });
        return;
      }
      if (error instanceof ApiError) {
        setSelectionError(error.message);
        return;
      }
      throw error;
    }
  };

  return (
    <main>
      {introQuery.isPending ? <div className="fallback-msg">Loading intro…</div> : null}
      {showFallback ? <FallbackMessage visible /> : null}
      {selectionError ? <div className="auth-error fallback-msg" role="alert">{selectionError}</div> : null}
      {data?.completed === false && teams.length > 0 ? (
        <>
          {useInteractive && introDialogueId !== null ? (
            <InteractiveIntro
              dialogueId={introDialogueId}
              playerName={user?.displayName ?? user?.username ?? 'Tamer'}
              visible={!teamsVisible}
              onFinish={revealTeams}
              onUnrecoverable={() => setInteractiveFailed(true)}
            />
          ) : (
            <DialogueLayer paragraphs={paragraphs} visible={!teamsVisible} dismissed={dialogueDismissed} onSkip={revealTeams} />
          )}
          <TeamsLayer teams={teams} visible={teamsVisible} locked={selectedTeamId !== null} selectedTeamId={selectedTeamId} onSelect={(team) => void selectTeam(team)} />
        </>
      ) : null}
      <TransitionOverlay active={transitionActive} />
    </main>
  );
}

function splitDialogue(text: string): readonly string[] {
  const paragraphs = text.split('\n\n').map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 0);
  return paragraphs.length > 0 ? paragraphs : [INTRO_FALLBACK];
}

/**
 * Sanitize an admin-supplied background image URL before feeding it into
 * `background-image: url(...)`. Rejects anything that could break out of
 * the CSS `url()` (quotes, whitespace, angle brackets, backslashes) and
 * requires an http(s) / same-origin / data:image scheme. Returns null on
 * reject so the caller falls back to the CSS class default.
 */
function toSafeBgUrl(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 400) return null;
  if (/["'\\<>\s]/.test(trimmed)) return null;
  if (!/^(https?:\/\/|\/|data:image\/)/i.test(trimmed)) return null;
  return trimmed;
}

function shouldShowFallback(error: Error | null, data: ReturnType<typeof getOnboardingState> extends Promise<infer T> ? T | undefined : undefined, teams: readonly OnboardingTeamView[]): boolean {
  if (data?.completed === false && teams.length === 0) {
    return true;
  }
  if (error instanceof ApiError) {
    return error.status === 503 || error.code === 'no-teams-available' || error.message === 'no-teams-available';
  }
  return false;
}
