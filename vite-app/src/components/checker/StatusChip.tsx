import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { STATUS_LABEL } from '../../lib/checker/copy';
import type { CheckStatus } from '../../lib/checker/types';

export function StatusIcon({ status, size = 16 }: { status: CheckStatus; size?: number }) {
  const props = { size, 'aria-hidden': true, focusable: false } as const;
  if (status === 'pass') return <CheckCircle2 {...props} />;
  if (status === 'warn') return <AlertTriangle {...props} />;
  return <XCircle {...props} />;
}

export default function StatusChip({ status }: { status: CheckStatus }) {
  return (
    <span className={`ck-chip ck-chip--${status}`}>
      <StatusIcon status={status} size={14} />
      {STATUS_LABEL[status]}
    </span>
  );
}
