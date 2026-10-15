// Small in-memory limits for the two server routes. They are per instance, which is fine for a
// testnet demo: they bound abuse, they do not pretend to be a billing system.

/** The caller's IP as set by the platform. Client-supplied forwarding headers are not trusted. */
export function clientIp(req: Request): string {
  const h = req.headers;
  // Set by Vercel's edge, not by the client.
  const vercel = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip");
  if (vercel) return vercel.split(",")[0]!.trim();
  // Elsewhere, only the right-most hop was appended by our own proxy.
  const xff = h.get("x-forwarded-for");
  return xff ? xff.split(",").at(-1)!.trim() : "unknown";
}

export class Window {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly ms: number,
  ) {}

  /** Records a hit and returns false when the key is over its budget. */
  take(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.ms);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}

/** Same-origin check for browser calls (a missing Origin, e.g. curl, is treated as foreign). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
