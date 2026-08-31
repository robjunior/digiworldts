/**
 * Render smoke test for the shared container component (brief section 16:
 * "ItemSlot/ItemGrid reusable", "Inventory and Vault share components").
 *
 * Uses react-dom/client + happy-dom (both already in the frontend toolchain)
 * so no extra test dependency is required. Asserts the SAME ItemContainer
 * renders an inventory and a vault instance, and that the capacity readout +
 * reusable filter chips appear in both.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { flushSync } from 'react-dom';

import { createContainerStore } from './store';
import { deriveInventoryCapacity, deriveVaultCapacity } from './capacity';
import { useItemContainer } from './useItemContainer';
import { ItemContainer } from './components/ItemContainer';
import { InventorySpikeDemo } from './InventorySpikeDemo';
import { DEMO_CATALOG, DEMO_PARTY, DEMO_INVENTORY_SLOTS, DEMO_VAULT_SLOTS } from './demoFixtures';

function mount(which: 'inventory' | 'vault'): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);

  function Harness(): JSX.Element {
    const store = createContainerStore(DEMO_CATALOG, {
      slots: DEMO_INVENTORY_SLOTS,
      expansions: [{ id: 'backpack', slots: 3 }],
      party: DEMO_PARTY,
      baseSlots: 6,
    }, {
      slots: DEMO_VAULT_SLOTS,
      expansions: [{ id: 'p1', slots: 50 }],
      baseSlots: 100,
    });
    const s = store.getState();
    const cap = which === 'inventory' ? deriveInventoryCapacity(s.inventory) : deriveVaultCapacity(s.vault);
    const stacks = which === 'inventory' ? s.inventory.slots : s.vault.slots;
    const container = useItemContainer({ stacks, catalog: s.catalog, capacity: cap.total });
    return createElement(ItemContainer, {
      title: which.toUpperCase(),
      container,
      used: container.view.usedCapacity,
      total: cap.total,
      columns: 6,
    });
  }

  const root = createRoot(host);
  act(() => {
    flushSync(() => root.render(createElement(Harness)));
  });
  return host;
}

function byLabel(host: HTMLElement, label: string): HTMLElement {
  const el = host.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error(`No element with aria-label="${label}"`);
  return el as HTMLElement;
}

function byRoleTab(host: HTMLElement, name: RegExp): HTMLElement {
  const els = Array.from(host.querySelectorAll('[role="tab"]'));
  const found = els.find((e) => name.test(e.textContent ?? ''));
  if (!found) throw new Error(`No tab matching ${name}`);
  return found as HTMLElement;
}

describe('ItemContainer renders for both inventory and vault', () => {
  it('renders the inventory shell with capacity readout + filter chips', () => {
    const host = mount('inventory');
    expect(host.textContent).toContain('INVENTORY');
    // capacity = 6 base + (1+2+3) party + 3 expansion = 15; 5 occupied
    expect(byLabel(host, '5 of 15 slots used')).toBeTruthy();
    expect(byRoleTab(host, /Consumables/)).toBeTruthy();
    expect(byRoleTab(host, /Materials/)).toBeTruthy();
  });

  it('renders the vault shell with a larger capacity ceiling', () => {
    const host = mount('vault');
    expect(host.textContent).toContain('VAULT');
    // vault = 100 base + 50 expansion = 150; 6 occupied
    expect(byLabel(host, '6 of 150 slots used')).toBeTruthy();
  });

  it('both instances expose the same reusable grid role', () => {
    const inv = mount('inventory');
    const vault = mount('vault');
    expect(inv.querySelector('[role="grid"]')).toBeTruthy();
    expect(vault.querySelector('[role="grid"]')).toBeTruthy();
  });
});

describe('full InventorySpikeDemo page mounts end-to-end', () => {
  it('renders both containers + interactive capacity/access controls without runtime errors', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      flushSync(() => {
        root.render(createElement(InventorySpikeDemo));
      });
    });
    expect(host.textContent).toContain('INVENTORY');
    expect(host.textContent).toContain('VAULT');
    // initial inventory capacity: 6 base + (1+2+3) party + 3 expansion = 15
    expect(byLabel(host, '5 of 15 slots used')).toBeTruthy();
    // vault starts locked (no city / no item) -> shows disabled reason
    expect(host.textContent).toContain('Vault unavailable');
    // controls present: party buttons + access toggles
    expect(host.textContent).toContain('Party (drives inventory capacity)');
    expect(host.textContent).toContain('Vault access (permission layer)');
    expect((root as ReturnType<typeof createRoot>).unmount).toBeTypeOf('function');
  });
});
