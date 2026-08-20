import type { FastifyPluginAsync } from 'fastify';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';

import { NPC_EXPRESSION_PATTERN, NPC_ID_PATTERN } from '@digiworld/shared/npc';

import { requireAdmin, requireAuth } from '../auth/routes.js';
import { config } from '../config.js';
import { log } from '../util/log.js';
import { deleteNpc, getNpc, listNpcs, npcPortraitFile, saveNpc, NpcValidationError } from './repo.js';

const NpcIdSchema = z.string().trim().min(1).regex(NPC_ID_PATTERN, 'id must be lowercase kebab/snake starting with a letter');
const ExpressionKeySchema = z.string().trim().min(1).regex(NPC_EXPRESSION_PATTERN, 'expression key must be lowercase kebab/snake');
const NpcInputSchema = z.object({
  id: NpcIdSchema,
  displayName: z.string().trim().min(1).max(120),
  expressions: z.array(z.object({
    key: ExpressionKeySchema,
    label: z.string().trim().min(1).max(64).optional(),
  })).min(1),
  status: z.enum(['draft', 'published']).default('draft').optional(),
});
const NpcUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  expressions: z.array(z.object({
    key: ExpressionKeySchema,
    label: z.string().trim().min(1).max(64).optional(),
  })).min(1).optional(),
  status: z.enum(['draft', 'published']).optional(),
});

const MAX_PORTRAIT_BYTES = 1_000_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC);
}

export const npcsPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get<{ Querystring: { includeDrafts?: string } }>('/api/npcs', async (req, reply) => {
    await requireAuth(req, reply);
    const includeDrafts = req.query.includeDrafts === '1';
    return reply.send({ npcs: await listNpcs(!includeDrafts) });
  });

  app.get<{ Params: { id: string }; Querystring: { includeDrafts?: string } }>('/api/npcs/:id', async (req, reply) => {
    await requireAuth(req, reply);
    const includeDrafts = req.query.includeDrafts === '1';
    const npc = await getNpc(req.params.id, !includeDrafts);
    if (npc === null) return reply.code(404).send({ error: 'npc-not-found' });
    return reply.send({ npc });
  });

  app.post('/api/admin/npcs', async (req, reply) => {
    await requireAdmin(req, reply);
    const parsed = NpcInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const existing = await getNpc(parsed.data.id);
    if (existing !== null) return reply.code(409).send({ error: 'npc-exists' });
    try {
      const npc = await saveNpc(parsed.data);
      log.info('npc.create.ok', { id: npc.id, expressions: npc.expressions.length });
      return reply.code(201).send({ npc });
    } catch (err) {
      if (err instanceof NpcValidationError) return reply.code(400).send({ error: 'invalid-input', issues: err.issues });
      throw err;
    }
  });

  app.put<{ Params: { id: string } }>('/api/admin/npcs/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const parsedId = NpcIdSchema.safeParse(req.params.id);
    if (!parsedId.success) return reply.code(400).send({ error: 'invalid-id' });
    const parsedBody = NpcUpdateSchema.safeParse(req.body);
    if (!parsedBody.success) return reply.code(400).send({ error: 'invalid-input', details: parsedBody.error.issues });
    const existing = await getNpc(parsedId.data);
    if (existing === null) return reply.code(404).send({ error: 'npc-not-found' });
    try {
      const npc = await saveNpc({
        id: parsedId.data,
        displayName: parsedBody.data.displayName ?? existing.displayName,
        expressions: parsedBody.data.expressions ?? existing.expressions,
        status: parsedBody.data.status ?? existing.status,
      });
      log.info('npc.update.ok', { id: npc.id, expressions: npc.expressions.length });
      return reply.send({ npc });
    } catch (err) {
      if (err instanceof NpcValidationError) return reply.code(400).send({ error: 'invalid-input', issues: err.issues });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/admin/npcs/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const npc = await getNpc(req.params.id);
    if (npc === null) return reply.code(404).send({ error: 'npc-not-found' });
    for (const expr of npc.expressions) {
      const file = npcPortraitFile(npc.id, expr.key);
      if (existsSync(file)) await unlink(file).catch(() => undefined);
    }
    await deleteNpc(npc.id);
    log.info('npc.delete.ok', { id: npc.id });
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/admin/npcs/:id/publish', async (req, reply) => {
    await requireAdmin(req, reply);
    const npc = await getNpc(req.params.id);
    if (npc === null) return reply.code(404).send({ error: 'npc-not-found' });
    if (npc.status === 'published') {
      return reply.code(409).send({ error: 'already-published', message: 'NPC is already published' });
    }
    const published = await saveNpc({ ...npc, status: 'published' });
    log.info('admin.npc.publish', { adminId: (req as any).user?.id ?? 'unknown', id: npc.id });
    return reply.send({ npc: published });
  });

  app.post<{ Params: { id: string; expression: string } }>('/api/admin/npcs/:id/portrait/:expression', async (req, reply) => {
    await requireAdmin(req, reply);
    const parsedId = NpcIdSchema.safeParse(req.params.id);
    const parsedExpr = ExpressionKeySchema.safeParse(req.params.expression);
    if (!parsedId.success || !parsedExpr.success) return reply.code(400).send({ error: 'invalid-params' });
    const npc = await getNpc(parsedId.data);
    if (npc === null) return reply.code(404).send({ error: 'npc-not-found' });
    if (!npc.expressions.some((e) => e.key === parsedExpr.data)) {
      return reply.code(400).send({ error: 'expression-not-declared', expressions: npc.expressions.map((e) => e.key) });
    }
    const file = await req.file();
    if (file === undefined) return reply.code(400).send({ error: 'missing-file' });
    const buffer = await file.toBuffer();
    if (buffer.length === 0) return reply.code(400).send({ error: 'empty-file' });
    if (buffer.length > MAX_PORTRAIT_BYTES) return reply.code(400).send({ error: 'file-too-large', maxBytes: MAX_PORTRAIT_BYTES });
    if (!isPng(buffer)) return reply.code(400).send({ error: 'not-a-png' });
    const target = npcPortraitFile(npc.id, parsedExpr.data);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
    log.info('npc.portrait.upload.ok', { id: npc.id, expression: parsedExpr.data, bytes: buffer.length });
    return reply.code(201).send({ ok: true, url: `/assets/npc/${encodeURIComponent(npc.id)}/${encodeURIComponent(parsedExpr.data)}.png` });
  });

  app.delete<{ Params: { id: string; expression: string } }>('/api/admin/npcs/:id/portrait/:expression', async (req, reply) => {
    await requireAdmin(req, reply);
    const parsedId = NpcIdSchema.safeParse(req.params.id);
    const parsedExpr = ExpressionKeySchema.safeParse(req.params.expression);
    if (!parsedId.success || !parsedExpr.success) return reply.code(400).send({ error: 'invalid-params' });
    const file = npcPortraitFile(parsedId.data, parsedExpr.data);
    if (!existsSync(file)) return reply.code(404).send({ error: 'portrait-not-found' });
    await unlink(file);
    log.info('npc.portrait.delete.ok', { id: parsedId.data, expression: parsedExpr.data });
    return reply.send({ ok: true });
  });
};

/** Local helper reused by seed.ts. */
export function npcPortraitsRoot(): string {
  return resolve(config.paths.npcPortraitsDir);
}
