// Standard object: OpportunityIntel
// One-to-one with Twenty's existing `Opportunity`. Carries financial snapshot,
// ticker + sparkline cache, market cap, growth, EBITDA, debt, credit rating,
// headcount trend. Refreshed by `intel/financial-data.service.ts`.
//
// This file is consumed by Twenty's standard-object loader. Generates a GraphQL
// type, REST endpoint, list view, kanban view, record page — for free.

import { RegisteredStandardObject } from 'twenty-server/engine/twenty-orm/decorators/registered-standard-object.decorator';
import { WorkspaceEntity } from 'twenty-server/engine/twenty-orm/decorators/workspace-entity.decorator';
import { WorkspaceField } from 'twenty-server/engine/twenty-orm/decorators/workspace-field.decorator';
import { WorkspaceRelation } from 'twenty-server/engine/twenty-orm/decorators/workspace-relation.decorator';
import { FieldMetadataType } from 'twenty-shared/types';

import { OpportunityWorkspaceEntity } from 'twenty-server/modules/opportunity/standard-objects/opportunity.workspace-entity';

@RegisteredStandardObject({
  standardId:  'opportunityIntel',
  namePlural:  'opportunityIntels',
  labelPlural: 'Opportunity Intel',
  labelSingular: 'Opportunity Intel',
  description: 'Financial + market intelligence snapshot for an opportunity. Refreshed by Dust + adapters.',
  icon: 'IconChartLine',
})
@WorkspaceEntity()
export class OpportunityIntelWorkspaceEntity {
  @WorkspaceField({ standardId: 'ticker',         label: 'Ticker',         type: FieldMetadataType.TEXT })
  ticker?: string;

  @WorkspaceField({ standardId: 'marketCap',      label: 'Market cap',     type: FieldMetadataType.CURRENCY })
  marketCap?: { amountMicros: number; currencyCode: string };

  @WorkspaceField({ standardId: 'revenueAnnual',  label: 'Revenue (TTM)',  type: FieldMetadataType.CURRENCY })
  revenueAnnual?: { amountMicros: number; currencyCode: string };

  @WorkspaceField({ standardId: 'revenueGrowth',  label: 'Revenue growth %', type: FieldMetadataType.NUMBER })
  revenueGrowth?: number;

  @WorkspaceField({ standardId: 'ebitdaMargin',   label: 'EBITDA margin %',  type: FieldMetadataType.NUMBER })
  ebitdaMargin?: number;

  @WorkspaceField({ standardId: 'creditRating',   label: 'Credit rating',    type: FieldMetadataType.TEXT })
  creditRating?: string;

  @WorkspaceField({ standardId: 'headcount',      label: 'Headcount',        type: FieldMetadataType.NUMBER })
  headcount?: number;

  @WorkspaceField({ standardId: 'headcountTrend', label: 'Headcount trend (90d)', type: FieldMetadataType.RAW_JSON })
  headcountTrend?: { date: string; n: number }[];

  @WorkspaceField({ standardId: 'pricePoints',    label: 'Price sparkline (30d)', type: FieldMetadataType.RAW_JSON })
  pricePoints?: number[];

  @WorkspaceField({ standardId: 'lastRefreshedAt', label: 'Last refreshed', type: FieldMetadataType.DATE_TIME })
  lastRefreshedAt?: string;

  @WorkspaceRelation({
    standardId:    'opportunity',
    label:         'Opportunity',
    inverseSideTarget: () => OpportunityWorkspaceEntity,
    inverseSideFieldKey: 'intel',
    type: 'ONE_TO_ONE',
  })
  opportunity?: OpportunityWorkspaceEntity;
}
