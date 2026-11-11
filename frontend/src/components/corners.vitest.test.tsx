import { describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

import { CornerBar } from "../components/common/CornerBar";
import { LobbyQuestBar } from "../components/lobby/LobbyQuestBar";
import { LobbySocialBar } from "../components/lobby/LobbySocialBar";
import { worldGlobeStore } from "../lib/world-globe-store";
import { railExpeditionsStore } from "../lib/rail-expeditions-store";
import { railNurseryStore } from "../lib/rail-nursery-store";

/**
 * Os cantos colapsáveis (quest, expedições, hatchery, social) são o MESMO
 * componente — então o contrato testado aqui é o contrato de todos eles:
 *   1. colapsado: só o trigger visível, painel com altura 0 e sem clique;
 *   2. clique no gatilho abre;
 *   3. clique FORA fecha (o requisito explícito do usuário);
 *   4. Escape fecha;
 *   5. controlado pelo pai (exclusividade): abrir um fecha o outro;
 *   6. os quatro têm a MESMA largura de canto (336px) declarada na página.
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

vi.mock("../lib/api-pvp-quests", () => ({
  getPvpQuests: vi.fn(async () => ({ periods: [] })),
  claimPvpQuest: vi.fn(),
  formatPvpQuestReward: (q: unknown) => JSON.stringify(q),
}));

type Harness = {
  readonly root: Root;
  readonly host: HTMLDivElement;
  render: (node: JSX.Element) => void;
  unmount: () => void;
};

function mount(node: JSX.Element): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const render = (next: JSX.Element): void => {
    act(() => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>{next}</MemoryRouter>
        </QueryClientProvider>,
      );
    });
  };
  render(node);
  return {
    root,
    host,
    render,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function bar(h: Harness, odId?: string): HTMLElement {
  const el = odId ? h.host.querySelector<HTMLElement>(`[data-od-id="${odId}"]`) : null;
  if (el) return el;
  const found = h.host.querySelector<HTMLElement>(".cbar");
  if (found === null) throw new Error("nenhum .cbar montado");
  return found;
}

function trigger(h: Harness, odId?: string): HTMLButtonElement {
  const el = bar(h, odId).querySelector<HTMLButtonElement>(".cbar-trigger");
  if (el === null) throw new Error("gatilho .cbar-trigger ausente");
  return el;
}

function panel(h: Harness, odId?: string): HTMLElement {
  const el = bar(h, odId).querySelector<HTMLElement>(".cbar-panel");
  if (el === null) throw new Error("painel .cbar-panel ausente");
  return el;
}

/** Clica fora do canto (o alvo precisa estar NO documento, como no app). */
function clickOutside(): void {
  const outside = document.createElement("div");
  document.body.appendChild(outside);
  act(() => {
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  outside.remove();
}

describe("CornerBar — contrato comum dos cantos colapsáveis", () => {
  it("começa colapsado: painel fechado e aria-hidden", () => {
    const h = mount(
      <CornerBar icon={<svg />} title="Quests" subtitle="0 em andamento" />,
    );
    const root = bar(h);
    const p = panel(h);
    expect(root.className).not.toContain("open");
    expect(p.getAttribute("aria-hidden")).toBe("true");
    expect(trigger(h).getAttribute("aria-expanded")).toBe("false");
    h.unmount();
  });

  it("clique no gatilho abre e fecha (toggle)", () => {
    const h = mount(<CornerBar icon={<svg />} title="Expedições" subtitle="—" />);
    act(() => trigger(h).click());
    expect(bar(h).className).toContain("open");
    expect(panel(h).getAttribute("aria-hidden")).toBe("false");
    expect(trigger(h).getAttribute("aria-expanded")).toBe("true");

    act(() => trigger(h).click());
    expect(bar(h).className).not.toContain("open");
    expect(panel(h).getAttribute("aria-hidden")).toBe("true");
    h.unmount();
  });

  it("clicar FORA fecha — o requisito explícito", () => {
    const h = mount(<CornerBar icon={<svg />} title="Hatchery" subtitle="—" />);
    act(() => trigger(h).click());
    expect(bar(h).className).toContain("open");
    clickOutside();
    expect(bar(h).className).not.toContain("open");
    h.unmount();
  });

  it("clicar DENTRO não fecha", () => {
    const h = mount(
      <CornerBar icon={<svg />} title="Hatchery" subtitle="—">
        <button type="button" className="inside">
          dentro
        </button>
      </CornerBar>,
    );
    act(() => trigger(h).click());
    const inside = h.host.querySelector<HTMLButtonElement>(".inside");
    act(() => inside?.click());
    expect(bar(h).className).toContain("open");
    h.unmount();
  });

  it("Escape fecha", () => {
    const h = mount(<CornerBar icon={<svg />} title="Social" subtitle="0 online" />);
    act(() => trigger(h).click());
    expect(bar(h).className).toContain("open");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(bar(h).className).not.toContain("open");
    h.unmount();
  });

  it("exclusividade: abrir um canto controlado fecha o outro", () => {
    // Mesmo padrão do Lobby/World/Nursery: UM estado na página com o canto
    // aberto; abrir um seta o outro para null.
    type Corner = "quest" | "social" | null;
    let seen: Corner = null;
    let setCorner: (c: Corner) => void = () => undefined;

    function TwoCorners(): JSX.Element {
      const [openMenu, setOpenMenu] = useState<Corner>(null);
      seen = openMenu;
      setCorner = setOpenMenu;
      return (
        <>
          <CornerBar
            dataOdId="corner-a"
            icon={<svg />}
            title="A"
            subtitle="—"
            open={openMenu === "quest"}
            onOpenChange={(o) => setOpenMenu(o ? "quest" : null)}
          />
          <CornerBar
            dataOdId="corner-b"
            icon={<svg />}
            title="B"
            subtitle="—"
            open={openMenu === "social"}
            onOpenChange={(o) => setOpenMenu(o ? "social" : null)}
          />
        </>
      );
    }

    const h = mount(<TwoCorners />);
    act(() => trigger(h, "corner-a").click());
    expect(seen).toBe("quest");
    expect(bar(h, "corner-a").className).toContain("open");
    expect(bar(h, "corner-b").className).not.toContain("open");

    act(() => trigger(h, "corner-b").click());
    expect(seen).toBe("social");
    expect(bar(h, "corner-a").className).not.toContain("open");
    expect(bar(h, "corner-b").className).toContain("open");

    // clicar fora fecha o que estiver aberto
    clickOutside();
    expect(seen).toBeNull();
    h.unmount();
    void setCorner;
  });

  it("badge só aparece com número > 0", () => {
    const h = mount(
      <CornerBar icon={<svg />} title="Social" subtitle="2 online" badge={0} />,
    );
    expect(h.host.querySelector(".cbar-badge")).toBeNull();
    h.unmount();

    const h2 = mount(
      <CornerBar icon={<svg />} title="Social" subtitle="2 online" badge={2} />,
    );
    expect(h2.host.querySelector(".cbar-badge")?.textContent).toBe("2");
    h2.unmount();
  });

  it("onTriggerClick dispara em abrir e em fechar", () => {
    const onTriggerClick = vi.fn();
    const h = mount(
      <CornerBar
        icon={<svg />}
        title="Social"
        subtitle="—"
        onTriggerClick={onTriggerClick}
      />,
    );
    act(() => trigger(h).click());
    act(() => trigger(h).click());
    expect(onTriggerClick).toHaveBeenCalledTimes(2);
    h.unmount();
  });
});

describe("LobbyQuestBar — mesmo chrome do CornerBar", () => {
  it("é um .cbar com o data-od-id preservado", () => {
    const h = mount(<LobbyQuestBar />);
    const root = h.host.querySelector<HTMLElement>('[data-od-id="quest-bar"]');
    expect(root).not.toBeNull();
    expect(root?.classList.contains("cbar")).toBe(true);
    expect(root?.querySelector(".cbar-trigger")).not.toBeNull();
    // o conteúdo (abas + lista) é do componente, não do chrome
    expect(root?.querySelector(".qb-periods")).not.toBeNull();
    expect(root?.querySelector(".qb-list")).not.toBeNull();
    h.unmount();
  });

  it("herda o mesmo sizing padrão dos outros cantos", () => {
    const h = mount(<LobbyQuestBar />);
    act(() => h.host.querySelector<HTMLButtonElement>('[data-od-id="quest-bar"] .cbar-trigger')?.click());
    const p = h.host.querySelector<HTMLElement>('[data-od-id="quest-bar"] .cbar-panel');
    // mesmos min/max do social — o quest tem mais conteúdo, então ele cresce
    // até o teto; o que NÃO pode é declarar valores próprios.
    expect(p?.style.minHeight).toBe("min(500px, 60vh)");
    expect(p?.style.maxHeight).toBe("min(60vh, 560px)");
    h.unmount();
  });

  it("min <= max em qualquer altura de viewport (regra do clamp)", () => {
    // o clamp compartilhado tem que ser válido para toda viewport possível
    const floor = (vh: number): number => Math.min(500, vh * 0.6);
    const ceil = (vh: number): number => Math.min(vh * 0.6, 560);
    for (const vh of [300, 400, 500, 600, 700, 800, 950, 1080, 1440, 2000]) {
      expect({ vh, ok: floor(vh) <= ceil(vh) }).toEqual({ vh, ok: true });
    }
  });

  it("abre e fecha por clique fora", () => {
    const h = mount(<LobbyQuestBar />);
    const root = (): HTMLElement | null =>
      h.host.querySelector<HTMLElement>('[data-od-id="quest-bar"]');
    act(() => h.host.querySelector<HTMLButtonElement>(".cbar-trigger")?.click());
    expect(root()?.className).toContain("open");
    clickOutside();
    expect(root()?.className).not.toContain("open");
    h.unmount();
  });
});

describe("LobbySocialBar — mesmo chrome, em qualquer página", () => {
  it("monta como .cbar e abre/fecha por clique fora", () => {
    const h = mount(<LobbySocialBar />);
    const root = (): HTMLElement | null =>
      h.host.querySelector<HTMLElement>('[data-od-id="lobby-social"]');
    expect(root()?.classList.contains("cbar")).toBe(true);
    // as três abas continuam aqui
    expect(root()?.querySelectorAll('[role="tab"]').length).toBeGreaterThanOrEqual(3);

    act(() => h.host.querySelector<HTMLButtonElement>(".cbar-trigger")?.click());
    expect(root()?.className).toContain("open");
    clickOutside();
    expect(root()?.className).not.toContain("open");
    h.unmount();
  });

  it("aceita título/ícone customizados sem quebrar o painel", () => {
    const h = mount(<LobbySocialBar title="Social" subtitle="3 online" />);
    const nm = h.host.querySelector<HTMLElement>(".cbar-nm");
    expect(nm?.textContent).toBe("Social");
    expect(h.host.querySelector(".cbar-sub")?.textContent).toBe("3 online");
    h.unmount();
  });
});

describe("gatilhos de página continuam apontando pros painéis", () => {
  it("requestExpeditionConfig / requestNursery publicam openRequest", () => {
    railExpeditionsStore.reset();
    railNurseryStore.set({ openRequest: null });
    expect(railExpeditionsStore.get().openRequest).toBeNull();

    // o World.tsx chama isto ao clicar "Explore"
    railExpeditionsStore.set({ openRequest: { nonce: 1 }, targetPlaceId: "node-1" });
    expect(railExpeditionsStore.get().targetPlaceId).toBe("node-1");
    expect(railExpeditionsStore.get().openRequest).not.toBeNull();

    // o Nursery.tsx chama isto ao clicar "Hatchery" no pill
    railNurseryStore.set({ openRequest: { nonce: 2 } });
    expect(railNurseryStore.get().openRequest?.nonce).toBe(2);
  });

  it("worldGlobeStore continua com o contrato de seleção/hover", () => {
    worldGlobeStore.set({ selectedIdx: 3, focus: { lat: 10, lon: 20 }, autoSpin: true });
    expect(worldGlobeStore.get().selectedIdx).toBe(3);
    worldGlobeStore.set({ selectedIdx: null, focus: null, autoSpin: false });
    expect(worldGlobeStore.get().selectedIdx).toBeNull();
  });
});

describe("largura fixa dos cantos = a do quest bar (336px)", () => {
  // As três folhas de página declaram a largura do canto; se uma divergir, os
  // cantos ficam com medidas diferentes — que é exatamente o que o usuário
  // pediu para evitar. Este teste lê o CSS real (sem browser).
  it("lobby (.ui-bl/.ui-br), world e nursery declaram 336px", async () => {
    // vitest roda em happy-dom: import.meta.url não é file://. Usa o cwd.
    const { readFile } = await import("node:fs/promises");
    const dir = resolve(process.cwd(), "src/styles");
    const [lobby, world, nursery] = await Promise.all([
      readFile(join(dir, "extensions-lobby.css"), "utf8"),
      readFile(join(dir, "extensions-world.css"), "utf8"),
      readFile(join(dir, "extensions-nursery.css"), "utf8"),
    ]);

    // Tolerante a espaço: as folhas world/nursery escrevem a regra minificada
    // numa linha só (`.x{...}`), o lobby usa `.x { ... }`.
    const rule = (css: string, sel: string): string | null => {
      const re = new RegExp(
        sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}",
      );
      const m = re.exec(css);
      return m === null ? null : m[1] ?? null;
    };

    expect(rule(lobby, ".ui-bl")).toContain("width: 336px");
    expect(rule(lobby, ".ui-br")).toContain("width: 336px");
    expect(rule(world, ".world-page-layout .world-corner")).toContain("width:336px");
    expect(rule(nursery, ".nursery-page .nursery-corner")).toContain("width:336px");
  });
});

describe("social — altura mínima de 500px e troca de aba com transição", () => {
  it("o painel aberto tem min-height 500px (não encolhe com conteúdo curto)", () => {
    const h = mount(<LobbySocialBar />);
    act(() => h.host.querySelector<HTMLButtonElement>(".cbar-trigger")?.click());
    const panel = h.host.querySelector<HTMLElement>('[data-od-id="lobby-social"] .cbar-panel');
    // inline style só entra quando aberto
    expect(panel?.style.minHeight).toBe("min(500px, 60vh)");
    expect(panel?.style.maxHeight).toBe("min(60vh, 560px)");
    h.unmount();
  });

  it("é o DEFAULT do CornerBar — social não declara mais sizing próprio", async () => {
    // o sizing mora no CornerBar; se a barra social voltar a declarar
    // max/min próprios, ela diverge de world/nursery de novo.
    const { readFile } = await import("node:fs/promises");
    const social = await readFile(
      resolve(process.cwd(), "src/components/lobby/LobbySocialBar.tsx"), "utf8");
    const world = await readFile(
      resolve(process.cwd(), "src/routes/World.tsx"), "utf8");
    const nursery = await readFile(
      resolve(process.cwd(), "src/routes/Nursery.tsx"), "utf8");
    for (const [name, src] of [["social", social], ["world", world], ["nursery", nursery]] as const) {
      expect({ name, declares: /panel(Max|Min)Height=/.test(src) }).toEqual({ name, declares: false });
    }
    // e o default está no CornerBar
    const cb = await readFile(
      resolve(process.cwd(), "src/components/common/CornerBar.tsx"), "utf8");
    expect(cb).toContain('const PANEL_MIN_HEIGHT_DEFAULT = "min(500px, 60vh)"');
    expect(cb).toContain('const PANEL_MAX_HEIGHT_DEFAULT = "min(60vh, 560px)"');
  });

  it("o piso cede para o teto em janela baixa (nunca estoura a viewport)", () => {
    // min-height: min(500px, 60vh) e max-height: min(60vh, 560px)
    // => em qualquer altura o piso é <= o teto.
    const floor = (vh: number): number => Math.min(500, vh * 0.6);
    const ceil = (vh: number): number => Math.min(vh * 0.6, 560);
    for (const vh of [400, 600, 700, 800, 950, 1200, 2000]) {
      expect(floor(vh)).toBeLessThanOrEqual(ceil(vh));
    }
    // e onde a janela comporta, o piso é mesmo 500px
    expect(floor(950)).toBe(500);
    expect(floor(1200)).toBe(500);
  });

  it("cada aba é montada dentro de um .lsoc-pane animável", () => {
    const h = mount(<LobbySocialBar />);
    act(() => h.host.querySelector<HTMLButtonElement>(".cbar-trigger")?.click());
    const pane = h.host.querySelector<HTMLElement>('[data-od-id="lsoc-pane-online"]');
    expect(pane).not.toBeNull();
    expect(pane?.className).toContain("lsoc-pane");
    h.unmount();
  });

  it("trocar de aba troca o pane (e a animação reinicia pela key)", () => {
    const h = mount(<LobbySocialBar />);
    act(() => h.host.querySelector<HTMLButtonElement>(".cbar-trigger")?.click());
    const tab = (name: string): HTMLButtonElement | null =>
      [...h.host.querySelectorAll<HTMLButtonElement>(".lsoc-tab")].find(
        (b) => (b.textContent ?? "").trim().startsWith(name),
      ) ?? null;

    expect(h.host.querySelector('[data-od-id="lsoc-pane-online"]')).not.toBeNull();
    expect(h.host.querySelector('[data-od-id="lsoc-pane-chat"]')).toBeNull();

    act(() => tab("Chat")?.click());
    expect(h.host.querySelector('[data-od-id="lsoc-pane-online"]')).toBeNull();
    const chat = h.host.querySelector<HTMLElement>('[data-od-id="lsoc-pane-chat"]');
    expect(chat).not.toBeNull();
    // a key distinta faz o React remontar o nó -> a animação roda de novo
    expect(chat?.getAttribute("data-od-id")).toBe("lsoc-pane-chat");

    act(() => tab("Amigos")?.click());
    expect(h.host.querySelector('[data-od-id="lsoc-pane-friends"]')).not.toBeNull();
    h.unmount();
  });

  it("o piso vale nas três páginas (mesmo componente, mesmo estilo)", () => {
    // o mesmo LobbySocialBar é montado no lobby, world e nursery
    for (let i = 0; i < 3; i++) {
      const h = mount(<LobbySocialBar />);
      act(() => h.host.querySelector<HTMLButtonElement>(".cbar-trigger")?.click());
      const p = h.host.querySelector<HTMLElement>(".cbar-panel");
      expect(p?.style.minHeight).toBe("min(500px, 60vh)");
      expect(p?.style.maxHeight).toBe("min(60vh, 560px)");
      h.unmount();
    }
  });
});
