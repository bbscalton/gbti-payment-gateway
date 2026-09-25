/**
 * Mock GBTI acquirer / card processor.
 * Card data is validated in-memory only and NEVER persisted.
 */

/** Test PANs — sandbox only. Never use real cards in this flow. */
export const TEST_CARDS = {
  SUCCESS: "4111111111111111",
  DECLINE: "4000000000000002",
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
  outcome: "paid" | "failed";
  paymentRef: string;
  reason?: string;
};

/**
 * Process a card payment. Returns outcome; caller must fire webhook.
 * Never logs or stores PAN/CVV.
 */
export function processCard(input: {
  pan?: string;
  expiryMonth?: string;
  expiryYear?: string;
  cvv?: string;
}): ProcessResult {
  const normalized = normalizePan(input.pan);
  const paymentRef = `pay_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  if (!/^\d{13,19}$/.test(normalized) || !isValidLuhn(normalized)) {
    return { outcome: "failed", paymentRef, reason: "invalid_card_number" };
  }
  if (!isExpiryValid(input.expiryMonth, input.expiryYear)) {
    return { outcome: "failed", paymentRef, reason: "card_expired" };
  }
  if (!/^\d{3,4}$/.test(String(input.cvv || ""))) {
    return { outcome: "failed", paymentRef, reason: "invalid_cvv" };
  }

  if (normalized === TEST_CARDS.DECLINE) {
    return { outcome: "failed", paymentRef, reason: "card_declined" };
  }

  if (normalized === TEST_CARDS.SUCCESS || normalized.startsWith("41")) {
    return { outcome: "paid", paymentRef };
  }

  return { outcome: "paid", paymentRef };
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signWebhookPayload(
  payload: string | object,
  secret: string,
): Promise<string> {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return toHex(sig);
}

export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) return false;
  const expected = await signWebhookPayload(rawBody, secret);
  const provided = String(signature).replace(/^sha256=/, "").toLowerCase();
  if (expected.length !== provided.length) return false;
  // Constant-time-ish compare
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}
