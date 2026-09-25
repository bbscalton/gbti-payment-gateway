/**
 * Mock GBTI acquirer / card processor.
 * Card data is validated in-memory only and NEVER persisted.
 * Results are delivered via signed webhook to our merchant backend.
 */

const crypto = require("crypto");

/** Test PANs — sandbox only. Never use real cards in this flow. */
const TEST_CARDS = {
  SUCCESS: "4111111111111111",
  DECLINE: "4000000000000002",
};

function normalizePan(pan) {
  return String(pan || "").replace(/\s+/g, "");
}

function isValidLuhn(pan) {
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

function isExpiryValid(month, year) {
  const m = parseInt(month, 10);
  let y = parseInt(year, 10);
  if (Number.isNaN(m) || Number.isNaN(y) || m < 1 || m > 12) return false;
  if (y < 100) y += 2000;
  const now = new Date();
  const exp = new Date(y, m, 0, 23, 59, 59);
  return exp >= now;
}

/**
 * Process a card payment. Returns outcome; caller must fire webhook.
 * @returns {{ outcome: 'paid'|'failed', paymentRef: string, reason?: string }}
 */
function processCard({ pan, expiryMonth, expiryYear, cvv }) {
  const normalized = normalizePan(pan);
  const paymentRef = `pay_${crypto.randomBytes(8).toString("hex")}`;

  // Basic format checks — still never store PAN
  if (!/^\d{13,19}$/.test(normalized) || !isValidLuhn(normalized)) {
    return { outcome: "failed", paymentRef, reason: "invalid_card_number" };
  }
  if (!isExpiryValid(expiryMonth, expiryYear)) {
    return { outcome: "failed", paymentRef, reason: "card_expired" };
  }
  if (!/^\d{3,4}$/.test(String(cvv || ""))) {
    return { outcome: "failed", paymentRef, reason: "invalid_cvv" };
  }

  if (normalized === TEST_CARDS.DECLINE) {
    return { outcome: "failed", paymentRef, reason: "card_declined" };
  }

  // Success for known good test card, or any other Luhn-valid sandbox PAN
  if (normalized === TEST_CARDS.SUCCESS || normalized.startsWith("41")) {
    return { outcome: "paid", paymentRef };
  }

  // Other brands in sandbox: accept Visa-like success pattern only for demo
  return { outcome: "paid", paymentRef };
}

function signWebhookPayload(payload, secret) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = signWebhookPayload(rawBody, secret);
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(String(signature).replace(/^sha256=/, ""), "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = {
  TEST_CARDS,
  processCard,
  signWebhookPayload,
  verifyWebhookSignature,
};
