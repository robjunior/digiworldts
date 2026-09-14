/**
 * DigiWorld — Design Tokens (single source of truth)
 *
 * The "new" DigiWorld palette: dark navy canvas + signal blue + gold accent.
 * This module exports the same tokens that lobby + roster use so every screen
 * can import from one place instead of re-declaring hex values.
 *
 * Usage in TSX:
 *   import { colors, spacing, notch, typeface } from '../styles/design-tokens';
 *   <div style={{ background: colors.panel, padding: spacing.md }}>
 *
 * Usage in CSS (inject into :root):
 *   import { cssVariables } from '../styles/design-tokens';
 *   // or just reference the CSS custom properties directly — they're defined
 *   // in tokens.css under the same names.
 */

// ─── Core palette (DigiWorld blue/gold/dark-navy) ───────────────────────────

export const colors = {
  /** Deep navy canvas */
  bg: '#0a0e1a',
  /** Primary surface */
  panel: '#141c2e',
  /** Elevated surface / hover */
  panel2: '#1a2440',
  /** Primary text (off-white blue) */
  ink: '#e8f0ff',
  /** Secondary text */
  muted: '#6b7a99',
  /** Hairline border */
  hair: '#1e2a44',
  /** Primary action blue */
  signal: '#3b82f6',
  /** Lighter blue (hover, glow text) */
  signal2: '#60a5fa',
  /** Premium/accent gold */
  gold: '#f59e0b',
  /** Gold text/highlight */
  goldBright: '#fbbf24',
  /** Semantic alias to gold (warning/danger) */
  battle: '#f59e0b',
} as const;

// ─── Element tints (11-element taxonomy, DigiWorld blue-derived) ─────────────

export const elements = {
  fire: '#e6001f', // kept as-is for combat readability
  water: colors.signal,
  plant: '#34d399', // nature green
  electricity: '#fbbf24', // electric yellow
  wind: '#94a3b8', // slate
  ice: '#c7eafb', // ice blue
  earth: '#a38566', // brown
  steel: '#9ca3af', // steel gray
  light: '#fef3c7', // warm white
  dark: '#7c3aed', // purple
  null: colors.muted,
} as const;

// ─── Resource tints ──────────────────────────────────────────────────────────

export const resources = {
  meat: '#d97706', // amber
  bits: colors.signal,
  data: '#8b5cf6', // violet
  credits: '#f59e0b', // gold
  good: '#34d399', // green
  win: '#34d399', // green
} as const;

// ─── Combat gauges ───────────────────────────────────────────────────────────

export const gauges = {
  hp: '#39d353', // green
  en: '#e8b53a', // amber
  atb: colors.signal,
  crit: '#34d399',
  miss: colors.muted,
  resist: colors.muted,
  enemy: colors.battle,
  ally: colors.signal,
  lock: '#34d399',
} as const;

// ─── Stat tints ──────────────────────────────────────────────────────────────

export const stats = {
  hp: colors.battle,
  en: '#f59e0b',
  atk: '#ef4444', // red
  def: '#94a3b8', // slate
  int: '#8b5cf6', // violet
  spd: '#34d399', // green
} as const;

// ─── Tier / rarity ───────────────────────────────────────────────────────────

export const tiers = {
  common: colors.muted,
  uncommon: '#34d399',
  rare: colors.signal,
  epic: '#8b5cf6',
  legendary: colors.battle,
} as const;

// ─── Status ailments ─────────────────────────────────────────────────────────

export const statusAilments = {
  burn: elements.fire,
  poison: elements.plant,
  weaken: colors.muted,
  freeze: elements.ice,
  stun: colors.gold,
  sleep: elements.water,
} as const;

// ─── Social ──────────────────────────────────────────────────────────────────

export const social = {
  online: '#34d399',
  offline: colors.muted,
  premium: '#34d399',
  claimDone: '#34d399',
  claimNext: colors.signal,
  claimTodo: colors.hair,
} as const;

// ─── Typography ──────────────────────────────────────────────────────────────

export const typeface = {
  family: "'Inter', system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
  size: {
    xs: 9,
    sm: 10,
    md: 11,
    base: 12,
    lg: 13,
    xl: 14,
    '2xl': 16,
    '3xl': 20,
    '4xl': 24,
    '5xl': 26,
  },
  weight: {
    normal: 500,
    medium: 600,
    bold: 700,
    extrabold: 800,
    black: 900,
  },
  letterSpacing: {
    tight: '-.02em',
    normal: 0,
    wide: '.06em',
    wider: '.14em',
    widest: '.22em',
  },
} as const;

// ─── Spacing (8px baseline) ──────────────────────────────────────────────────

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
} as const;

// ─── Notch shapes (cyberpunk clip-paths) ─────────────────────────────────────

export const notch = {
  lg: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)',
  md: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
  sm: 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
  xs: 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)',
} as const;

// ─── Motion ──────────────────────────────────────────────────────────────────

export const motion = {
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
  duration: {
    fast: 100,
    normal: 150,
    slow: 200,
    slower: 350,
  },
} as const;

// ─── CSS custom properties string (for :root injection) ──────────────────────

export const cssVariables = `
  --bg: ${colors.bg};
  --panel: ${colors.panel};
  --panel2: ${colors.panel2};
  --ink: ${colors.ink};
  --muted: ${colors.muted};
  --hair: ${colors.hair};
  --signal: ${colors.signal};
  --signal2: ${colors.signal2};
  --gold: ${colors.gold};
  --gold-bright: ${colors.goldBright};
  --battle: ${colors.battle};
  --accent: ${colors.signal};

  --font: ${typeface.family};
  --mono: ${typeface.mono};

  --notch: ${notch.lg};
  --notch-md: ${notch.md};
  --notch-sm: ${notch.sm};
  --notch-xs: ${notch.xs};
  --radius: 0;

  --sp-1: ${spacing.xs}px;
  --sp-2: ${spacing.sm}px;
  --sp-3: ${spacing.md}px;
  --sp-4: ${spacing.lg}px;
  --sp-6: ${spacing.xl}px;
  --sp-8: ${spacing['2xl']}px;

  --ease: ${motion.ease};
`;

// ─── Helper: color-mix tint (for use in CSS-in-JS or dynamic styles) ─────────

export function tint(base: string, mix: string, percentage: number): string {
  return `color-mix(in oklab, ${base} ${percentage}%, ${mix})`;
}

// ─── Type exports ────────────────────────────────────────────────────────────

export type ColorKey = keyof typeof colors;
export type ElementKey = keyof typeof elements;
export type ResourceKey = keyof typeof resources;
export type GaugeKey = keyof typeof gauges;
export type StatKey = keyof typeof stats;
export type TierKey = keyof typeof tiers;
export type StatusAilmentKey = keyof typeof statusAilments;
export type SocialKey = keyof typeof social;
