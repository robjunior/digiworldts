import { describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

import { World } from "../routes/World";
import { Nursery } from "../routes/Nursery";
import { worldGlobeStore } from "../lib/world-globe-store";
import { railExpeditionsStore } from "../lib/rail-expeditions-store";
import { railNurseryStore } from "../lib/rail-nursery-store";

/**
 * World e Nursery montam DOIS CornerBar cada (esq: expedições/hatchery,
 * dir: social) e ambos devem obeyecer o mesmo contrato do quest bar do lobby:
 * mesma largura, clica abre, clica fora fecha, e só um aberto por vez.
 * Aqui as rotas são montadas de verdade — o que prova o wiring, não só o
 * componente isolado (o corners.vitest.test.tsx cobre o componente).
 */

vi.mock("../hooks/useWebSocket", () => ({
  useWebSocket: () => ({ send: vi.fn(), readyState: 1 }),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "me", name: "Tester" } }),
}));

vi.mock("../lib/api", () => ({
  getFriends: vi.fn(async () => ({ friends: [], incoming: [] })),
  requestFriend: vi.fn(),
  acceptFriend: vi.fn(),
  removeFriend: vi.fn(),
}));

vi.mock("../lib/api-world", () => ({
  getPveWorld: vi.fn(async () => ({
    places: [
      { id: "node-a", name: "Montanha Kokonoe", danger: "Low", maxWildLevel: 3 },
      { id: "node-b", name: "Cidade unknown", danger: "High", maxWildLevel: 8 },
    ],
  })),
  savePveParty: vi.fn(),
  startPveEncounter: vi.fn(),
}));

// ExpeditionsPanel/NurseryPanel batem em muitos endpoints; stub só o suficiente
// para o canto renderizar (o conteúdo não é o que está sob teste aqui).
vi.mock("../components/social/ExpeditionsPanel", () => ({
  ExpeditionsPanel: () => <div className="expeditions-panel" data-testid="exp" />,
}));

vi.mock("../lib/api-adventure", () => ({
  getAdventure: vi.fn(async () => ({
    config: {
      minHours: 1, maxHours: 8, meatPerHour: 10, meatEscalationPerHour: 5,
      encountersPerHour: 3, partySize: 3, maxActive: 3,
    },
    active: [],
    lastCollected: null,
    meatOwned: 0,
  })),
  startAdventure: vi.fn(),
  collectAdventure: vi.fn(),
}));

vi.mock("../lib/api-farm", () => ({
  getFarm: vi.fn(async () => ({ balances: { Meat: 0, Bits: 0, Data: 0 }, credits: 0, netcore: 0, premium: false, premiumBonus: 0, buildings: [] })),
}));
vi.mock("../lib/api-teams", () => ({ getTeams: vi.fn(async () => ({ teams: [] })) }));
vi.mock("../lib/api", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, getRoster: vi.fn(async () => ({ roster: [] })) };
});

vi.mock("../lib/api-nursery", () => ({
  getNursery: vi.fn(async () => ({
    meat: 0, petMoodDelta: 1, feedMoodDelta: 3, feedMeatCost: 1, babyStageMs: 60000,
    inTrainingStageMs: 120000, penMons: [],
  })),
  getSpeciesData: vi.fn(async () => ({ entries: [] })),
  getPendingHatches: vi.fn(async () => ({ pending: [] })),
  petNurseryMon: vi.fn(),
  feedNurseryMon: vi.fn(),
  graduatePenMon: vi.fn(),
  collectPendingHatch: vi.fn(),
  startDirectHatch: vi.fn(),
  startMixHatch: vi.fn(),
}));

vi.mock("../components/world/WorldSceneHost", () => ({ WorldSceneHost: () => null }));
vi.mock("../components/nursery/NurseryPen3D", () => ({ NurseryPen3D: () => <div className="pen3d" /> }));
vi.mock("../lib/api-scenes", () => ({ getNurserySceneEntity: vi.fn(async () => null) }));

function mount(node: JSX.Element) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 20));
  });
}

function clickOutside(): void {
  const outside = document.createElement("div");
  document.body.appendChild(outside);
  act(() => outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  outside.remove();
}

/** O canto social usa data-od-id="lobby-social" no lobby, no world e no nursery. */
const SOCIAL = "lobby-social";

const corner = (host: HTMLElement, odId: string): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`[data-od-id="${odId}"]`);
  if (el === null) throw new Error(`canto ${odId} ausente`);
  return el;
};

const isOpen = (host: HTMLElement, odId: string): boolean =>
  corner(host, odId).classList.contains("open");

