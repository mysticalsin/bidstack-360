// One-line registration in packages/twenty-server/src/modules/modules.module.ts
// (only existing-file edit on the server side)
//
//   import { BidStackModule } from 'twenty-bidstack/server';
//   ...
//   @Module({ imports: [..., BidStackModule] })

import { Module } from '@nestjs/common';

import { BidStackStandardObjectsModule } from './standard-objects/bidstack-standard-objects.module';
import { DustModule } from './dust/dust.module';
import { IntelModule } from './intel/intel.module';
import { ProposalModule } from './proposal/proposal.module';
import { BidStackWorkflowActionsModule } from './workflow-actions/bidstack-workflow-actions.module';
import { BidStackGraphqlModule } from './graphql/bidstack-graphql.module';

// All eight standard objects, the Dust client + webhook receiver + MCP server,
// the intel adapters (financial, news, hiring), the proposal drafter, and the
// custom workflow actions are mounted here. Nothing in this module reaches
// outside `twenty-bidstack` except to import shared utilities from
// `twenty-shared` and to consume the AuthGuard / WorkspaceGuard from
// `twenty-server` so we inherit Twenty's multi-tenant scoping for free.
@Module({
  imports: [
    BidStackStandardObjectsModule,
    DustModule,
    IntelModule,
    ProposalModule,
    BidStackWorkflowActionsModule,
    BidStackGraphqlModule,
  ],
})
export class BidStackModule {}
