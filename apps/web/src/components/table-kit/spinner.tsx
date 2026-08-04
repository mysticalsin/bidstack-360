// Ported from D:\CRM\packages\ui\src\components\spinner.tsx (16 lines).
// Verbatim tier (ROUND2-ULTRAPLAN manifest #7): the only edit is the cn import
// path (@crm/ui/lib/utils → @/lib/cn). No tokens — the spinner inherits
// currentColor from whatever it sits inside.

import type { ComponentProps } from 'react';
import { Loader2Icon } from 'lucide-react';

import { cn } from '@/lib/cn';

function Spinner({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };
