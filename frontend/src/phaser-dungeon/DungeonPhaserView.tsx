import Phaser from "phaser";
import { useEffect, useRef, type ReactElement, type RefObject } from "react";

import type {
  DungeonGridNeighbor,
  DungeonRemotePlayer,
  DungeonRunView,
  TilesetGrant,
} from "@digiworld/shared";
import type { RosterView } from "../lib/api";
import {
  DUNGEON_SCENE_KEY,
  DungeonPhaserScene,
  type Facing,
} from "./DungeonPhaserScene";
import { createDungeonGame } from "./createGame";

type DungeonPhaserViewProps = {
  readonly viewportRef: RefObject<HTMLDivElement>;
  readonly active: DungeonRunView;
  readonly neighbors: readonly DungeonGridNeighbor[];
  readonly remotePlayers: readonly DungeonRemotePlayer[];
  readonly party: readonly RosterView[];
  readonly facing: Facing;
  readonly moveDurationMs: number;
  readonly partyTrail: readonly { readonly x: number; readonly y: number }[];
  readonly onCellClick: (x: number, y: number) => void;
  readonly onPlayerClick: (
    userId: string,
    displayName: string,
    x: number,
    y: number,
  ) => void;
  readonly onTextureFallback: (failed: readonly TilesetGrant[]) => void;
};

export function DungeonPhaserView(props: DungeonPhaserViewProps): ReactElement {
  const {
    viewportRef,
    active,
    neighbors,
    remotePlayers,
    party,
    facing,
    moveDurationMs,
    partyTrail,
    onCellClick,
    onPlayerClick,
    onTextureFallback,
  } = props;

  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<DungeonPhaserScene | null>(null);

  const latestPropsRef = useRef({
    active,
    neighbors,
    remotePlayers,
    party,
    facing,
    moveDurationMs,
    partyTrail,
    onCellClick,
    onPlayerClick,
    onTextureFallback,
  });
  latestPropsRef.current = {
    active,
    neighbors,
    remotePlayers,
    party,
    facing,
    moveDurationMs,
    partyTrail,
    onCellClick,
    onPlayerClick,
    onTextureFallback,
  };

  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;

    const game = createDungeonGame(container);
    gameRef.current = game;

    const applyProps = (): void => {
      const scene = sceneRef.current;
      if (!scene || !scene.isAlive()) return;
      const props = latestPropsRef.current;
      scene.setProps(
        props.active,
        props.neighbors,
        props.remotePlayers,
        props.party,
        props.facing,
        props.moveDurationMs,
        props.partyTrail,
        props.onCellClick,
        props.onPlayerClick,
        props.onTextureFallback,
      );
    };

    game.events.once(Phaser.Core.Events.READY, () => {
      const scene = game.scene.getScene<DungeonPhaserScene>(DUNGEON_SCENE_KEY);
      sceneRef.current = scene;
      applyProps();
    });

    return () => {
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, [viewportRef]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !scene.isAlive()) return;
    scene.setProps(
      active,
      neighbors,
      remotePlayers,
      party,
      facing,
      moveDurationMs,
      partyTrail,
      onCellClick,
      onPlayerClick,
      onTextureFallback,
    );
  }, [
    active,
    neighbors,
    remotePlayers,
    party,
    facing,
    moveDurationMs,
    partyTrail,
    onCellClick,
    onPlayerClick,
    onTextureFallback,
  ]);

  useEffect(() => {
    const game = gameRef.current;
    const container = viewportRef.current;
    if (!game || !container) return;
    const resize = (): void => {
      game.scale.resize(container.clientWidth, container.clientHeight);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [viewportRef]);

  return (
    <div
      ref={viewportRef}
      className="continuous-dungeon-grid"
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    />
  );
}
