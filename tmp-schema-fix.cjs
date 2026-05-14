const fs = require('fs');
let content = fs.readFileSync('packages/db/prisma/schema.prisma', 'utf8');

const models = [
  'Org', 'User', 'Opportunity', 'Contact', 'Task', 'Document',
  'SyncEvent', 'ApiKey', 'WebhookSubscription', 'CompanyEnrichment',
  'AiInsight', 'DustRun', 'DashboardWidget', 'BidOpportunity',
  'RiskRegisterItem', 'ComplianceCheck', 'ProposalDocument',
  'ProviderHealth', 'QueueHealth', 'ReleaseScore', 'Note',
  'FileAttachment', 'AccountSolution', 'AccountProduct',
  'DocumentExtraction', 'ProductCategory', 'Product', 'SalesOrder',
  'SalesOrderLine', 'Invoice', 'InvoiceLine', 'Payment',
  'PredictiveScore', 'Workflow', 'WorkflowAction', 'WorkflowRun',
  'Comment', 'Mention', 'UserPresence', 'Lead', 'ServiceCase',
  'Territory', 'LeadRoutingRule', 'Forecast', 'Plugin',
  'VoiceCommandLog', 'SubscriptionEvent'
];

for (const model of models) {
  const regex = new RegExp('(model ' + model + ' \\{[\\s\\S]*?)(\\n  @@|\\n\\})', 'g');
  content = content.replace(regex, (match, fields, ending) => {
    if (fields.includes('deletedAt')) return match;
    const lines = fields.split('\n');
    let insertIdx = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].trim();
      if (stripped.startsWith('@@')) {
        insertIdx = i;
        break;
      }
    }
    lines.splice(insertIdx, 0, '  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(6)');
    return lines.join('\n') + ending;
  });
}

fs.writeFileSync('packages/db/prisma/schema.prisma', content);
console.log('Done adding deletedAt fields');
