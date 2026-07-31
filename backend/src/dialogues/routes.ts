import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { parseTwee } from '@digiworld/shared/dialogue-parser';

import { requireAdmin, requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import { deleteDialogue, getDialogue, listDialogues, saveDialogue } from './repo.js';
import { syncDialogueFolder } from './sync.js';

const DialogueIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._/-]+$/, 'dialogue id may only contain letters, numbers, dot, underscore, slash, hyphen');

const ImportSchema = z.object({
  dialogueId: DialogueIdSchema,
  source: z.string().min(1).max(1_000_000),
});

const PreviewSchema = z.object({
  dialogueId: DialogueIdSchema.optional(),
  source: z.string().min(1).max(1_000_000),
});

export const dialoguesPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/dialogues', async (req, reply) => {
    await requireAuth(req, reply);
    return reply.send({ dialogues: await listDialogues() });
  });

  app.get<{ Params: { id: string } }>('/api/dialogues/:id', async (req, reply) => {
    await requireAuth(req, reply);
    const dialogue = await getDialogue(req.params.id);
    if (dialogue === null) return reply.code(404).send({ error: 'dialogue-not-found' });
    return reply.send({ dialogue });
  });

  app.post('/api/admin/dialogues/preview', async (req, reply) => {
    await requireAdmin(req, reply);
    const parsed = PreviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const result = parseTwee(parsed.data.source, { dialogueId: parsed.data.dialogueId ?? 'preview' });
    return reply.send({
      ok: result.definition !== null,
      stats: result.stats,
      errors: result.errors,
      warnings: result.warnings,
      npcIds: result.definition?.npcIds ?? [],
      startNodeId: result.definition?.startNodeId ?? null,
      title: result.definition?.title ?? null,
    });
  });

  app.post('/api/admin/dialogues/import', async (req, reply) => {
    await requireAdmin(req, reply);
    const parsed = ImportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const result = parseTwee(parsed.data.source, { dialogueId: parsed.data.dialogueId });
    if (result.definition === null) {
      return reply.code(400).send({ error: 'invalid-twee', errors: result.errors, warnings: result.warnings });
    }
    const saved = await saveDialogue({ definition: result.definition, sourceTwee: parsed.data.source, sourcePath: null });
    log.info('dialogue.import.ok', { dialogueId: saved.dialogueId, nodes: saved.nodeCount });
    return reply.code(201).send({ dialogue: saved, warnings: result.warnings });
  });

  app.post('/api/admin/dialogues/sync', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send(await syncDialogueFolder());
  });

  app.get<{ Params: { id: string } }>('/api/admin/dialogues/:id/export', async (req, reply) => {
    await requireAdmin(req, reply);
    const dialogue = await getDialogue(req.params.id);
    if (dialogue === null) return reply.code(404).send({ error: 'dialogue-not-found' });
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(dialogue.dialogueId)}.twee"`);
    return reply.send(dialogue.sourceTwee);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/dialogues/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const removed = await deleteDialogue(req.params.id);
    if (!removed) return reply.code(404).send({ error: 'dialogue-not-found' });
    log.info('dialogue.delete.ok', { dialogueId: req.params.id });
    return reply.send({ ok: true });
  });
};
