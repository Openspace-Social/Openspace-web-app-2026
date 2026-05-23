export function getRemoteProfileUrl(handle: string): string | null {
  const normalized = (handle || '').trim().replace(/^@/, '');
  const atIndex = normalized.indexOf('@');
  if (atIndex <= 0 || atIndex === normalized.length - 1) return null;
  const username = normalized.slice(0, atIndex).trim();
  const instance = normalized.slice(atIndex + 1).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!username || !instance) return null;
  return `https://${instance}/@${encodeURIComponent(username)}`;
}
