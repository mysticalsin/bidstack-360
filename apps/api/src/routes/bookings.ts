// Booking routes orchestrator.
//
// Registers both route sub-plugins under the same prefix.
// Authenticated page management → bookings-pages.ts
// Public booking routes         → bookings-public.ts
// Shared schemas + email helper → bookings.helpers.ts

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { bookingsPagesRoutes } from './bookings-pages.js';
import { bookingsPublicRoutes } from './bookings-public.js';

export const bookingsRoutes: FastifyPluginAsyncZod = async (server) => {
  await server.register(bookingsPagesRoutes);
  await server.register(bookingsPublicRoutes);
};
