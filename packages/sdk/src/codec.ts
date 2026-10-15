// Mapping between Arkiv entities and On the Clock entities.
import { addr, bytes32, jsonToPayload, key, str, u64, type FullEntity } from "@arkiv-network/sdk";
import type { Address, Hex } from "viem";
import { APP, KINDS, type Kind } from "./constants.js";
import type { OtcEntity } from "./types.js";

type AttrInput = ReturnType<typeof str> | ReturnType<typeof u64> | ReturnType<typeof addr> | ReturnType<typeof key> | ReturnType<typeof bytes32>;

/** Typed attribute constructors, re-exported so callers never pass a bare value (bare numbers become i32). */
export const A = { str, u64, addr, key, bytes32 };

export function baseAttrs(kind: Kind): Record<string, AttrInput> {
  return { app: str(APP), kind: str(kind) };
}

export function encodePayload(value: unknown): Uint8Array {
  return jsonToPayload(JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v))));
}

const dec = new TextDecoder();

function attrValue(raw: unknown): string | bigint | boolean {
  if (raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)) {
    return attrValue((raw as { value: unknown }).value);
  }
  if (typeof raw === "bigint" || typeof raw === "boolean" || typeof raw === "string") return raw;
  if (typeof raw === "number") return BigInt(raw);
  return String(raw);
}

export function isKind(v: unknown): v is Kind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

/** Decodes an entity selected with "*". Returns null for anything that is not ours or not parseable. */
export function decodeEntity<P = unknown>(e: FullEntity): OtcEntity<P> | null {
  const attrs: Record<string, string | bigint | boolean> = {};
  for (const [name, v] of Object.entries(e.attributes ?? {})) attrs[name] = attrValue(v);
  if (attrs.app !== APP || !isKind(attrs.kind)) return null;
  const bytes = e.payload ?? new Uint8Array();
  let payload: unknown = null;
  if (bytes.length) {
    try {
      payload = JSON.parse(dec.decode(bytes));
    } catch {
      return null;
    }
  }
  return {
    key: e.key as Hex,
    kind: attrs.kind,
    creator: e.creator as Address,
    owner: e.owner as Address,
    createdAt: BigInt(e.createdAt),
    expiresAt: BigInt(e.expiresAt),
    readonly: !!e.creationFlags?.readonly,
    permissionlessExtension: !!e.creationFlags?.permissionlessExtension,
    attrs,
    payload: payload as P,
    payloadBytes: bytes.length,
  };
}
