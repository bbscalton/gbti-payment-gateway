/**
 * Sapp — 3-D Secure challenge records (sandbox)
 *
 * A 3DS payment can only be completed when:
 *  - a challenge was issued server-side for that order (this table),
 *  - the request carries that challenge id,
 *  - the challenge is still pending, not expired, and has attempts left,
 *  - the order is pending with threeDsStatus = "challenge_required",
 *  - the OTP is correct (sandbox: the documented test code SANDBOX_3DS_OTP).
 * Challenges are single-use: consumption is an atomic conditional UPDATE.
 */

import type { Env } from "./types";
import { timingSafeEqualStr } from "./admin";

/** Documented sandbox OTP for the 3DS test card (4000 0000 0000 3220). */
export const SANDBOX_3DS_OTP = "123456";
export const THREE_DS_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const THREE_DS_MAX_ATTEMPTS = 3;

export type ThreeDsChallengeStatus = "pending" | "succeeded" | "failed" | "expired" | "superseded";

export interface ThreeDsChallenge {
  id: string;
  orderId: string;
  paymentRef: string;
  status: ThreeDsChallengeStatus;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  createdAt: string;
  completedAt: string | null;
}

function rowToChallenge(row: Record<string, unknown>): ThreeDsChallenge {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    paymentRef: String(row.payment_ref),
    status: String(row.status) as ThreeDsChallengeStatus,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || THREE_DS_MAX_ATTEMPTS),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  };
}

function newChallengeId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "3ds_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isValidChallengeIdFormat(id: string | undefined | null): boolean {
  return typeof id === "string" && /^3ds_[0-9a-f]{32}$/.test(id);
}

export function isChallengeExpired(ch: ThreeDsChallenge, now: Date = new Date()): boolean {
  return new Date(ch.expiresAt).getTime() <= now.getTime();
}

export function isCorrectSandboxOtp(code: string | undefined | null): boolean {
  return timingSafeEqualStr(String(code ?? "").trim(), SANDBOX_3DS_OTP);
}

/**
 * Issue a new challenge for an order. Any earlier pending challenge for the
 * same order is superseded, so only the newest challenge can ever succeed.
 */
export async function createChallenge(
  env: Env,
  orderId: string,
  paymentRef: string,
  now: Date = new Date()
): Promise<ThreeDsChallenge> {
  await env.DB.prepare(
    `UPDATE three_ds_challenges SET status = 'superseded', completed_at = ?
     WHERE order_id = ? AND status = 'pending'`
  )
    .bind(now.toISOString(), orderId)
    .run();

  const ch: ThreeDsChallenge = {
    id: newChallengeId(),
    orderId,
    paymentRef,
    status: "pending",
    attempts: 0,
    maxAttempts: THREE_DS_MAX_ATTEMPTS,
    expiresAt: new Date(now.getTime() + THREE_DS_CHALLENGE_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
    completedAt: null,
  };
  await env.DB.prepare(
    `INSERT INTO three_ds_challenges
       (id, order_id, payment_ref, status, attempts, max_attempts, expires_at, created_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`
  )
    .bind(ch.id, orderId, paymentRef, ch.maxAttempts, ch.expiresAt, ch.createdAt)
    .run();
  return ch;
}

export async function getChallenge(env: Env, id: string): Promise<ThreeDsChallenge | null> {
  if (!isValidChallengeIdFormat(id)) return null;
  const row = await env.DB.prepare(`SELECT * FROM three_ds_challenges WHERE id = ?`).bind(id).first();
  return row ? rowToChallenge(row as Record<string, unknown>) : null;
}

/**
 * Atomically record one attempt. Returns the new attempt count, or null if the
 * challenge is no longer pending or has no attempts left (nothing is updated).
 */
export async function recordAttempt(env: Env, id: string): Promise<number | null> {
  const res = await env.DB.prepare(
    `UPDATE three_ds_challenges SET attempts = attempts + 1
     WHERE id = ? AND status = 'pending' AND attempts < max_attempts`
  )
    .bind(id)
    .run();
  if (!res.meta || Number(res.meta.changes) !== 1) return null;
  const ch = await getChallenge(env, id);
  return ch ? ch.attempts : null;
}

/**
 * Atomically move a PENDING challenge to a terminal status. Returns true only
 * for the single request that performed the transition (single-use guarantee).
 */
export async function finishChallenge(
  env: Env,
  id: string,
  status: Exclude<ThreeDsChallengeStatus, "pending">,
  now: Date = new Date()
): Promise<boolean> {
  const res = await env.DB.prepare(
    `UPDATE three_ds_challenges SET status = ?, completed_at = ?
     WHERE id = ? AND status = 'pending'`
  )
    .bind(status, now.toISOString(), id)
    .run();
  return !!res.meta && Number(res.meta.changes) === 1;
}
