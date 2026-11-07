export { default, Relay } from './worker.js';
import { DurableObject } from 'cloudflare:workers';
// Inert: keeps the existing PreviewOrigin namespace valid. No container is started.
export class PreviewOrigin extends DurableObject {
  async fetch() { return new Response('retired', { status: 410 }); }
}
