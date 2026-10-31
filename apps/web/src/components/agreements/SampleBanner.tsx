import { Icon } from '@/components/ui/Icon';

/** Shown on every Agreements surface rendering Sample data (API not live yet). */
export function SampleBanner({ what = 'agreements' }: { what?: string }) {
  return (
    <div className="agr-sample" role="note" data-testid="agreements-sample-banner">
      <Icon name="info" size={16} />
      <span>
        <strong>Sample preview.</strong> The Agreements service is not live on this server yet, so these {what} are
        illustrative, not your records. Uploads turn on when it is.
      </span>
    </div>
  );
}
