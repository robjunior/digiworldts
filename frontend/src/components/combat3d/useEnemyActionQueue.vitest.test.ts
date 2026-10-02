/**
 * The battle's turn clock must be anchored to the moment a hit LANDS, not to
 * the end of the particle effect: `stone-fall` runs 2.6s but lands at ~1s, so
 * gating on the effect's tail held the next turn back for over a second after
 * the damage was already on screen. These tests drive the REAL queue hook and
 * assert the gap between two events is measured from the impact callback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { BattleView } from "@digiworld/shared/battle";

import { useEnemyActionQueue } from "./useEnemyActionQueue";
import { TURN_ADVANCE_DELAY_MS } from "./combat3dConfig";

// happy-dom does not mark the environment as act-capable; without this React
// logs a warning for every act() call below (the tests still pass).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type LogEvent = BattleView["log"][number];

/** A long-trailing enemy cast: its visual outlives its hit by ~1.6s. */
const longCast = {
  type: "action",
  at: 0,
  round: 1,
  actor: "b:0",
  action: { type: "skill", unitId: "b:0", skillId: "sk-earth", targetId: "a:0" },
  targetId: "a:0",
  cue: "crit",
  damage: 42,
  skillElement: "earth",
  vfxPresetId: "stone-fall",
} as unknown as LogEvent;

type Harness = {
  played: { event: LogEvent; playVfx: boolean }[];
  impacts: (() => void)[];
  enqueue: (entry: { event: LogEvent; playVfx: boolean }) => void;
  unmount: () => void;
};

/** Mounts the real hook in a minimal React root and exposes its enqueue. */
function mountQueue(): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const played: { event: LogEvent; playVfx: boolean }[] = [];
  const impacts: (() => void)[] = [];
  const api: { enqueue: Harness["enqueue"] } = { enqueue: () => {} };

  function Probe(): null {
    const { enqueue } = useEnemyActionQueue((event, playVfx, onImpact) => {
      played.push({ event, playVfx });
      impacts.push(onImpact);
    });
    api.enqueue = enqueue;
    return null;
  }

  act(() => {
    root.render(createElement(Probe));
  });

  return {
    played,
    impacts,
    enqueue: (entry) => api.enqueue(entry),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useEnemyActionQueue — turn clock anchored to impact", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances only TURN_ADVANCE_DELAY_MS after the hit lands", () => {
    const h = mountQueue();
    try {
      act(() => {
        h.enqueue({ event: longCast, playVfx: true });
        h.enqueue({ event: longCast, playVfx: true });
      });
      expect(h.played).toHaveLength(1);

      // The effect is still flying (stone-fall lands at ~1s): no impact
      // reported yet, so the next cast must NOT have started.
      act(() => {
        vi.advanceTimersByTime(900);
      });
      expect(h.played).toHaveLength(1);

      // The hit lands — the queue waits the post-hit pause, not the effect tail.
      act(() => {
        h.impacts[0]!();
        vi.advanceTimersByTime(TURN_ADVANCE_DELAY_MS - 50);
      });
      expect(h.played).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(h.played).toHaveLength(2);
    } finally {
      h.unmount();
    }
  });

  it("never double-fires when the cast does report its impact", () => {
    const h = mountQueue();
    try {
      act(() => {
        h.enqueue({ event: longCast, playVfx: true });
        h.enqueue({ event: longCast, playVfx: true });
      });

      // Land the hit early, then run past the effect's own duration (2.6s for
      // stone-fall) — the safety bound must have been cancelled, not firing.
      act(() => {
        h.impacts[0]!();
        vi.advanceTimersByTime(4_000);
      });
      expect(h.played).toHaveLength(2);
    } finally {
      h.unmount();
    }
  });

  it("still drains the queue when a cast never reports an impact", () => {
    const h = mountQueue();
    try {
      act(() => {
        h.enqueue({ event: longCast, playVfx: true });
        h.enqueue({ event: longCast, playVfx: true });
      });
      expect(h.played).toHaveLength(1);

      // No impact ever fires (missing sprite): the bounded fallback drains it
      // so the battle can never stall.
      act(() => {
        vi.advanceTimersByTime(2_600 + TURN_ADVANCE_DELAY_MS + 100);
      });
      expect(h.played).toHaveLength(2);
    } finally {
      h.unmount();
    }
  });

  it("treats a repeated impact from the same cast as one hit", () => {
    const h = mountQueue();
    try {
      act(() => {
        h.enqueue({ event: longCast, playVfx: true });
        h.enqueue({ event: longCast, playVfx: true });
        h.impacts[0]!();
        h.impacts[0]!();
        vi.advanceTimersByTime(TURN_ADVANCE_DELAY_MS + 50);
      });
      expect(h.played).toHaveLength(2);
    } finally {
      h.unmount();
    }
  });
});
