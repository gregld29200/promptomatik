/**
 * Where to send someone once they have logged in or reset their password.
 *
 * Other TeachInspire sites (e.g. temoignages.teachinspire.me) gate their pages
 * behind a Studio login and link to /login or /forgot-password with
 * `?next=<their url>`. Only same-site paths and https URLs on teachinspire.me
 * or its subdomains are accepted, so the parameter cannot be used as an open
 * redirect. Anything else returns null and the caller falls back to its
 * default destination.
 */
const ALLOWED_DOMAIN = "teachinspire.me";
const MAX_LENGTH = 2048;

export function safeReturnUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LENGTH) return null;

  // Same-site path. Rejects "//host" and "/\host", which browsers treat as
  // protocol-relative URLs.
  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.startsWith("/\\")) return null;
    return value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host !== ALLOWED_DOMAIN && !host.endsWith(`.${ALLOWED_DOMAIN}`)) return null;
  return url.toString();
}

export function isExternalReturnUrl(url: string): boolean {
  return !url.startsWith("/");
}
