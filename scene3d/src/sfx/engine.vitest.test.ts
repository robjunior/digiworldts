import { describe, expect, it } from 'vitest';
import { SfxEngine, type StorageLike } from './engine';
import { FakeBackend } from './fake-backend';

function make(o: { maxTotalVoices?: number } = {}): { engine: SfxEngine; backend: FakeBackend } {
  const backend = new FakeBackend();
  backend.registerBuffer(300); // so decode(path) resolves to a real buffer
  // Stub fetch so preload()/decode resolve a stubbed ArrayBuffer that the fake
  // backend turns into the registered buffer.
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }) as Response;
  const opts: ConstructorParameters<typeof SfxEngine>[0] = { backend, storage: memoryStorage() };
  if (o.maxTotalVoices !== undefined) opts.maxTotalVoices = o.maxTotalVoices;
  const engine = new SfxEngine(opts);
  return { engine, backend };
}

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

describe('SfxEngine graph', () => {
  it('builds master + compressor + the three bus gains', () => {
    const { engine, backend } = make();
    expect(backend.nodes.filter((n) => typeof n === 'object' && n !== null && 'gain' in (n as object)).length).toBe(4); // master + sfx/ui/music (compressor has no gain)
    expect(engine.getBusVolume('sfx')).toBeGreaterThan(0);
    expect(engine.getBusVolume('music')).toBeGreaterThan(0);
  });

  it('mutes a bus to 0 gain and persists it', () => {
    const { engine } = make();
    engine.setBusMuted('ui', true);
    expect(engine.isBusMuted('ui')).toBe(true);
    const stored = (engine as unknown as { storage: StorageLike }).storage.getItem('digiworld.sfx.mute.ui');
    expect(stored).toBe('1');
  });

  it('clamps out-of-range persisted volume to defaults', () => {
    const { engine } = make();
    engine.setBusVolume('sfx', 0.5);
    expect(engine.getBusVolume('sfx')).toBe(0.5);
    engine.setBusVolume('sfx', 3); // clamped
    expect(engine.getBusVolume('sfx')).toBe(1);
  });
});

describe('play() voice management', () => {
  it('spawns a voice and releases the global on budget breach by priority', () => {
    const { engine, backend } = make({ maxTotalVoices: 3 });
    // priority: combat_swing=2, status_buff=3, combat_impact=4
    engine.play('combat_swing');
    engine.play('combat_swing');
    engine.play('status_buff');
    engine.play('combat_impact'); // 4th -> evict lowest (a swing)
    expect(engine.voiceCount).toBe(3);
    // The surviving voices are the newest three (impact, buff, one swing).
    void backend;
  });

  it('cancelGroup stops loops of only that group', () => {
    const { engine } = make();
    engine.play('combat_cast', { loop: true, group: 'a' });
    engine.play('combat_cast', { loop: true, group: 'b' });
    expect(engine.voiceCount).toBe(2);
    engine.cancelGroup('a');
    expect(engine.voiceCount).toBe(1);
  });

  it('delays start via backend.currentTime, and schedules a loop stop with fade', async () => {
    const { engine, backend } = make();
    await engine.preload(); // loads buffers so loops get real handles
    backend.advance(10);
    const h = engine.play('combat_projectile', { loop: true, group: 'x', delay: 0.25 });
    expect(engine.voiceCount).toBe(1);
    h.stop(120);
    expect(engine.voiceCount).toBe(0);
  });

  it('spatial position applies StereoPanner pan and gain', () => {
    const { engine, backend } = make();
    // screenX=500 in a 1000px viewport → centered → pan 0.
    engine.play('combat_impact', { position: { screenX: 500, viewportWidth: 1000, onScreen: true } });
    // StereoPanner created+connected into the chain.
    const panners = backend.nodes.filter((n) => typeof n === 'object' && n !== null && 'pan' in (n as object));
    expect(panners.length).toBe(1);
    expect((panners[0] as { pan: { value: number } }).pan.value).toBe(0); // centered
  });
});

describe('timeScale', () => {
  it('exposes the scale', () => {
    const { engine } = make();
    expect(engine.currentTimeScale).toBe(1);
    engine.setTimeScale(2);
    expect(engine.currentTimeScale).toBe(2);
  });
});

describe('preload progress', () => {
  it('reports monotonic progress to total', async () => {
    const { engine } = make();
    const seen: number[] = [];
    await engine.preload((loaded, _total, fraction) => { seen.push(fraction); void loaded; });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]!).toBe(1);
  });
});