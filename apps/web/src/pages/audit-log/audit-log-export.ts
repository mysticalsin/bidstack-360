// Clipboard and CSV export utilities for the AuditLog feature.

import type { AuditLogEntry } from '@bidstack/shared';

import { actorLabel, classifyAudit, riskScore, safeStringify } from './audit-log-helpers';

export function writeClipboard(value: string) {
  if (!value) return;
  void navigator.clipboard?.writeText(value);
}

export function exportCsv(rows: AuditLogEntry[]) {
  if (rows.length === 0) return;
  const header = [
    'createdAt',
    'actor',
    'email',
    'action',
    'category',
    'riskScore',
    'targetType',
    'targetId',
    'diff',
  ];
  const csv = [
    header.join(','),
    ...rows.map((row) =>
      [
        row.createdAt,
        actorLabel(row),
        row.userEmail ?? '',
        row.action,
        classifyAudit(row).category,
        riskScore(row),
        row.targetType ?? '',
        row.targetId ?? '',
        safeStringify(row.diff),
      ]
        .map(escapeCsv)
        .join(','),
    ),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `polo-presales-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  const safeText = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}
