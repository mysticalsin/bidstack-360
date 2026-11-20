import type { TFunction } from 'i18next';
import { Mic } from 'lucide-react';

import type { Item } from './commandPaletteUtils';

/** "Ask Jarvis" row for sentence-like queries: hands the ask to the Jarvis
 *  panel, which answers with citations and can act after confirmation. */
export function buildAskJarvisItem(
  query: string,
  t: TFunction,
  onAsk: (query: string) => void,
): Item {
  return {
    id: 'jarvis:ask',
    group: 'ask',
    label: t('jarvis.askRow', 'Ask Jarvis: “{{q}}”', { q: query.trim() }),
    leading: <Mic size={16} aria-hidden className="text-[var(--brand-primary)]" />,
    onSelect: () => onAsk(query),
  };
}
