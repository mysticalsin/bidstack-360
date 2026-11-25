import { leverageFlagForAgreement, type MsaLeverageFlag } from '@bidstack/shared';

import { LeverageFlag } from '@/components/agreements/LeverageFlag';

export interface AgreementLeverageQuery {
  isLoading: boolean;
  isError: boolean;
  data?: { flag: MsaLeverageFlag | null } | undefined;
  refetch: () => void;
}

const RETRY_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]';

function Retry({ onRetry }: { onRetry: () => void }) {
  return (
    <button type="button" className={RETRY_CLASS} onClick={onRetry}>
      Retry
    </button>
  );
}

export function AgreementLeverageSlot({
  sample,
  agreementId,
  query,
}: {
  sample: boolean;
  agreementId: string;
  query: AgreementLeverageQuery;
}) {
  // The Sample preview is not a live HEMA agreement. Retry would repeat a
  // leverage read that preview cannot answer.
  if (sample) return null;
  const flags = query.data?.flag ? [query.data.flag] : [];
  const flag = leverageFlagForAgreement(agreementId, flags);
  if (query.isError && flag) {
    return (
      <>
        <LeverageFlag flag={flag} />
        <p className="agr-error" role="alert">
          <span>Could not refresh this MSA leverage read.</span>{' '}
          <Retry onRetry={() => query.refetch()} />
        </p>
      </>
    );
  }
  if (flag) return <LeverageFlag flag={flag} />;
  if (query.isLoading) return null;
  if (query.isError) {
    return (
      <p className="agr-error" role="alert">
        <span>Could not load the MSA leverage read.</span>{' '}
        <Retry onRetry={() => query.refetch()} />
      </p>
    );
  }
  return null;
}
