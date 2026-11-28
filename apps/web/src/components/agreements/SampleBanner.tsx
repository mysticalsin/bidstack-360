import { Icon } from '@/components/ui/Icon';

import { AGREEMENT_REFERENCE_BADGE, agreementReferenceNote } from './reference-copy';

/** Shown when the agreements payload is the fixture fallback (`sample: true`). */
export function SampleBanner({ what = 'agreements' }: { what?: string }) {
  return (
    <div className="agr-sample" role="note" data-testid="agreements-sample-banner">
      <Icon name="info" size={16} />
      <span>
        <strong>{AGREEMENT_REFERENCE_BADGE}.</strong> {agreementReferenceNote(what)}
      </span>
    </div>
  );
}
