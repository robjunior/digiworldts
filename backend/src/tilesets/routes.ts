import type { FastifyPluginAsync } from 'fastify';

import { requireAdmin } from '../auth/routes.js';
import { log } from '../util/log.js';
import { createTileset, deleteTileset, getTileset, listTilesets } from './repo.js';
import { deleteTilesetImage, parsePngDimensions, readTilesetImage, writeTilesetImage } from './image-storage.js';

export const tilesetsPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/admin/tilesets', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ tilesets: await listTilesets() });
  });

  app.post('/api/admin/tilesets', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    let name: string | null = null;
    let tileWidth: number | null = null;
    let tileHeight: number | null = null;
    let imageBuffer: Buffer | null = null;
    let imageFilename: string | null = null;
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'image') {
        imageBuffer = await part.toBuffer();
        imageFilename = part.filename;
      } else if (part.type === 'field') {
        if (part.fieldname === 'name' && typeof part.value === 'string') name = part.value.trim();
        else if (part.fieldname === 'tileWidth') tileWidth = Number(part.value);
        else if (part.fieldname === 'tileHeight') tileHeight = Number(part.value);
      }
    }
    if (!name || tileWidth === null || tileHeight === null || !imageBuffer || !imageFilename) {
      return reply.code(400).send({ error: 'missing-fields', required: ['name', 'tileWidth', 'tileHeight', 'image'] });
    }
    if (name.length < 1 || name.length > 120) return reply.code(400).send({ error: 'invalid-name' });
    if (!Number.isFinite(tileWidth) || tileWidth < 1 || tileWidth > 512) return reply.code(400).send({ error: 'invalid-tile-size', field: 'tileWidth' });
    if (!Number.isFinite(tileHeight) || tileHeight < 1 || tileHeight > 512) return reply.code(400).send({ error: 'invalid-tile-size', field: 'tileHeight' });
    const dims = parsePngDimensions(imageBuffer);
    if (!dims) return reply.code(400).send({ error: 'invalid-png' });
    if (dims.width < tileWidth || dims.height < tileHeight) return reply.code(400).send({ error: 'image-smaller-than-tile' });
    try {
      const tileset = await createTileset({ name, imageFilename, tileWidth, tileHeight, imageWidth: dims.width, imageHeight: dims.height });
      await writeTilesetImage(tileset.id, imageBuffer);
      log.info('admin.tileset.create', { adminId: admin.id, id: tileset.id, name, columns: tileset.columns, tileCount: tileset.tileCount });
      return reply.code(201).send({ tileset });
    } catch (err) {
      const errObj = err as { readonly code?: string; readonly message?: string };
      if (errObj?.code === '23505' || (typeof errObj?.message === 'string' && errObj.message.includes('UNIQUE'))) {
        return reply.code(409).send({ error: 'name-taken' });
      }
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/api/admin/tilesets/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await deleteTileset(req.params.id);
    if (!result.ok) {
      if (result.error === 'not-found') return reply.code(404).send({ error: 'not-found' });
      return reply.code(409).send({ error: 'in-use', referencedByDungeons: result.referencedByDungeons });
    }
    await deleteTilesetImage(req.params.id);
    log.info('admin.tileset.delete', { adminId: admin.id, id: req.params.id });
    return reply.send({ ok: true });
  });

  app.get<{ Params: { id: string } }>('/api/tilesets/:id/image', async (req, reply) => {
    const meta = await getTileset(req.params.id);
    if (!meta) return reply.code(404).send({ error: 'not-found' });
    const buf = await readTilesetImage(req.params.id);
    if (!buf) return reply.code(404).send({ error: 'not-found' });
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(buf);
  });
};
