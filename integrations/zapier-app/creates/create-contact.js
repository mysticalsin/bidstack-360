/**
 * Action — Create Contact
 */

const performCreate = async (z, bundle) => {
  const body = {
    name: bundle.inputData.name,
    email: bundle.inputData.email || undefined,
    phone: bundle.inputData.phone || undefined,
    title: bundle.inputData.title || undefined,
    companyId: bundle.inputData.companyId || undefined,
  };

  const res = await z.request({
    url: `${bundle.authData.instanceUrl}/api/v1/contacts`,
    method: 'POST',
    body,
  });

  return res.data;
};

module.exports = {
  key: 'createContact',
  noun: 'Contact',
  display: {
    label: 'Create Contact',
    description: 'Creates a new contact in BidStack.',
  },
  operation: {
    perform: performCreate,
    inputFields: [
      { key: 'name', label: 'Full name', type: 'string', required: true },
      { key: 'email', label: 'Email', type: 'string', required: false },
      { key: 'phone', label: 'Phone', type: 'string', required: false },
      { key: 'title', label: 'Job title', type: 'string', required: false },
      {
        key: 'companyId',
        label: 'Company ID',
        type: 'string',
        required: false,
        helpText: 'Optional. The BidStack company UUID to link this contact to.',
      },
    ],
    sample: {
      id: '01HZ9P0Q1R2S3T4V5W6X7Y8Z9B',
      name: 'Jane Doe',
      email: 'jane.doe@acme.example',
      createdAt: '2026-05-20T12:35:00.000Z',
    },
    outputFields: [
      { key: 'id', label: 'Contact ID' },
      { key: 'name', label: 'Name' },
      { key: 'createdAt', label: 'Created At', type: 'datetime' },
    ],
  },
};
