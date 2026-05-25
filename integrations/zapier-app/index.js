/**
 * BidStack Zapier app — main entry point.
 *
 * Wires together authentication, triggers, and create actions for the
 * partner-side Zapier app. Deploy with `zapier push` from this directory
 * after running `zapier register` once.
 */

const auth = require('./authentication');

const newLead = require('./triggers/new-lead');
const newContact = require('./triggers/new-contact');
const dealStageChange = require('./triggers/deal-stage-change');

const createLead = require('./creates/create-lead');
const createContact = require('./creates/create-contact');
const createTask = require('./creates/create-task');

module.exports = {
  // Match these to the package.json values Zapier deploys.
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,

  authentication: auth.authentication,
  beforeRequest: auth.beforeRequest,
  afterResponse: auth.afterResponse,

  triggers: {
    [newLead.key]: newLead,
    [newContact.key]: newContact,
    [dealStageChange.key]: dealStageChange,
  },

  creates: {
    [createLead.key]: createLead,
    [createContact.key]: createContact,
    [createTask.key]: createTask,
  },

  searches: {},
  resources: {},
};
