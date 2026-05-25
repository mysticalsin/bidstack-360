/**
 * Trigger — Deal Stage Change (REST hook only — no polling fallback)
 *
 * WHY no perform_list polling: stage transitions don't have a stable
 * "since" cursor on the BidStack side — only the webhook delivers them
 * with the previous-stage context.
 */

const TRIGGER_KEY = 'dealStageChange';
const EVENT = 'DEAL_STAGE_CHANGE';

const subscribeHook = (z, bundle) =>
  z
    .request({
      url: `${bundle.authData.instanceUrl}/api/v1/zapier/subscribe`,
      method: 'POST',
      body: { event: EVENT, targetUrl: bundle.targetUrl },
    })
    .then((res) => res.data);

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

const getEventFromHookPayload = (z, bundle) => {
  const payload = bundle.cleanedRequest && bundle.cleanedRequest.data
    ? bundle.cleanedRequest.data
    : bundle.cleanedRequest;
  return [payload];
};

module.exports = {
  key: TRIGGER_KEY,
  noun: 'Deal Stage Change',
  display: {
    label: 'Deal Stage Changed',
    description: 'Triggers when an opportunity moves to a new pipeline stage.',
    important: true,
  },
  operation: {
    type: 'hook',
    performSubscribe: subscribeHook,
    performUnsubscribe: unsubscribeHook,
    perform: getEventFromHookPayload,
    sample: {
      opportunityId: '01HZ9P0Q1R2S3T4V5W6X7Y8Z9C',
      title: 'Acme Corp — Q3 expansion',
      fromStage: 'QUALIFICATION',
      toStage: 'PROPOSAL',
      amount: 50000,
      currency: 'USD',
      changedAt: '2026-05-20T14:00:00.000Z',
      changedBy: 'user_abc123',
    },
    outputFields: [
      { key: 'opportunityId', label: 'Opportunity ID' },
      { key: 'title', label: 'Title' },
      { key: 'fromStage', label: 'Previous Stage' },
      { key: 'toStage', label: 'New Stage' },
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'currency', label: 'Currency' },
      { key: 'changedAt', label: 'Changed At', type: 'datetime' },
      { key: 'changedBy', label: 'Changed By (user ID)' },
    ],
  },
};
