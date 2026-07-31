import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

const BEARER_PREFIX = 'Bearer ';

function isAuthorizedBearer(header: string | undefined): boolean {
  if (!config.SERVICE_TOKEN_DISCORD || !header?.startsWith(BEARER_PREFIX)) return false;
  const supplied = Buffer.from(header.slice(BEARER_PREFIX.length), 'utf8');
  const expected = Buffer.from(config.SERVICE_TOKEN_DISCORD, 'utf8');
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

export async function requireServiceAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (isAuthorizedBearer(req.headers.authorization)) return;
  reply.code(401).send({ error: 'unauthorized' });
  throw new Error('service-unauthorized');
}
