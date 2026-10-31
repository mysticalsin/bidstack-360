import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { CrmConnector, OpenDataSignal, OpenDataSignalsResponse, SourceAttribution } from '@bidstack/shared';

import {
  buildConnectorCatalog,
  buildOpenDataSignals,
} from '../../providers/open-data-connectors.js';

const ConnectorsResponse = z.object({
  items: z.array(CrmConnector),
});

const OpenDataSignalsQuery = z.object({
  query: z.string().trim().optional(),
  ticker: z.string().trim().optional(),
});

// A ticker match or award row is not a scored source. The shared signal schema
// still requires a number; this route allows null and records confidenceBasis.
const UnscoredOpenDataSignalsResponse = OpenDataSignalsResponse.extend({
  signals: z.array(
    OpenDataSignal.extend({
      confidence: z.number().min(0).max(1).nullable(),
      sourceAttribution: z.array(
        SourceAttribution.extend({
          confidence: z.number().min(0).max(1).nullable(),
        }),
      ),
    }),
  ),
});

export const crmConnectorRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/crm/connectors',
    { schema: { response: { 200: ConnectorsResponse } } },
    async () => ({ items: buildConnectorCatalog() }),
  );

  server.get(
    '/crm/open-data/signals',
    {
      schema: {
        querystring: OpenDataSignalsQuery,
        response: { 200: UnscoredOpenDataSignalsResponse },
      },
    },
    async (req) => {
      const now = new Date();
      const signals = await buildOpenDataSignals({
        query: req.query.query,
        ticker: req.query.ticker,
        now,
      });
      return {
        generatedAt: now.toISOString(),
        connectors: buildConnectorCatalog(now),
        signals,
      };
    },
  );
};
