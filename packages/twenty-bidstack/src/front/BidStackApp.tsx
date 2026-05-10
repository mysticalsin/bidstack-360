// Registers BidStack as a Twenty marketplace application.
// One-line edit in packages/twenty-front/src/modules/applications/registry.ts:
//
//   import { BidStackApp } from 'twenty-bidstack/front';
//   registerApplication(BidStackApp);

import { type ApplicationRegistration } from 'twenty-front/modules/applications/types/ApplicationRegistration';

import { bidstackCommands }   from './command-menu/bidstack.commands';
import { bidstackDashboards } from './dashboards';
import { bidstackNavigation } from './navigation/bidstack.nav';
import { bidstackRecordTabs } from './extensions';
import { bidstackSettingsPanels } from './settings';
import { bidstackWorkflowActionMetas } from './workflow-actions';
import { bidstackAiAgents }   from './ai-agents';

export const BidStackApp: ApplicationRegistration = {
  id:          'mantu.bidstack',
  name:        'BidStack 360°',
  vendor:      'Mantu',
  version:     '0.1.0',
  description: 'Bid & presales CRM layer with Dust agents, MCP, and 360° opportunity intel.',
  icon:        'IconTarget',

  // Everything below plugs into Twenty's existing extension points.
  // Nothing here mutates global state; uninstall == removed from registry.
  navigation:        bidstackNavigation,
  commands:          bidstackCommands,
  dashboardPresets:  bidstackDashboards,
  recordTabs:        bidstackRecordTabs,        // adds "360°" tab on Opportunity, "Triggers" tab, etc.
  settingsPanels:    bidstackSettingsPanels,    // Settings → Integrations → Dust
  workflowActions:   bidstackWorkflowActionMetas, // appear in WF builder
  aiAgents:          bidstackAiAgents,          // appear in AI sidebar selector

  permissions: ['read:opportunity', 'write:opportunity', 'read:person', 'write:task'],
};
