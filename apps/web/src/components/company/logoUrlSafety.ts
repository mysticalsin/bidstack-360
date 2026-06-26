export function displayableLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  if (/^blob:/i.test(trimmed)) return trimmed;
  if (/^data:image\/(?:png|jpe?g|webp|gif);/i.test(trimmed)) return trimmed;

  if (typeof window === 'undefined') return null;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    return parsed.origin === window.location.origin ? parsed.href : null;
  } catch {
    return null;
  }
}
