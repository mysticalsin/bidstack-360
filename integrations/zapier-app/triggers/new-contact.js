/**
 * Trigger — New Contact (REST hook with polling fallback)
 */

const TRIGGER_KEY = 'newContact';
const EVENT = 'NEW_CONTACT';

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

const getContactFromHookPayload = (z, bundle) => {
  const contact = bundle.cleanedRequest && bundle.cleanedRequest.data
    ? bundle.cleanedRequest.data
    : bundle.cleanedRequest;
  return [contact];
};

const getContactsForListing = (z, bundle) =>
  z
    .request({
      url: `${bundle.authData.instanceUrl}/api/v1/zapier/triggers/NEW_CONTACT`,
    })
    .then((res) => res.data);

module.exports = {
  key: TRIGGER_KEY,
  noun: 'Contact',
  display: {
    label: 'New Contact',
    description: 'Triggers when a new contact is created in BidStack.',
  },
  operation: {
    type: 'hook',
    performSubscribe: subscribeHook,
    performUnsubscribe: unsubscribeHook,
    perform: getContactFromHookPayload,
    performList: getContactsForListing,
    sample: {
      id: '01HZ9P0Q1R2S3T4V5W6X7Y8Z9B',
      name: 'Jane Doe',
      email: 'jane.doe@acme.example',
      phone: '+1-415-555-0142',
      createdAt: '2026-05-20T12:35:00.000Z',
    },
    outputFields: [
      { key: 'id', label: 'Contact ID' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'createdAt', label: 'Created At', type: 'datetime' },
    ],
  },
};
