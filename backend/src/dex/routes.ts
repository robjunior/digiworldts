/**
 * Digdex — bestiary. Fog-of-war reveal per player.
 *
 * "Met" is resolved by `computeMetSet` in ./met.ts, shared with the evolution
 * gate so both surfaces hide the same species.
 *
 * Unmet entries return `template: null` so the client only renders a `?`
 * placeholder — no name/stats/evolutions leak through the API.
 */
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import { loadCatalog } from '../digimon/xml.js';
import type { Element, TemplateDigimon } from '../digimon/types.js';
import { computeMetSet } from './met.js';

export type DigdexEntry = {
  readonly catalogId: string;
  readonly element: Element;
  readonly met: boolean;
  readonly template: TemplateDigimon | null;
};

export type DigdexResponse = {
  readonly entries: readonly DigdexEntry[];
  readonly totalCount: number;
  readonly metCount: number;
};

export const digdexPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/digdex', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const catalog = loadCatalog({ publishedOnly: true });
    const metSet = await computeMetSet(user.id);
    let metCount = 0;
    const entries: DigdexEntry[] = catalog.digimons.map((t) => {
      const met = metSet.has(t.id);
      if (met) metCount += 1;
      return { catalogId: t.id, element: t.element, met, template: met ? t : null };
    });
    const response: DigdexResponse = {
      entries,
      totalCount: catalog.digimons.length,
      metCount,
    };
    return reply.send(response);
  });
};
