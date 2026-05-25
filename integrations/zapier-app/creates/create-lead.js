/**
 * Action — Create Lead
 *
 * Maps Zapier user-supplied fields onto BidStack POST /api/v1/leads.
 * Validates required fields client-side so the user gets immediate feedback
 * in the Zap editor (rather than a 400 at run time).
 */

const performCreate = async (z, bundle) => {
  const body = {
    title: bundle.inputData.title,
    status: bundle.inputData.status || 'NEW',
    email: bundle.inputData.email || undefined,
    phone: bundle.inputData.phone || undefined,
    company: bundle.inputData.company || undefined,
    source: bundle.inputData.source || 'ZAPIER',
    notes: bundle.inputData.notes || undefined,
  };

  const res = await z.request({
    url: `${bundle.authData.instanceUrl}/api/v1/leads`,
    method: 'POST',
    body,
  });

  return res.data;
};

module.exports = {
  key: 'createLead',
  noun: 'Lead',
  display: {
    label: 'Create Lead',
    description: 'Creates a new lead in BidStack.',
    important: true,
  },
  operation: {
    perform: performCreate,
    inputFields: [
      {
        key: 'title',
        label: 'Title',
        type: 'string',
        required: true,
        helpText: 'Short description of the lead (e.g. "Acme Corp — Q3 expansion")',
      },
      {
        key: 'status',
        label: 'Status',
        type: 'string',
        required: false,
        choices: ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED'],
        default: 'NEW',
      },
      { key: 'email', label: 'Email', type: 'string', required: false },
      { key: 'phone', label: 'Phone', type: 'string', required: false },
      { key: 'company', label: 'Company name', type: 'string', required: false },
      {
        key: 'source',
        label: 'Source',
        type: 'string',
        required: false,
        default: 'ZAPIER',
        helpText: 'Where this lead came from. Defaults to ZAPIER.',
      },
      { key: 'notes', label: 'Notes', type: 'text', required: false },
    ],
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
      { key: 'createdAt', label: 'Created At', type: 'datetime' },
    ],
  },
};
