export * from './types/plugin.js';
export { OdooPlugin } from './odoo/index.js';
export { SalesforcePlugin } from './salesforce/index.js';
export { MicrosoftPlugin } from './microsoft/index.js';

import { IntegrationRegistry } from './types/plugin.js';
import { OdooPlugin } from './odoo/index.js';
import { SalesforcePlugin } from './salesforce/index.js';
import { MicrosoftPlugin } from './microsoft/index.js';

/** Global registry of integration plugins. */
export const integrationRegistry = new IntegrationRegistry();

// Register built-in plugins.
integrationRegistry.register(new OdooPlugin());
integrationRegistry.register(new SalesforcePlugin());
integrationRegistry.register(new MicrosoftPlugin());
