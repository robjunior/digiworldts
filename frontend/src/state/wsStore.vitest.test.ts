/**
 * WS store chat routing — the layer the lobby chat tabs depend on.
 *
 * Regression guard for the DM bug: direct messages used to be appended to the
 * single global `chat` log, so DMs appeared in the General tab and no per-user
 * DM conversation existed. They must now land in `dmsByPeer`, keyed by the
 * OTHER participant — for both the received message and the sender's own echo.
 *
 * Run: pnpm --filter @digiworld/frontend test
 */
import type { WSServerMessage } from '@digiworld/shared/ws';
import { beforeEach, describe, expect, it } from 'vitest';

import { useWsStore } from './wsStore';

const ME = 'usr_me';
const PEER = 'usr_peer';
const OTHER = 'usr_other';

const welcome: WSServerMessage = {
  type: 'welcome',
  user: { id: ME, displayName: 'Me' },
  presence: [],
  activeMatches: 0,
  nodeId: 'test',
};

/** Peer → me (recipient is me). */
const dmReceived: WSServerMessage = {
  type: 'chat',
  from: PEER,
  displayName: 'Peer',
  text: 'hi from peer',
  at: 1,
  nodeId: 'test',
  toUserId: ME,
};

/** My own DM echo (sender is me, recipient is the peer). */
const dmEchoed: WSServerMessage = {
  type: 'chat',
  from: ME,
  displayName: 'Me',
  text: 'hi peer',
  at: 2,
  nodeId: 'test',
  toUserId: PEER,
};

/** Plain General broadcast. */
const general: WSServerMessage = {
  type: 'chat',
  from: OTHER,
  displayName: 'Other',
  text: 'hello all',
  at: 3,
  nodeId: 'test',
};

function send(msg: WSServerMessage): void {
  useWsStore.getState().handleServerMessage(msg);
}

describe('WS store chat routing', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
    send(welcome);
  });

  it('routes an incoming DM to the sender-keyed peer log, not global chat', () => {
    send(dmReceived);
    const state = useWsStore.getState();
    expect(state.dmsByPeer[PEER]?.map((m) => m.text)).toEqual(['hi from peer']);
    expect(state.dmsByPeer[ME]).toBeUndefined();
    expect(state.chat).toHaveLength(0);
  });

  it('keys my own DM echo by the peer, so my sent line lands in the same tab', () => {
    send(dmEchoed);
    const state = useWsStore.getState();
    expect(state.dmsByPeer[PEER]?.map((m) => m.text)).toEqual(['hi peer']);
    expect(state.dmsByPeer[ME]).toBeUndefined();
    expect(state.chat).toHaveLength(0);
  });

  it('keeps a conversation in one peer log in order', () => {
    send(dmReceived);
    send(dmEchoed);
    const log = useWsStore.getState().dmsByPeer[PEER] ?? [];
    expect(log.map((m) => [m.from, m.text])).toEqual([
      [PEER, 'hi from peer'],
      [ME, 'hi peer'],
    ]);
  });

  it('never leaks DMs into the General log', () => {
    send(general);
    expect(useWsStore.getState().chat.map((m) => m.text)).toEqual(['hello all']);
    send(dmReceived);
    send(dmEchoed);
    expect(useWsStore.getState().chat.map((m) => m.text)).toEqual(['hello all']);
  });

  it('separates two peers into their own logs', () => {
    send(dmReceived);
    send({ ...dmReceived, from: OTHER, displayName: 'Other', text: 'other dm', toUserId: ME });
    const state = useWsStore.getState();
    expect(Object.keys(state.dmsByPeer).sort()).toEqual([OTHER, PEER].sort());
    expect(state.dmsByPeer[OTHER]?.map((m) => m.text)).toEqual(['other dm']);
  });

  it('clears every peer log on reset', () => {
    send(dmReceived);
    useWsStore.getState().reset();
    expect(useWsStore.getState().dmsByPeer).toEqual({});
    expect(useWsStore.getState().chat).toEqual([]);
  });
});
