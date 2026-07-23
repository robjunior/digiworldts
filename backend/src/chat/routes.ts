/**
 * Chat rooms HTTP plugin.
 *
 *   POST /api/chat/room/create       { name }              → { room }
 *   POST /api/chat/room/join         { roomId }            → { room }
 *   POST /api/chat/room/leave        { roomId }            → { ok }
 *   GET  /api/chat/rooms/mine                              → { rooms }
 *   POST /api/chat/dm/open           { username }          → { room, created, otherUser }
 *
 * WS message extension: `chat` gains optional `room?: string`. Unlabeled =
 * global chat (existing broadcast). Labeled = per-room fanout, validated
 * against chat_room_members and delivered via wsdeliver:{userId}. See
 * src/lobby/ws.ts::handleChat.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import { createRoom, joinRoom, leaveRoom, listMyRooms, openDm } from './rooms.js';

const RoomNameSchema = z.string().trim().min(2).max(48);
const UsernameSchema = z.string().trim().min(3).max(24);
const RoomIdSchema = z.string().min(3).max(64);

const CreateRoomSchema = z.object({ name: RoomNameSchema });
const JoinRoomSchema = z.object({ roomId: RoomIdSchema });
const LeaveRoomSchema = z.object({ roomId: RoomIdSchema });
const OpenDmSchema = z.object({ username: UsernameSchema });

export const chatPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.post('/api/chat/room/create', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = CreateRoomSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const room = await createRoom(user.id, parsed.data.name);
    log.info('chat.room.create', { userId: user.id, roomId: room.id, name: room.name });
    return reply.send({ room });
  });

  app.post('/api/chat/room/join', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = JoinRoomSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const result = await joinRoom(parsed.data.roomId, user.id);
    if (result === 'not-found') return reply.code(404).send({ error: 'room-not-found' });
    if (result === 'is-dm') return reply.code(400).send({ error: 'cannot-join-dm' });
    log.info('chat.room.join', { userId: user.id, roomId: parsed.data.roomId });
    return reply.send({ ok: true });
  });

  app.post('/api/chat/room/leave', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = LeaveRoomSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const result = await leaveRoom(parsed.data.roomId, user.id);
    if (result === 'not-found') return reply.code(404).send({ error: 'room-not-found' });
    log.info('chat.room.leave', { userId: user.id, roomId: parsed.data.roomId });
    return reply.send({ ok: true });
  });

  app.get('/api/chat/rooms/mine', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const rooms = await listMyRooms(user.id);
    return reply.send({ rooms });
  });

  app.post('/api/chat/dm/open', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = OpenDmSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const result = await openDm(user.id, parsed.data.username);
    if (!result.ok) {
      const status = result.error === 'user-not-found' ? 404 : 400;
      return reply.code(status).send({ error: result.error });
    }
    log.info('chat.dm.open', { userId: user.id, roomId: result.room.id, created: result.created, other: result.otherUser.id });
    return reply.send({ room: result.room, created: result.created, otherUser: result.otherUser });
  });
};
