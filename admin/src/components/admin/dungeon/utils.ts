import type { Cell, PathTool, Difficulty } from './types';
import type { DungeonTile } from '@digiworld/shared';
import { STAGES, type Stage } from '@digiworld/shared/digimon';

export function tileKey(tile: DungeonTile): string { return `${tile.x},${tile.y}`; }
export function cellKey(cell: Cell): string { return `${cell.x},${cell.y}`; }
export function tileGidMap(tiles: readonly DungeonTile[]): Map<string, number> { return new Map(tiles.map((tile) => [tileKey(tile), tile.gid])); }
export function tilesFromMap(gidByCoord: ReadonlyMap<string, number>): readonly DungeonTile[] { return [...gidByCoord].map(([key, gid]) => { const [rawX, rawY] = key.split(','); return { x: Number(rawX), y: Number(rawY), gid }; }).sort((a, b) => a.y - b.y || a.x - b.x); }
export function titleCase(value: string): string { return value.charAt(0) + value.slice(1).toLowerCase(); }
export function pathIcon(value: PathTool): string { switch (value) { case 'PAINT': return '◆'; case 'LINE': return '╱'; case 'RECTANGLE': return '▣'; default: return assertNever(value); } }
export function rectangleFill(a: Cell, b: Cell): readonly Cell[] { const cells: Cell[] = []; for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y += 1) for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x += 1) cells.push({ x, y }); return cells; }
export function bresenhamLine(a: Cell, b: Cell): readonly Cell[] { const cells: Cell[] = []; let x0 = a.x; let y0 = a.y; const dx = Math.abs(b.x - x0); const sx = x0 < b.x ? 1 : -1; const dy = -Math.abs(b.y - y0); const sy = y0 < b.y ? 1 : -1; let err = dx + dy; while (true) { cells.push({ x: x0, y: y0 }); if (x0 === b.x && y0 === b.y) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } } return cells; }
export function replaceAt<T>(items: readonly T[], index: number, value: T): T[] { return items.map((entry, entryIndex) => entryIndex === index ? value : entry); }
export function toOptionalText(value: FormDataEntryValue | null): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
export function toDifficulty(value: FormDataEntryValue | null): Difficulty { return value === 'easy' || value === 'normal' || value === 'elite' || value === 'boss' ? value : 'normal'; }
export function toStage(value: FormDataEntryValue | null): Stage { return typeof value === 'string' && STAGES.includes(value as Stage) ? value as Stage : 'Rookie'; }
export function toPositiveInt(value: FormDataEntryValue | null, fallback: number): number { const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN; return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
export function toFloat(value: FormDataEntryValue | null, fallback: number): number { const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : fallback; }
export function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
export function assertNever(value: never): never { throw new Error(`Unhandled value: ${String(value)}`); }