describe("World — dois cantos (esq expedições, dir social)", () => {
  it("monta os dois como .cbar, com largura herdada do canto", async () => {
    railExpeditionsStore.reset();
    const h = mount(<World />);
    await flush();
    const left = h.host.querySelector<HTMLElement>('[data-od-id="world-expeditions"]');
    const right = h.host.querySelector<HTMLElement>('[data-od-id="lobby-social"]');
    expect(left?.classList.contains("cbar")).toBe(true);
    expect(right?.classList.contains("cbar")).toBe(true);
    // o chrome é o do CornerBar nos dois
    expect(left?.querySelector(".cbar-trigger")).not.toBeNull();
    expect(right?.querySelector(".cbar-trigger")).not.toBeNull();
    // conteúdo de cada um
    expect(left?.querySelector(".expeditions-panel")).not.toBeNull();
    expect(right?.querySelector(".lsoc-tabs")).not.toBeNull();
    h.unmount();
  });

  it("esq: clica abre, clica fora fecha", async () => {
    railExpeditionsStore.reset();
    const h = mount(<World />);
    await flush();
    const trigger = h.host.querySelector<HTMLButtonElement>('[data-od-id="world-expeditions"] .cbar-trigger');
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
    expect(isOpen(h.host, "world-expeditions")).toBe(true);
    clickOutside();
    expect(isOpen(h.host, "world-expeditions")).toBe(false);
    h.unmount();
  });

  it("dir: clica abre, clica fora fecha", async () => {
    railExpeditionsStore.reset();
    const h = mount(<World />);
    await flush();
    const trigger = h.host.querySelector<HTMLButtonElement>('[data-od-id="lobby-social"] .cbar-trigger');
    act(() => trigger?.click());
    expect(isOpen(h.host, SOCIAL)).toBe(true);
    clickOutside();
    expect(isOpen(h.host, SOCIAL)).toBe(false);
    h.unmount();
  });

  it("só um canto aberto por vez", async () => {
    railExpeditionsStore.reset();
    const h = mount(<World />);
    await flush();
    act(() => h.host.querySelector<HTMLButtonElement>('[data-od-id="world-expeditions"] .cbar-trigger')?.click());
    expect(isOpen(h.host, "world-expeditions")).toBe(true);
    act(() => h.host.querySelector<HTMLButtonElement>('[data-od-id="lobby-social"] .cbar-trigger')?.click());
    expect(isOpen(h.host, SOCIAL)).toBe(true);
    expect(isOpen(h.host, "world-expeditions")).toBe(false);
    h.unmount();
  });

  it("Explore do popup abre o canto e pré-seleciona o node no painel", async () => {
    railExpeditionsStore.reset();
    worldGlobeStore.set({ selectedIdx: 0, focus: { lat: 0, lon: 0 }, autoSpin: false });
    const h = mount(<World />);
    await flush();
    const explore = h.host.querySelector<HTMLButtonElement>(".world-place-popup__act");
    expect(explore).not.toBeNull();
    act(() => explore?.click());
    expect(isOpen(h.host, "world-expeditions")).toBe(true);
    // o store recebeu o node selecionado
    expect(railExpeditionsStore.get().targetPlaceId).toBe("node-a");
    expect(railExpeditionsStore.get().openRequest).not.toBeNull();
    h.unmount();
    worldGlobeStore.set({ selectedIdx: null, focus: null, autoSpin: false });
  });
});

describe("Nursery — dois cantos (esq hatchery, dir social)", () => {
  it("monta os dois como .cbar", async () => {
    railNurseryStore.set({ openRequest: null });
    const h = mount(<Nursery />);
    await flush();
    const left = h.host.querySelector<HTMLElement>('[data-od-id="nursery-hatchery"]');
    const right = h.host.querySelector<HTMLElement>('[data-od-id="lobby-social"]');
    expect(left?.classList.contains("cbar")).toBe(true);
    expect(right?.classList.contains("cbar")).toBe(true);
    expect(right?.querySelector(".lsoc-tabs")).not.toBeNull();
    h.unmount();
  });

  it("o botão Hatchery do pill abre o canto esq e fecha o social", async () => {
    railNurseryStore.set({ openRequest: null });
    function Case(): JSX.Element {
      const [, force] = useState(0);
      void force;
      return <Nursery />;
    }
    const h = mount(<Case />);
    await flush();
    const pill = h.host.querySelector<HTMLButtonElement>(".nure-pill__hatch");
    expect(pill).not.toBeNull();
    act(() => pill?.click());
    expect(isOpen(h.host, "nursery-hatchery")).toBe(true);
    expect(isOpen(h.host, SOCIAL)).toBe(false);
    // O painel é quem consome o openRequest e o reseta (contrato do
    // railNurseryStore) — então aqui ele JÁ voltou a null. O que importa é
    // que o canto abriu, e que o clique fora fecha.
    expect(railNurseryStore.get().openRequest).toBeNull();
    clickOutside();
    expect(isOpen(h.host, "nursery-hatchery")).toBe(false);
    h.unmount();
  });

  it("só um canto aberto por vez", async () => {
    railNurseryStore.set({ openRequest: null });
    const h = mount(<Nursery />);
    await flush();
    act(() => h.host.querySelector<HTMLButtonElement>('[data-od-id="nursery-hatchery"] .cbar-trigger')?.click());
    expect(isOpen(h.host, "nursery-hatchery")).toBe(true);
    act(() => h.host.querySelector<HTMLButtonElement>('[data-od-id="lobby-social"] .cbar-trigger')?.click());
    expect(isOpen(h.host, SOCIAL)).toBe(true);
    expect(isOpen(h.host, "nursery-hatchery")).toBe(false);
    h.unmount();
  });
});
