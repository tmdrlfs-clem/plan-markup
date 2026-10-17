// Client IP for rate limiting. Pure. On Vercel the platform sets x-real-ip and
// x-forwarded-for, so they cannot be spoofed; locally they may be absent.

const MAX_LENGTH = 64;

export function getClientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, MAX_LENGTH);
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return first.slice(0, MAX_LENGTH);
  return "unknown";
}
