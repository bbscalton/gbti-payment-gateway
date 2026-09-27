/**
 * Sapp — Admin authentication
 * Admin-only actions (merchant onboarding, live key issuance, status changes)
 * require `Authorization: Bearer <MERCHANT_MASTER_KEY>`.
 * Fails closed: if MERCHANT_MASTER_KEY is not configured, no request is admin.
 */

import type { Env } from "./types";

/** Constant-time string comparison (avoids timing leaks on the admin key). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i % (ab.length || 1)] ?? 0) ^ (bb[i % (bb.length || 1)] ?? 0);
  }
  return diff === 0 && ab.length === bb.length;
}

export type AdminAuthResult = "ok" | "missing" | "invalid" | "not_configured";

export function checkAdminAuth(
  authorizationHeader: string | undefined | null,
  masterKey: string | undefined | null
): AdminAuthResult {
  const configured = (masterKey || "").trim();
  if (!configured) return "not_configured";
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) return "missing";
  const presented = authorizationHeader.slice(7).trim();
  if (!presented) return "missing";
  return timingSafeEqualStr(presented, configured) ? "ok" : "invalid";
}

export function isAdmin(env: Env, authorizationHeader: string | undefined | null): boolean {
  return checkAdminAuth(authorizationHeader, env.MERCHANT_MASTER_KEY) === "ok";
}
