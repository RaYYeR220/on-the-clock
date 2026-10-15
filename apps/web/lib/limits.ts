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
  private lastPrune = 0;
  // Memory bound. When full, unknown keys are refused rather than evicting anyone else's window, so a
  // flood of distinct addresses can never reset a budget. It fails closed.
  private static readonly CAP = 50_000;

  constructor(
    private readonly max: number,
    private readonly ms: number,
  ) {}

  /** Records a hit and returns false when the key is over its budget (or the table is full). */
  take(key: string): boolean {
    const now = Date.now();
    if (now - this.lastPrune > 10_000) this.prune(now);
    const known = this.hits.get(key);
    if (!known && this.hits.size >= Window.CAP) return false;
    const recent = (known ?? []).filter((t) => now - t < this.ms);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Drops windows with no hit inside the period. Runs at most every 10 s. */
  private prune(now: number) {
    this.lastPrune = now;
    for (const [k, ts] of this.hits) if (!ts.some((t) => now - t < this.ms)) this.hits.delete(k);
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
