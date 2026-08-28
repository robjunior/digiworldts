/**
 * Spike demo page (brief section 8 result + section 16 acceptance).
 *
 * Renders ONE `ItemContainer` instance for the Inventory and ANOTHER for the
 * Vault. Both consume `useItemContainer` + the same components; the only
 * differences are the raw state fed in and the capacity/access derived from it.
 *
 * Interactive controls prove the dynamic rules: change a party member's stage,
 * toggle a city vs item vault access, add an expansion — the grids + "X / Y"
 * headers update automatically because capacity is DERIVED.
 */

import { useMemo, useState, type JSX } from 'react';

import type { Stage } from '@digiworld/shared';

import { createContainerStore } from './store';
import { deriveInventoryCapacity, deriveVaultCapacity } from './capacity';
import { resolveVaultAccess, vaultAccessLabel } from './vaultAccess';
import { useItemContainer } from './useItemContainer';
import { ItemContainer } from './components/ItemContainer';
import {
  DEMO_CATALOG,
  DEMO_PARTY,
  DEMO_INVENTORY_EXPANSIONS,
  DEMO_VAULT_EXPANSIONS,
  DEMO_INVENTORY_SLOTS,
  DEMO_VAULT_SLOTS,
} from './demoFixtures';
import './inventorySpike.css';

const STAGE_OPTIONS: ReadonlyArray<Stage> = ['Baby', 'In-Training', 'Rookie', 'Champion', 'Ultimate', 'Mega'];

export function InventorySpikeDemo(): JSX.Element {
  // --- Game state (server state) via Zustand store -------------------------
  const store = useMemo(
    () =>
      createContainerStore(
        DEMO_CATALOG,
        {
          slots: DEMO_INVENTORY_SLOTS,
          expansions: DEMO_INVENTORY_EXPANSIONS,
          party: DEMO_PARTY,
          baseSlots: 6,
        },
        {
          slots: DEMO_VAULT_SLOTS,
          expansions: DEMO_VAULT_EXPANSIONS,
          baseSlots: 100,
        },
      ),
    [],
  );

  const inventory = store((s) => s.inventory);
  const vault = store((s) => s.vault);
  const catalog = store((s) => s.catalog);

  // --- Vault access UI state (driven by a permission resolver, not the UI) --
  const [inVaultArea, setInVaultArea] = useState(false);
  const [hasRemoteItem, setHasRemoteItem] = useState(false);

  const vaultAccess = useMemo(
    () =>
      resolveVaultAccess({
        inVaultArea,
        ownedAccessItemIds: hasRemoteItem ? ['remote-vault'] : [],
        remoteAccessItemIds: ['remote-vault'],
      }),
    [inVaultArea, hasRemoteItem],
  );

  // --- Derived capacities (recompute from raw state automatically) ---------
  const invCap = useMemo(() => deriveInventoryCapacity(inventory), [inventory]);
  const vaultCap = useMemo(() => deriveVaultCapacity(vault), [vault]);

  // --- Container hooks (UI state + memoised derived grid) -------------------
  const inv = useItemContainer({
    stacks: inventory.slots,
    catalog,
    capacity: invCap.total,
    initialFilter: { category: 'all' },
  });
  const vlt = useItemContainer({
    stacks: vault.slots,
    catalog,
    capacity: vaultCap.total,
  });

  // --- Demo interactions ----------------------------------------------------
  const bumpStage = (monId: string): void => {
    const party = inventory.party.map((m) => {
      if (m.id !== monId) return m;
      const idx = STAGE_OPTIONS.indexOf(m.stage);
      const next = STAGE_OPTIONS[Math.min(idx + 1, STAGE_OPTIONS.length - 1)]!;
      return { ...m, stage: next };
    });
    store.getState().setParty(party);
  };

  const addInventoryExpansion = (): void => {
    const n = inventory.expansions.length + 1;
    store.getState().setInventoryExpansions([
      ...inventory.expansions,
      { id: `exp-${n}`, slots: 2 },
    ]);
  };

  const addVaultExpansion = (): void => {
    const n = vault.expansions.length + 1;
    store.getState().setVaultExpansions([...vault.expansions, { id: `vault-exp-${n}`, slots: 100 }]);
  };

  const invBreakdown = [
    { label: 'Base', slots: invCap.base },
    { label: 'Party', slots: invCap.party },
    { label: 'Expansion', slots: invCap.expansion },
  ];
  const vaultBreakdown = [
    { label: 'Base', slots: vaultCap.base },
    { label: 'Expansion', slots: vaultCap.expansion },
  ];

  return (
    <div className="ic-spike-page">
      <div className="ic-spike-controls">
        <h1>Inventory / Vault Spike</h1>
        <div className="ic-ctl-group">
          <strong>Party (drives inventory capacity):</strong>
          {inventory.party.map((m) => (
            <button key={m.id} type="button" className="ic-ctl-btn" onClick={() => bumpStage(m.id)}>
              {m.id} · {m.stage} → +
              {invCap.partyByMember.find((p) => p.sourceId === m.id)?.slots ?? 0} slots
            </button>
          ))}
        </div>
        <div className="ic-ctl-group">
          <button type="button" className="ic-ctl-btn" onClick={addInventoryExpansion}>
            + Inventory expansion (2 slots)
          </button>
          <button type="button" className="ic-ctl-btn" onClick={addVaultExpansion}>
            + Vault expansion (100 slots)
          </button>
        </div>
        <div className="ic-ctl-group">
          <strong>Vault access (permission layer):</strong>
          <label className="ic-ctl-check">
            <input type="checkbox" checked={inVaultArea} onChange={(e) => setInVaultArea(e.target.checked)} />
            In a city
          </label>
          <label className="ic-ctl-check">
            <input type="checkbox" checked={hasRemoteItem} onChange={(e) => setHasRemoteItem(e.target.checked)} />
            Own remote-access item
          </label>
          <span className="ic-access-state">→ {vaultAccessLabel(vaultAccess)}</span>
        </div>
      </div>

      <div className="ic-spike-containers">
        <ItemContainer
          title="INVENTORY"
          container={inv}
          used={inv.view.usedCapacity}
          total={invCap.total}
          columns={6}
          capacityBreakdown={invBreakdown}
          enabled
        />

        <div className="ic-vault-gate" data-od-id="vault-gate">
          ↓ {vaultAccess.available ? `Vault open (${vaultAccess.source})` : 'Vault Access'} ↓
        </div>

        <ItemContainer
          title="VAULT"
          container={vlt}
          used={vlt.view.usedCapacity}
          total={vaultCap.total}
          columns={8}
          virtualized={vaultCap.total > 60}
          capacityBreakdown={vaultBreakdown}
          enabled={vaultAccess.available}
          disabledReason="Vault unavailable — enter a city or use a remote-access item."
        />
      </div>
    </div>
  );
}
