import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { BIOMES, type Biome } from '@digiworld/shared/world';
import { startWildEncounter } from '../lib/api';

import '../styles/extensions-dungeon.css';

// -- data mirrors backend/src/world/biomes.ts (client-side flavor only) --
type ElementKey =
  | 'fire' | 'water' | 'plant' | 'electricity' | 'ice'
  | 'earth' | 'steel' | 'wind' | 'light' | 'dark' | 'null';

const BIOME_META: Record<Biome, { label: string; element: ElementKey }> = {
  desert:   { label: 'Ember Wastes',   element: 'fire' },
  forest:   { label: 'Verdant Reach',  element: 'plant' },
  lake:     { label: 'Mirror Basin',   element: 'water' },
  storm:    { label: 'Voltcloud',      element: 'electricity' },
  tundra:   { label: 'Frostspire',     element: 'ice' },
  mountain: { label: 'Stoneridge',     element: 'earth' },
  foundry:  { label: 'Rustworks',      element: 'steel' },
  plateau:  { label: 'Skyshear',       element: 'wind' },
  prairie:  { label: 'Solaris Fields', element: 'light' },
  swamp:    { label: 'Nightveil',      element: 'dark' },
  void:     { label: 'The Static',     element: 'null' },
};

// per-element mon-name pools for placeholder wild-party flavor
const MONS: Record<ElementKey, readonly string[]> = {
  fire:        ['Emberling', 'Cinderfang', 'Pyrolisk'],
  plant:       ['Sprigling', 'Thornhide', 'Verdemaw'],
  water:       ['Tidepup', 'Brinefin', 'Marisaur'],
  electricity: ['Voltmite', 'Sparkjaw', 'Teslind'],
  ice:         ['Frostnip', 'Glacimaw', 'Rimeclaw'],
  earth:       ['Pebblit', 'Cragback', 'Terragon'],
  steel:       ['Boltnut', 'Ferrojaw', 'Chromewyrm'],
  wind:        ['Gustling', 'Zephyra', 'Cirruswing'],
  light:       ['Glimr', 'Aurelin', 'Solaced'],
  dark:        ['Umbrite', 'Nightmaw', 'Voidling'],
  null:        ['Glitchling', 'Nullbyte', 'The Static'],
};

const ELHEX: Record<ElementKey, string> = {
  fire: '#e6001f', water: '#4aa3ff', plant: '#3fbf6f',
  electricity: '#e8c33a', ice: '#7ad0e6', earth: '#b98a4a',
  steel: '#9fb0bd', wind: '#63d6c0', light: '#f2e39a',
  dark: '#c03a4a', null: '#8a877f',
};

const GRID = 15;
const FOG = 2.6;
const DIRS: Record<'N' | 'E' | 'S' | 'W', { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 }, E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },  W: { dx: -1, dy: 0 },
};

type Facing = 'N' | 'E' | 'S' | 'W';

type WildMon = { readonly name: string; readonly level: number; readonly rare: boolean };
type Encounter =
  | { readonly kind: 'wild-mon'; readonly mons: readonly WildMon[]; readonly rare: boolean }
  | { readonly kind: 'item'; readonly item: { readonly name: string; readonly qty: number } }
  | { readonly kind: 'nothing' };

type LogEntry = { readonly text: string; readonly cls: '' | 'hit' | 'item'; readonly depth: number; readonly facing: Facing };

const ARROW: Record<Facing, readonly [readonly [number, number], readonly [number, number], readonly [number, number]]> = {
  N: [[0, -0.34], [0.26, 0.22], [-0.26, 0.22]],
  E: [[0.34, 0], [-0.22, 0.26], [-0.22, -0.26]],
  S: [[0, 0.34], [0.26, -0.22], [-0.26, -0.22]],
  W: [[-0.34, 0], [0.22, 0.26], [0.22, -0.26]],
};

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function clamp(v: number, a: number, b: number): number { return Math.max(a, Math.min(b, v)); }

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/** Deterministic hash matching backend/src/world/biomes.ts hashing style. */
function makeHash(seed: number): (x: number, y: number) => number {
  return (x: number, y: number) => {
    let h = ((seed * 374761393) + (x * 668265263) + (y * 2246822519)) >>> 0;
    h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  };
}

function isWall(hash: (x: number, y: number) => number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return true;
  if (x === 7 && y === 7) return false;
  return (hash(x, y) % 100) < 26;
}

