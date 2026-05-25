/**
 * Trigger — New Lead (REST hook with polling fallback)
 *
 * Subscribe path uses BidStack's POST /api/v1/zapier/subscribe to install a
 * webhook that fires on every new lead. Performlist provides instant test
 * data + a polling fallback if the webhook subscription fails.
 */

const TRIGGER_KEY = 'newLead';
const EVENT = 'NEW_LEAD';

const subscribeHook = (z, bundle) => {
  return z
    .request({
      url: `${bundle.authData.instanceUrl}/api/v1/zapier/subscribe`,
      method: 'POST',
      body: { event: EVENT, targetUrl: bundle.targetUrl },
    })
    .then((res) => res.data);
};

const unsubscribeHook = (z, bundle) => {
  const subId = bundle.subscribeData && bundle.subscribeData.id;
  if (!subId) return {};
  return z
    .request({
      url: `${bundle.authData.instanceUrl}/api/v1/zapier/subscribe/${subId}`,
      method: 'DELETE',
    })
    .then(() => ({}));
};

/**
 * Payload normalizer — converts hook payload into the shape Zapier shows the
 * user when they map fields. Also used by perform_list for polling test data.
 */
const getLeadFromHookPayload = (z, bundle) => {
  // BidStack's webhook fan-out wraps the lead under .data.
  const lead = bundle.cleanedRequest && bundle.cleanedRequest.data
    ? bundle.cleanedRequest.data
    : bundle.cleanedRequest;
  return [lead];
};

const getLeadsForListing = (z, bundle) => {
  return z
    .request({
      url: `${bundle.authData.instanceUrl}/api/v1/zapier/triggers/NEW_LEAD`,
    })
    .then((res) => res.data);
};

module.exports = {
  key: TRIGGER_KEY,
  noun: 'Lead',
  display: {
    label: 'New Lead',
    description: 'Triggers when a new lead is created in BidStack.',
    important: true,
  },
  operation: {
    type: 'hook',
    performSubscribe: subscribeHook,
    performUnsubscribe: unsubscribeHook,
    perform: getLeadFromHookPayload,
    performList: getLeadsForListing,
    sample: {
      id: '01HZ9P0Q1R2S3T4V5W6X7Y8Z9A',
      title: 'Acme Corp — Q3 expansion',
      status: 'NEW',
      email: 'jane.doe@acme.example',
      createdAt: '2026-05-20T12:30:00.000Z',
    },
    outputFields: [
      { key: 'id', label: 'Lead ID' },
      { key: 'title', label: 'Title' },
      { key: 'status', label: 'Status' },
      { key: 'email', label: 'Email' },
      { key: 'createdAt', label: 'Created At', type: 'datetime' },
    ],
  },
};
