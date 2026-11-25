/** Company detail note. The body stays with the title so the Notes tab can show the sentence. */
export function companyDetailNote(note: {
  id: string;
  title: string;
  bodyMd: string;
  author: { name: string | null } | null;
  createdAt: Date;
}): { id: string; title: string; bodyMd: string; authorName: string | null; createdAt: string } {
  return {
    id: note.id,
    title: note.title,
    bodyMd: note.bodyMd,
    authorName: note.author?.name ?? null,
    createdAt: note.createdAt.toISOString(),
  };
}
