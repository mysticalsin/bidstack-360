export function emailDomainForTelemetry(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  if (!value) return null;

  const atIndex = value.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === value.length - 1) return null;
  return value.slice(atIndex + 1);
}
