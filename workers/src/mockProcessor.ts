/**
 * Neuereatec Pay — Mock Acquirer / Card Processor
 * Implements the AcquirerAdapter interface for sandbox testing.
 * Card data is validated in-memory only and NEVER persisted.
 * 
 * ONLY approves documented test cards; declines all others with use_test_card error.
 */

import type { AcquirerAdapter, AcquirerResponse, ErrorCode } from "./types";

/**
 * Test card numbers — sandbox only.
 * NEVER use or accept real card numbers in this flow.
 */
export const TEST_CARDS: Record<string, { outcome: "success" | "decline" | "3ds"; reason?: ErrorCode }> = {
  "4111111111111111": { outcome: "success" },
  "4000000000000002": { outcome: "decline", reason: "card_declined" },
  "4000000000000010": { outcome: "decline", reason: "insufficient_funds" },
  "4000000000000028": { outcome: "decline", reason: "card_expired" },
  "4000000000000036": { outcome: "decline", reason: "invalid_cvv" },
  "4000000000000044": { outcome: "decline", reason: "do_not_honor" },
  "4000000000003220": { outcome: "3ds" },
  "5555555555554444": { outcome: "success" },
  "5105105105105100": { outcome: "decline", reason: "card_declined" },
  "378282246310005": { outcome: "success" },
  "371449635398431": { outcome: "decline", reason: "card_declined" },
} as const;

function normalizePan(pan: string | undefined): string {
  return String(pan || "").replace(/\s+/g, "");
}

function isValidLuhn(pan: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = pan.length - 1; i >= 0; i--) {
    let n = parseInt(pan.charAt(i), 10);
    if (Number.isNaN(n)) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function isExpiryValid(month: string | undefined, year: string | undefined): boolean {
  const m = parseInt(String(month), 10);
  let y = parseInt(String(year), 10);
  if (Number.isNaN(m) || Number.isNaN(y) || m < 1 || m > 12) return false;
  if (y < 100) y += 2000;
  const now = new Date();
  const exp = new Date(y, m, 0, 23, 59, 59);
  return exp >= now;
}

export type ProcessResult = {
  outcome: "authorized" | "captured" | "failed" | "3ds_required";
  paymentRef: string;
  authorizationCode?: string;
  threeDsChallengeUrl?: string;
  reason?: ErrorCode;
};

/**
 * Process a card payment in sandbox mode.
 * Returns outcome; caller must handle webhook/state update.
 * NEVER logs or stores PAN/CVV.
 * 
 * IMPORTANT: Only documented test cards are approved.
 * All other cards (even Luhn-valid) are declined with use_test_card.
 */
export function processCard(input: {
  pan?: string;
  expiryMonth?: string;
  expiryYear?: string;
  cvv?: string;
  captureNow?: boolean;
}): ProcessResult {
  const normalized = normalizePan(input.pan);
  const paymentRef = `pay_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const authCode = `AUTH${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  if (!/^\d{13,19}$/.test(normalized)) {
    return { outcome: "failed", paymentRef, reason: "invalid_card_number" };
  }
  
  if (!isValidLuhn(normalized)) {
    return { outcome: "failed", paymentRef, reason: "invalid_card_number" };
  }
  
  if (!isExpiryValid(input.expiryMonth, input.expiryYear)) {
    return { outcome: "failed", paymentRef, reason: "card_expired" };
  }
  
  if (!/^\d{3,4}$/.test(String(input.cvv || ""))) {
    return { outcome: "failed", paymentRef, reason: "invalid_cvv" };
  }

  const testCard = TEST_CARDS[normalized];
  
  if (!testCard) {
    return { 
      outcome: "failed", 
      paymentRef, 
      reason: "use_test_card" 
    };
  }

  if (testCard.outcome === "decline") {
    return { 
      outcome: "failed", 
      paymentRef, 
      reason: testCard.reason || "card_declined" 
    };
  }

  if (testCard.outcome === "3ds") {
    return {
      outcome: "3ds_required",
      paymentRef,
      authorizationCode: authCode,
      threeDsChallengeUrl: `/3ds-challenge/${paymentRef}`,
    };
  }

  const outcomeStatus = input.captureNow ? "captured" : "authorized";
  return { 
    outcome: outcomeStatus, 
    paymentRef, 
    authorizationCode: authCode 
  };
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signWebhookPayload(
  payload: string | object,
  secret: string,
  timestamp?: number
): Promise<string> {
  const ts = timestamp || Math.floor(Date.now() / 1000);
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signedPayload = `${ts}.${body}`;
  
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  return `t=${ts},v1=${toHex(sig)}`;
}

export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined | null,
  secret: string,
  toleranceSeconds: number = 300
): Promise<{ valid: boolean; reason?: string }> {
  if (!signature || !secret) {
    return { valid: false, reason: "missing_signature_or_secret" };
  }
  
  const parts = String(signature).split(",");
  const timestampPart = parts.find((p) => p.startsWith("t="));
  const signaturePart = parts.find((p) => p.startsWith("v1="));
  
  if (!timestampPart || !signaturePart) {
    const legacyMatch = signature.match(/^sha256=([a-f0-9]+)$/i);
    if (!legacyMatch) {
      return { valid: false, reason: "invalid_signature_format" };
    }
    const expected = await computeLegacySignature(rawBody, secret);
    const provided = legacyMatch[1].toLowerCase();
    if (!constantTimeEqual(expected, provided)) {
      return { valid: false, reason: "signature_mismatch" };
    }
    return { valid: true };
  }
  
  const timestamp = parseInt(timestampPart.slice(2), 10);
  const providedSig = signaturePart.slice(3).toLowerCase();
  
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { valid: false, reason: "timestamp_outside_tolerance" };
  }
  
  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = toHex(sig);
  
  if (!constantTimeEqual(expected, providedSig)) {
    return { valid: false, reason: "signature_mismatch" };
  }
  
  return { valid: true };
}

async function computeLegacySignature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return toHex(sig);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export class MockAcquirerAdapter implements AcquirerAdapter {
  async authorize(params: {
    amountCents: number;
    currency: string;
    cardToken?: string;
    orderId: string;
    merchantId: string;
  }): Promise<AcquirerResponse> {
    const ref = `auth_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    return {
      success: true,
      transactionRef: ref,
      authorizationCode: `AUTH${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    };
  }

  async capture(params: {
    authorizationRef: string;
    amountCents: number;
    orderId: string;
  }): Promise<AcquirerResponse> {
    return {
      success: true,
      transactionRef: `cap_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    };
  }

  async void(params: {
    authorizationRef: string;
    orderId: string;
  }): Promise<AcquirerResponse> {
    return {
      success: true,
      transactionRef: `void_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    };
  }

  async refund(params: {
    transactionRef: string;
    amountCents: number;
    orderId: string;
  }): Promise<AcquirerResponse> {
    return {
      success: true,
      transactionRef: `ref_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    };
  }
}
