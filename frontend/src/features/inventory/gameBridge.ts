/**
 * Decoupling layer between the Phaser game world and the React inventory UI
 * (brief section 14).
 *
 * The rule: React components NEVER reach into Phaser objects. Instead, the
 * game world (Phaser) emits INTENTS / STATE CHANGES through a typed event bus,
 * and the React side subscribes. This file is the ONLY place that knows about
 * the event contract; it is engine-agnostic (no Phaser import) so it can be
 * driven by a mock, a test, or a real Phaser scene interchangeably.
 *
 * Examples of events this bus carries:
 *  - 'vault:areaChanged'  -> Phaser tells us the player entered/left a city.
 *  - 'inventory:pickup'   -> Phaser tells us the player grabbed a drop.
 *  - 'vault:accessItem'   -> Phaser tells us an access item was granted.
 *  - 'party:changed'      -> roster mutation affecting capacity.
 *
 * The React side wires these to the Zustand store reducers (see bridgeToStore).
 */

import type { Stage } from '@digiworld/shared';
import type { StackInput } from './stacking';

export interface GameBridgeEvents {
  'vault:areaChanged': { inVaultArea: boolean };
  'vault:accessItemChanged': { ownedAccessItemIds: ReadonlyArray<string> };
  'inventory:pickup': { inputs: ReadonlyArray<StackInput> };
  'vault:deposit': { inputs: ReadonlyArray<StackInput> };
  'party:changed': { party: ReadonlyArray<{ id: string; stage: Stage }> };
}

type Handler<E extends keyof GameBridgeEvents> = (payload: GameBridgeEvents[E]) => void;

/**
 * Tiny typed pub/sub. Framework-free on purpose — Phaser can import this
 * without pulling React in, and React subscribes without importing Phaser.
 */
export class GameBridge {
  private handlers: { [E in keyof GameBridgeEvents]?: Set<Handler<E>> } = {};

  on<E extends keyof GameBridgeEvents>(event: E, handler: Handler<E>): () => void {
    let set = this.handlers[event] as Set<Handler<E>> | undefined;
    if (!set) {
      set = new Set<Handler<E>>();
      this.handlers[event] = set as { [K in keyof GameBridgeEvents]?: Set<Handler<K>> }[E];
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit<E extends keyof GameBridgeEvents>(event: E, payload: GameBridgeEvents[E]): void {
    const set = this.handlers[event] as Set<Handler<E>> | undefined;
    if (!set) return;
    for (const h of set) h(payload);
  }
}

/**
 * Wire a GameBridge to the container store. A real Phaser scene would call
 * `bridge.emit('inventory:pickup', …)`; this keeps the store as the single
 * source of truth and the React UI re-renders purely off store + selectors.
 */
export function bridgeToStore(
  bridge: GameBridge,
  store: ReturnType<typeof import('./store').createContainerStore>,
): () => void {
  const unsubs: Array<() => void> = [];

  unsubs.push(
    bridge.on('inventory:pickup', ({ inputs }) => store.getState().addInventoryItems(inputs)),
  );
  unsubs.push(
    bridge.on('vault:deposit', ({ inputs }) => store.getState().addVaultItems(inputs)),
  );
  unsubs.push(
    bridge.on('party:changed', ({ party }) => store.getState().setParty(party)),
  );

  return () => {
    for (const off of unsubs) off();
  };
}

/** Shared singleton bus for the spike demo (a real app would scope per-session). */
export const gameBridge = new GameBridge();
