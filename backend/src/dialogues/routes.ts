import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';


import { requireAdmin, requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import { deleteDialogue, getDialogue, listDialogues, saveDialogue } from './repo.js';
import { parseAndValidateWithRefs } from './runtime.js';
import { abandonDialogue, advanceDialogue, startDialogue } from './session.js';
import { simulate } from './simulate.js';
import { syncDialogueFolder } from './sync.js';
import { buildCrossRefChecker } from './xref.js';

const DialogueIdSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._/-]+$/, 'dialogue id may only contain letters, numbers, dot, underscore, slash, hyphen');

const AdvanceSchema = z.object({
  choiceId: z.string().trim().min(1).max(200),
});

const ImportSchema = z.object({
  dialogueId: DialogueIdSchema,
  source: z.string().min(1).max(1_000_000),
});

const PreviewSchema = z.object({
  dialogueId: DialogueIdSchema.optional(),
  source: z.string().min(1).max(1_000_000),
});

const SimulatorStepSchema = z.object({
  nodeId: z.string().trim().min(1).max(200),
  choiceId: z.string().trim().min(1).max(200),
});

const SimulatorOverridesSchema = z.object({
  level: z.number().int().min(1).max(999).optional(),
  playerName: z.string().trim().min(1).max(64).optional(),
  flags: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  items: z.record(z.string().trim().min(1).max(200), z.number().int().nonnegative().max(1_000_000)).optional(),
});

const SimulatorRequestSchema = z.object({
  overrides: SimulatorOverridesSchema.default({}),
  history: z.array(SimulatorStepSchema).max(500).default([]),
});

export const dialoguesPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get<{ Querystring: { includeDrafts?: string } }>('/api/dialogues', async (req, reply) => {
    await requireAuth(req, reply);
    const includeDrafts = req.query.includeDrafts === '1';
    return reply.send({ dialogues: await listDialogues(!includeDrafts) });
  });

  app.get<{ Params: { id: string }; Querystring: { includeDrafts?: string } }>('/api/dialogues/:id', async (req, reply) => {
    await requireAuth(req, reply);
    const includeDrafts = req.query.includeDrafts === '1';
    const dialogue = await getDialogue(req.params.id, !includeDrafts);
    if (dialogue === null) return reply.code(404).send({ error: 'dialogue-not-found' });
    return reply.send({ dialogue });
  });

  app.post<{ Params: { id: string } }>('/api/dialogues/:id/start', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const result = await startDialogue(user.id, user.displayName, req.params.id);
    if (!result.ok) return reply.code(result.error === 'busy' ? 409 : 404).send({ error: result.error });
    return reply.send({ view: result.view });
  });

  app.post<{ Params: { id: string } }>('/api/dialogues/:id/advance', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = AdvanceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-body' });
    const result = await advanceDialogue(user.id, user.displayName, req.params.id, parsed.data.choiceId);
    if (!result.ok) {
      const code = result.error === 'busy' ? 409 : result.error === 'choice-not-available' ? 403 : 404;
      return reply.code(code).send({ error: result.error });
    }
    return reply.send({ view: result.view });
  });

  app.post('/api/dialogues/abandon', async (req, reply) => {
    const user = await requireAuth(req, reply);
    await abandonDialogue(user.id);
    return reply.send({ ok: true });
  });

  app.post('/api/admin/dialogues/preview', async (req, reply) => {
    await requireAdmin(req, reply);
    const parsed = PreviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const checker = await buildCrossRefChecker();
    const result = parseAndValidateWithRefs(parsed.data.source, parsed.data.dialogueId ?? 'preview', checker);
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
    const checker = await buildCrossRefChecker();
    const result = parseAndValidateWithRefs(parsed.data.source, parsed.data.dialogueId, checker);
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

  app.post<{ Params: { id: string } }>('/api/admin/dialogues/:id/simulate', async (req, reply) => {
    await requireAdmin(req, reply);
    const parsed = SimulatorRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const result = await simulate({
      dialogueId: req.params.id,
      overrides: parsed.data.overrides,
      history: parsed.data.history,
    });
    if (!result.ok) {
      const code = result.failure.kind === 'unknown-dialogue' ? 404 : 400;
      return reply.code(code).send({ error: result.failure.kind, failure: result.failure });
    }
    return reply.send({ view: result.view });
  });
};
