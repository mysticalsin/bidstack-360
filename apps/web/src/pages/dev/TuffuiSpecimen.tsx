/**
 * /dev/tuffui: specimen sheet for the vendored TUFFUI primitives on repo
 * tokens. Development only (see routes/DevRoutes.tsx); fixtures, no API.
 */
import { CircleAlert, CircleCheck, CircleX, Clock, Info, TriangleAlert, Webhook } from 'lucide-react';

import { Inset, Panel, Shell, ShellHeader } from '@/components/vendor/tuffui/surface';
import { StatusPill, Tag } from '@/components/vendor/tuffui/status-pill';

export default function TuffuiSpecimen() {
  return (
    <main id="main" className="mx-auto max-w-4xl space-y-6 p-8">
      <h1 className="page-title">TUFFUI on repo tokens</h1>

      <Shell aria-labelledby="pills-title">
        <ShellHeader icon={Webhook} title={<span id="pills-title">Status pills</span>} aside={<Tag>v3.0.0</Tag>} />
        <Panel className="flex flex-wrap gap-2 p-4">
          <StatusPill tone="positive" icon={CircleCheck}>Delivered</StatusPill>
          <StatusPill tone="negative" icon={CircleX}>Failed</StatusPill>
          <StatusPill tone="warning" icon={TriangleAlert}>Retrying</StatusPill>
          <StatusPill tone="brand" icon={Info}>Go</StatusPill>
          <StatusPill tone="neutral" icon={Clock}>Queued</StatusPill>
          <StatusPill tone="negative" icon={CircleAlert} size="sm">Paused</StatusPill>
          <StatusPill tone="positive" icon={CircleCheck} iconWeight="bold">Outline</StatusPill>
        </Panel>
      </Shell>

      <Shell aria-labelledby="tags-title">
        <ShellHeader title={<span id="tags-title">Tags and insets</span>} subtitle="Shell, panel, inset" />
        <Panel className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <Tag>https</Tag>
            <Tag>bid.submitted</Tag>
            <Tag>gpt-4.1</Tag>
          </div>
          <Inset className="p-3 font-mono text-xs text-fg-secondary">{'{ "event": "bid.submitted" }'}</Inset>
        </Panel>
      </Shell>
    </main>
  );
}
