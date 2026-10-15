// Relays a demo watcher's /status. The watchers serve plain HTTP from their own machines, which an
// HTTPS page cannot fetch. The upstreams come from the server's config: a caller picks an index,
// never a URL.
import { NextResponse } from "next/server";
import { Window, clientIp } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAMS = (process.env.WATCHER_STATUS_ORIGINS ?? "")
  .split(",")
  .map((u) => u.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const MAX_BYTES = 256 * 1024;
// A page polls each watcher every 15 s; this leaves room for several open tabs.
const perIp = new Window(120, 60_000);

/** Reads at most `max` bytes, and stops reading (returning null) the moment the body goes past it. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  if (Number(res.headers.get("content-length") ?? 0) > max) return null;
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function GET(req: Request, { params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  const origin = /^[1-9]$/.test(n) ? UPSTREAMS[Number(n) - 1] : undefined;
  if (!origin) return NextResponse.json({ error: "no such watcher" }, { status: 404 });
  if (!perIp.take(clientIp(req))) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  try {
    const res = await fetch(`${origin}/status`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return NextResponse.json({ error: `watcher answered HTTP ${res.status}` }, { status: 502 });
    const body = await readCapped(res, MAX_BYTES);
    if (body === null) return NextResponse.json({ error: "status document too large" }, { status: 502 });
    // Re-serialised, so only JSON leaves this route.
    return new NextResponse(JSON.stringify(JSON.parse(body)), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "watcher unreachable" }, { status: 502 });
  }
}
