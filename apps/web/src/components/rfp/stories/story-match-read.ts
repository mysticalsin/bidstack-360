// Matched stories may say "No stories matched" only after the payload arrives.
// A pause has isLoading false and no rows. That read is still unread. A failure
// with no payload is not an empty catalog.

export type StoryMatchPhase = 'unread' | 'failed' | 'ready';

export interface StoryMatchReadSnapshot {
  data?: unknown;
  isError?: boolean;
  status?: string;
}

export function storyMatchPhase(snapshot: StoryMatchReadSnapshot): StoryMatchPhase {
  if (snapshot.data !== undefined) return 'ready';
  if (snapshot.isError === true || snapshot.status === 'error') return 'failed';
  return 'unread';
}
