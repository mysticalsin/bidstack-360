/**
 * Action — Create Task
 */

const performCreate = async (z, bundle) => {
  const body = {
    title: bundle.inputData.title,
    description: bundle.inputData.description || undefined,
    dueAt: bundle.inputData.dueAt || undefined,
    priority: bundle.inputData.priority || 'MEDIUM',
    assigneeId: bundle.inputData.assigneeId || undefined,
    opportunityId: bundle.inputData.opportunityId || undefined,
    contactId: bundle.inputData.contactId || undefined,
  };

  const res = await z.request({
    url: `${bundle.authData.instanceUrl}/api/v1/tasks`,
    method: 'POST',
    body,
  });

  return res.data;
};

module.exports = {
  key: 'createTask',
  noun: 'Task',
  display: {
    label: 'Create Task',
    description: 'Creates a new task in BidStack, optionally linked to an opportunity or contact.',
  },
  operation: {
    perform: performCreate,
    inputFields: [
      { key: 'title', label: 'Title', type: 'string', required: true },
      { key: 'description', label: 'Description', type: 'text', required: false },
      { key: 'dueAt', label: 'Due date', type: 'datetime', required: false },
      {
        key: 'priority',
        label: 'Priority',
        type: 'string',
        required: false,
        choices: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
        default: 'MEDIUM',
      },
      {
        key: 'assigneeId',
        label: 'Assignee user ID',
        type: 'string',
        required: false,
      },
      {
        key: 'opportunityId',
        label: 'Linked opportunity ID',
        type: 'string',
        required: false,
      },
      {
        key: 'contactId',
        label: 'Linked contact ID',
        type: 'string',
        required: false,
      },
    ],
    sample: {
      id: '01HZ9P0Q1R2S3T4V5W6X7Y8Z9D',
      title: 'Follow up with Acme',
      priority: 'HIGH',
      dueAt: '2026-05-25T17:00:00.000Z',
      createdAt: '2026-05-20T12:40:00.000Z',
    },
    outputFields: [
      { key: 'id', label: 'Task ID' },
      { key: 'title', label: 'Title' },
      { key: 'priority', label: 'Priority' },
      { key: 'dueAt', label: 'Due At', type: 'datetime' },
      { key: 'createdAt', label: 'Created At', type: 'datetime' },
    ],
  },
};
