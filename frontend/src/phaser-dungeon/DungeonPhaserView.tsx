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
  /** Client-side prediction: predicted leader cell to render immediately (see
   * DungeonPhaserScene.SceneProps.overrideLeaderX/Y). Undefined = use server. */
  readonly overrideLeaderX?: number | undefined;
  readonly overrideLeaderY?: number | undefined;
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
    overrideLeaderX,
    overrideLeaderY,
  } = props;

  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<DungeonPhaserScene | null>(null);

  type ViewProps = {
    active: DungeonRunView;
    neighbors: readonly DungeonGridNeighbor[];
    remotePlayers: readonly DungeonRemotePlayer[];
    party: readonly RosterView[];
    facing: Facing;
    moveDurationMs: number;
    partyTrail: readonly { readonly x: number; readonly y: number }[];
    onCellClick: (x: number, y: number) => void;
    onPlayerClick: (
      userId: string,
      displayName: string,
      x: number,
      y: number,
    ) => void;
    onTextureFallback: (failed: readonly TilesetGrant[]) => void;
    overrideLeaderX?: number;
    overrideLeaderY?: number;
  };
  const latestPropsRef = useRef<ViewProps>({
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
  const nextViewProps: ViewProps = {
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
  if (overrideLeaderX !== undefined) nextViewProps.overrideLeaderX = overrideLeaderX;
  if (overrideLeaderY !== undefined) nextViewProps.overrideLeaderY = overrideLeaderY;
  latestPropsRef.current = nextViewProps;

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
        props.overrideLeaderX,
        props.overrideLeaderY,
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
      overrideLeaderX,
      overrideLeaderY,
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
    overrideLeaderX,
    overrideLeaderY,
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