function rollEncounter(element: ElementKey, depth: number): Encounter {
  const r = Math.random();
  if (r < 0.28) {
    const pool = MONS[element];
    const count = 1 + Math.floor(Math.random() * 2);
    const rare = Math.random() < 0.10;
    const mons: WildMon[] = [];
    for (let i = 0; i < count; i++) {
      const budget = 8 + depth;
      const isRare = Math.random() < 0.10;
      mons.push({
        name: pool[Math.floor(Math.random() * pool.length)] ?? 'Unknown',
        level: budget + (isRare ? 3 : 0),
        rare: isRare,
      });
    }
    return { kind: 'wild-mon', mons, rare };
  }
  if (r < 0.37) {
    const items = ['Recovery Chip', 'Data Shard', 'Bit Fragment', 'Restore Byte'];
    return {
      kind: 'item',
      item: {
        name: items[Math.floor(Math.random() * items.length)] ?? 'Fragment',
        qty: 1 + Math.floor(Math.random() * 2),
      },
    };
  }
  return { kind: 'nothing' };
}

function initialExplored(): Set<string> {
  const s = new Set<string>();
  s.add('7,7');
  return s;
}

export function Dungeon(): JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const regionKey: Biome = useMemo(() => {
    const q = params.get('region');
    if (q && (BIOMES as readonly string[]).includes(q)) return q as Biome;
    return BIOMES[Math.floor(Math.random() * BIOMES.length)] as Biome;
  }, [params]);

  const region = BIOME_META[regionKey];
  const seed = useMemo(() => {
    const s = parseInt(params.get('seed') ?? '', 10);
    return Number.isFinite(s) && s > 0 ? s : regionKey.length * 97 + 13;
  }, [params, regionKey]);
  const hash = useMemo(() => makeHash(seed), [seed]);
  const elHex = ELHEX[region.element];

  const [px, setPx] = useState(7);
  const [py, setPy] = useState(7);
  const [facing, setFacing] = useState<Facing>('N');
  const [depth, setDepth] = useState(0);
  const [encCount, setEncCount] = useState(0);
  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const exploredRef = useRef<Set<string>>(initialExplored());
  const [exploredCount, setExploredCount] = useState(1);
  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const activeEncounter = encounter !== null && encounter.kind === 'wild-mon';

  const pushLog = useCallback((text: string, cls: '' | 'hit' | 'item', d: number, f: Facing): void => {
    setLogs((prev) => [...prev, { text, cls, depth: d, facing: f }]);
  }, []);

  const flashToast = useCallback((message: string): void => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1900);
  }, []);

  const revealAround = useCallback((x: number, y: number): number => {
    const R = Math.ceil(FOG);
    let added = 0;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        if (Math.hypot(dx, dy) > FOG + 0.5) continue;
        const key = `${nx},${ny}`;
        if (!exploredRef.current.has(key)) {
          exploredRef.current.add(key);
          added++;
        }
      }
    }
    return added;
  }, []);

  const step = useCallback((dirKey: Facing): void => {
    if (activeEncounter) {
      flashToast('Resolve the encounter first.');
      return;
    }
    const dir = DIRS[dirKey];
    setFacing(dirKey);
    const nx = px + dir.dx;
    const ny = py + dir.dy;
    if (isWall(hash, nx, ny)) {
      flashToast('A wall blocks the way.');
      pushLog('Bumped a wall.', '', depth, dirKey);
      return;
    }
    const newDepth = depth + 1;
    setPx(nx);
    setPy(ny);
    setDepth(newDepth);
    const added = revealAround(nx, ny);
    if (added > 0) setExploredCount(exploredRef.current.size);
    const enc = rollEncounter(region.element, newDepth);
    if (enc.kind === 'wild-mon') {
      setEncCount((c) => c + 1);
      setEncounter(enc);
      pushLog(
        `${enc.rare ? 'Rare signal! ' : ''}Wild ${cap(region.element)} encounter — ${enc.mons.length} mon${enc.mons.length > 1 ? 's' : ''}.`,
        'hit', newDepth, dirKey,
      );
    } else if (enc.kind === 'item') {
      pushLog(`Found ${enc.item.qty}× ${enc.item.name}.`, 'item', newDepth, dirKey);
      flashToast(`Picked up ${enc.item.qty}× ${enc.item.name}`);
    }
  }, [activeEncounter, depth, flashToast, hash, px, py, pushLog, region.element, revealAround]);

  const flee = useCallback((): void => {
    setEncounter(null);
    pushLog('Fled the encounter.', '', depth, facing);
    flashToast('Fled — keep moving.');
  }, [depth, facing, flashToast, pushLog]);

  const enterBattle = useCallback(async (): Promise<void> => {
    try {
      await startWildEncounter();
      navigate('/combat');
    } catch {
      // fallback: still navigate; combat page will retry via useCombatBattle
      navigate('/combat');
    }
  }, [navigate]);

  // Draw both canvases whenever state changes
  useEffect(() => {
    const mini = miniRef.current;
    const view = viewRef.current;
    if (!mini || !view) return;

    // -- minimap: 15x15, explored tiles only --
    const mctx = mini.getContext('2d');
    if (mctx) {
      const N = GRID;
      const cell = mini.width / N;
      mctx.clearRect(0, 0, mini.width, mini.height);
      mctx.fillStyle = '#0a0a0c';
      mctx.fillRect(0, 0, mini.width, mini.height);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if (!exploredRef.current.has(`${x},${y}`)) continue;
          mctx.fillStyle = isWall(hash, x, y) ? '#22222a' : hexA(elHex, 0.22);
          mctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
        }
      }
      mctx.fillStyle = elHex;
      mctx.fillRect(px * cell + cell * 0.2, py * cell + cell * 0.2, cell * 0.6, cell * 0.6);
    }

    // -- view: camera on player, fog-of-war reveal --
    const vctx = view.getContext('2d');
    if (vctx) {
      const W = view.clientWidth || 600;
      const H = view.clientHeight || 400;
      if (view.width !== W || view.height !== H) { view.width = W; view.height = H; }
      vctx.clearRect(0, 0, W, H);
      vctx.fillStyle = '#0a0a0c';
      vctx.fillRect(0, 0, W, H);

      const cell = Math.floor(Math.min(W, H) / 9);
      const cx = W / 2;
      const cy = H / 2;
      const tilesX = Math.ceil(W / cell / 2) + 1;
      const tilesY = Math.ceil(H / cell / 2) + 1;

      for (let dy = -tilesY; dy <= tilesY; dy++) {
        for (let dx = -tilesX; dx <= tilesX; dx++) {
          const x = px + dx;
          const y = py + dy;
          const sx = cx + dx * cell - cell / 2;
          const sy = cy + dy * cell - cell / 2;
          const dist = Math.hypot(dx, dy);
          const seen = exploredRef.current.has(`${x},${y}`);
          const inFog = dist <= FOG + 0.5;
          if (!seen && !inFog) continue;
          const wall = isWall(hash, x, y);
          const lit = inFog ? clamp(1 - dist / (FOG + 1.2), 0.25, 1) : 0.16;
          if (wall) {
            vctx.fillStyle = `rgba(34,34,42,${0.55 + lit * 0.45})`;
            vctx.fillRect(sx, sy, cell, cell);
            vctx.strokeStyle = hexA(elHex, 0.08 + lit * 0.12);
            vctx.lineWidth = 1;
            vctx.strokeRect(sx + 0.5, sy + 0.5, cell - 1, cell - 1);
          } else {
            vctx.fillStyle = hexA(elHex, 0.05 + lit * 0.14);
            vctx.fillRect(sx, sy, cell, cell);
            vctx.strokeStyle = hexA(elHex, 0.05 + lit * 0.10);
            vctx.lineWidth = 1;
            vctx.strokeRect(sx + 0.5, sy + 0.5, cell - 1, cell - 1);
          }
        }
      }

      // player token + facing arrow
      vctx.fillStyle = hexA(elHex, 0.18);
      vctx.beginPath();
      vctx.arc(cx, cy, cell * 0.62, 0, Math.PI * 2);
      vctx.fill();
      vctx.fillStyle = elHex;
      const a = ARROW[facing];
      vctx.beginPath();
      vctx.moveTo(cx + a[0][0] * cell, cy + a[0][1] * cell);
      vctx.lineTo(cx + a[1][0] * cell, cy + a[1][1] * cell);
      vctx.lineTo(cx + a[2][0] * cell, cy + a[2][1] * cell);
      vctx.closePath();
      vctx.fill();

      // active-encounter red vignette
      if (activeEncounter) {
        vctx.fillStyle = hexA('#e6001f', 0.08);
        vctx.fillRect(0, 0, W, H);
        vctx.strokeStyle = hexA('#e6001f', 0.6);
        vctx.lineWidth = 6;
        vctx.strokeRect(3, 3, W - 6, H - 6);
      }
    }
  }, [activeEncounter, elHex, facing, hash, px, py, exploredCount]);

  // Initial reveal + welcome log entry
  useEffect(() => {
    const added = revealAround(7, 7);
    if (added > 0) setExploredCount(exploredRef.current.size);
    pushLog(`Entered ${region.label}. ${cap(region.element)} field — stay sharp.`, '', 0, 'N');
    // deliberate one-shot; regionKey change re-mounts via <Route> anyway
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard input
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp')    { e.preventDefault(); step('N'); }
      else if (k === 's' || e.key === 'ArrowDown')  { e.preventDefault(); step('S'); }
      else if (k === 'a' || e.key === 'ArrowLeft')  { e.preventDefault(); step('W'); }
      else if (k === 'd' || e.key === 'ArrowRight') { e.preventDefault(); step('E'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  // Resize triggers redraw via state (dummy toggle)
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    const onResize = (): void => setResizeTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    // re-run the draw effect by toggling explored count (harmless no-op)
    setExploredCount((c) => c);
  }, [resizeTick]);

  const cssVars = useMemo<Record<string, string>>(() => ({
    ['--el']: elHex,
  }), [elHex]);

  return (
    <>
      <div className="stage" data-od-id="dungeon-stage" style={cssVars}>
        <div className="dstrip">
          <span className="dk">{region.label}</span>
          <span className="dv">Element<b>{cap(region.element)}</b></span>
          <span className="dv">Tile<b>{px - 7}, {7 - py}</b></span>
        </div>
        <Link to="/world" className="leave" aria-label="Leave dungeon, return to The World">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 5l-7 7 7 7M20 12H7" />
          </svg>
          Leave
        </Link>

        <div className="view">
          <canvas ref={viewRef} aria-label="Top-down dungeon view" />
        </div>

        <div className="mini" data-od-id="minimap">
          <div className="mh"><span>Minimap</span><b>Full Map</b></div>
          <canvas ref={miniRef} width={176} height={176} />
        </div>

        <div className="controls">
          <div className="dpad" role="group" aria-label="Movement">
            <button type="button" className="up"    onClick={() => step('N')} aria-label="Move north">▲</button>
            <button type="button" className="left"  onClick={() => step('W')} aria-label="Move west">◀</button>
            <button type="button" className="down"  onClick={() => step('S')} aria-label="Move south">▼</button>
            <button type="button" className="right" onClick={() => step('E')} aria-label="Move east">▶</button>
          </div>
          <div className="dhint"><b>WASD</b> / arrows to move · every step rolls the field</div>
        </div>
      </div>

      <aside className="rail" data-od-id="run-rail">
        <div className="rhead">
          <div className="rt">Run Log</div>
          <div className="rs"><b>{region.label}</b> · Depth {depth} · Explored {exploredCount} · Encounters {encCount}</div>
        </div>
        <div className="log" role="log" aria-live="polite" aria-label="Dungeon run log">
          {logs.map((row, i) => (
            <div key={i} className={`lrow${row.cls ? ` ${row.cls}` : ''}`}>
              <span className="lt">{String(row.depth).padStart(2, '0')}·{row.facing}</span>
              <span className="lx">{row.text}</span>
            </div>
          ))}
        </div>
        <div className={`enc${activeEncounter ? '' : ' empty'}`}>
          <div className="idle">Walk the grid. Encounters surface here.</div>
          {activeEncounter && encounter && encounter.kind === 'wild-mon' ? (
            <div className="ecard">
              <div className="ek">{encounter.rare ? 'Rare · ' : ''}Wild Encounter</div>
              <h3>{cap(region.element)} field ambush</h3>
              <div className="emons">
                {encounter.mons.map((m, i) => (
                  <div key={i} className="emon">
                    <span className="esprite" aria-hidden="true">{m.name.charAt(0)}</span>
                    <span className="enm">{m.name}<span className="elv">Lv {m.level} · {cap(region.element)}</span></span>
                    <span className="erare">{m.rare ? 'RARE' : ''}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="ebtn" onClick={() => { void enterBattle(); }}>Enter Battle</button>
              <button type="button" className="ebtn ghost" onClick={flee}>Flee (continue)</button>
            </div>
          ) : null}
        </div>
      </aside>

      {toast !== null ? <div className="toast show" role="status" aria-live="polite">{toast}</div> : null}
    </>
  );
}
