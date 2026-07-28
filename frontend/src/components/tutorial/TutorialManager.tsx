import { useEffect, useState, type JSX } from 'react';
import { useLocation } from 'react-router';

import { TutorialOverlay } from './TutorialOverlay';
import { tutorialForPath, type Tutorial } from './tutorial-content';
import { useTutorialSeen } from './useTutorialSeen';

/**
 * Global tutorial dispatcher.
 *
 * Watches the current route and, when the player lands on a screen whose
 * tutorial they have never seen, mounts `<TutorialOverlay>`. Dismissing
 * marks the tutorial as seen for this player and the overlay stays down
 * until they explicitly re-open it from a help menu (future work).
 *
 * `/combat` is included even though it isn't in the main nav — the same
 * route-based lookup covers PvE (dungeon → combat) and PvP (matchmaking
 * navigates to /combat via RealtimeBridge in App.tsx).
 */
export function TutorialManager(): JSX.Element | null {
  const { pathname } = useLocation();
  const { userId, has, markSeen } = useTutorialSeen();
  const [active, setActive] = useState<Tutorial | null>(null);

  useEffect(() => {
    if (userId === null) {
      setActive(null);
      return;
    }
    const candidate = tutorialForPath(pathname);
    if (candidate === null) {
      setActive(null);
      return;
    }
    if (has(candidate.id)) {
      setActive(null);
      return;
    }
    setActive(candidate);
  }, [pathname, userId, has]);

  if (active === null) return null;

  const close = (): void => {
    markSeen(active.id);
    setActive(null);
  };

  return <TutorialOverlay tutorial={active} onClose={close} />;
}
