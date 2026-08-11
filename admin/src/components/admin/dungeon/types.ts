import type { DungeonEncounter } from '@digiworld/shared';

export type Tool = 'PATH' | 'SPAWN' | 'ENCOUNTERS' | 'BOSS' | 'ITEMS' | 'WARPS' | 'DOORS' | 'RANDOM' | 'TRAPS' | 'ZONES' | 'CHESTS';
export type PathTool = 'PAINT' | 'LINE' | 'RECTANGLE';
export type Cell = { readonly x: number; readonly y: number };
export type Difficulty = DungeonEncounter['difficulty'];

export const TOOLS: readonly Tool[] = ['PATH', 'SPAWN', 'ENCOUNTERS', 'BOSS', 'ITEMS', 'WARPS', 'DOORS', 'RANDOM', 'TRAPS', 'ZONES', 'CHESTS'] as const;
export const PATH_TOOLS: readonly PathTool[] = ['PAINT', 'LINE', 'RECTANGLE'] as const;
