// Small in-memory limits for the two server routes. They are per instance, which is fine for a
// testnet demo: they bound abuse, they do not pretend to be a billing system.

/**
 * The caller's IP as set by the platform. On Vercel, `x-vercel-forwarded-for` is written by the edge
 * and cannot be set by the client. Anywhere else no forwarding header is trustworthy, so every caller
 * shares one bucket: stricter, never bypassable.
 */
export function clientIp(req: Request): string {
  if (!process.env.VERCEL) return "shared";
  const v = req.headers.get("x-vercel-forwarded-for");
  return v ? v.split(",")[0]!.trim() : "shared";
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
    this.hits.delete(key);
    this.hits.set(key, recent);
    if (this.hits.size > Window.SOFT_CAP) this.prune(now);
    return true;
  }

  // Memory bound. Expired windows go first; only past a hard cap (a flood of distinct addresses far
  // beyond any real audience) are the least recently used live windows dropped.
  private static readonly SOFT_CAP = 20_000;
  private static readonly HARD_CAP = 100_000;

  private prune(now: number) {
    for (const [k, ts] of this.hits) if (!ts.some((t) => now - t < this.ms)) this.hits.delete(k);
    while (this.hits.size > Window.HARD_CAP) this.hits.delete(this.hits.keys().next().value as string);
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
