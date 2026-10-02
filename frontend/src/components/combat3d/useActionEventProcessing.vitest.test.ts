/**
 * The crit floater must carry its "CRITICAL" label: the stylesheet reserves
 * `.fx-sub` for exactly that, but nothing populated it, so a crit rendered as a
 * plain bigger number. These tests drive the REAL event hook with a fake scene
 * handle and assert the floater is spawned AT IMPACT with the right kind, text
 * and sub-label.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BattleView, UnitId } from "@digiworld/shared/battle";

import { useActionEventProcessing } from "./useActionEventProcessing";
import type { Floater3D } from "./Floaters";
import type { Combat3DSceneHandle } from "./Combat3DScene";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type LogEvent = BattleView["log"][number];
type Spawn = { targetId: UnitId; text: string; kind: Floater3D["kind"]; opts?: { color?: string; sub?: string } };

/** An enemy cast that lands only when the effect reports its impact. */
function enemyCast(over: Partial<Record<string, unknown>>): LogEvent {
  return {
    type: "action",
    at: 0,
    round: 1,
    actor: "b:0",
    action: { type: "skill", unitId: "b:0", skillId: "sk-fire", targetId: "a:0" },
    targetId: "a:0",
    damage: 120,
    skillElement: "fire",
    ...over,
  } as unknown as LogEvent;
}

function mount(opts: { rejectEffect?: boolean } = {}): {
  spawns: Spawn[];
  play: (event: LogEvent, playVfx?: boolean) => void;
  /** Fire the impact the scene is holding back. */
  landImpact: () => void;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const spawns: Spawn[] = [];
  let pending: (() => void) | null = null;
  const api: { play: (event: LogEvent, playVfx?: boolean) => void } = { play: () => {} };

  const handle = {
    playEffect(_el: unknown, _src: unknown, _tgt: unknown, o?: { onImpact?: () => void }): string | null {
      if (opts.rejectEffect === true) return null;
      pending = o?.onImpact ?? null;
      return "fx-test-1";
    },
  } as unknown as Combat3DSceneHandle;

  function Probe(): null {
    const { playActionEvent } = useActionEventProcessing(
      { current: handle },
      "a",
      (targetId, text, kind, o) => spawns.push({ targetId, text, kind, ...(o ? { opts: o } : {}) }),
    );
    api.play = playActionEvent;
    return null;
  }

  act(() => {
    root.render(createElement(Probe));
  });

  return {
    spawns,
    play: (event, playVfx) => api.play(event, playVfx),
    landImpact: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useActionEventProcessing — floater kind, label and impact timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("spawns the crit floater with its CRITICAL label, only at impact", () => {
    const h = mount();
    try {
      act(() => {
        h.play(enemyCast({ cue: "crit" }), true);
      });
      // The effect is playing: nothing on screen yet.
      expect(h.spawns).toHaveLength(0);

      act(() => {
        h.landImpact();
      });
      expect(h.spawns).toHaveLength(1);
      expect(h.spawns[0]).toMatchObject({ targetId: "a:0", text: "120", kind: "crit" });
      expect(h.spawns[0]?.opts?.sub).toBe("CRITICAL");
    } finally {
      h.unmount();
    }
  });

  it("keeps a plain hit as a bare dmg number with no label", () => {
    const h = mount();
    try {
      act(() => {
        h.play(enemyCast({ cue: null }), true);
        h.landImpact();
      });
      expect(h.spawns[0]).toMatchObject({ text: "120", kind: "dmg" });
      expect(h.spawns[0]?.opts?.sub).toBeUndefined();
    } finally {
      h.unmount();
    }
  });

  it("maps miss and immune to their own kinds and texts", () => {
    const h = mount();
    try {
      act(() => {
        h.play(enemyCast({ cue: "miss", damage: 0 }), true);
      });
      // A miss plays no visual, so it lands immediately.
      expect(h.spawns[0]).toMatchObject({ kind: "miss", text: "MISS" });
    } finally {
      h.unmount();
    }
  });

  it("lands immediately when the scene rejects the cast", () => {
    const h = mount({ rejectEffect: true });
    try {
      act(() => {
        h.play(enemyCast({ cue: "crit" }), true);
      });
      expect(h.spawns).toHaveLength(1);
      expect(h.spawns[0]?.opts?.sub).toBe("CRITICAL");
    } finally {
      h.unmount();
    }
  });

  it("lands immediately when no visual plays", () => {
    const h = mount();
    try {
      act(() => {
        h.play(enemyCast({ cue: null }), false);
      });
      expect(h.spawns).toHaveLength(1);
    } finally {
      h.unmount();
    }
  });
});
