import { useSyncExternalStore } from 'react';

import {
  collabDocKey,
  collabNotesRead,
  readCollabDoc,
  subscribeCollabDoc,
  type CollabNotesPhase,
} from '@/lib/collab-notes-read';

export function useCollabNotesRead(
  entityType: string,
  entityId: string | undefined,
  fieldKey: string,
): CollabNotesPhase {
  const key = entityId ? collabDocKey(entityType, entityId, fieldKey) : '';
  const snap = useSyncExternalStore(
    (listener) => subscribeCollabDoc(key, listener),
    () => readCollabDoc(key),
    () => readCollabDoc(key),
  );
  return collabNotesRead(snap);
}
