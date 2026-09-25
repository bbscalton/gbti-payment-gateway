/**
 * Optional Firestore mirror via REST + service-account JWT.
 * Stores ONLY order metadata — never PAN/CVV/expiry.
 *
 * Requires secrets: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * If any are missing, mirroring is a no-op (KV remains source of truth).
 */

import type { Env, Order } from "./types";

type TokenCache = { accessToken: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64Url(data: ArrayBuffer | string): string {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(env: Env): Promise<string | null> {
  const email = env.FIREBASE_CLIENT_EMAIL;
  const keyPem = env.FIREBASE_PRIVATE_KEY;
  if (!email || !keyPem) return null;

  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 60) {
    return tokenCache.accessToken;
  }

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: email,
      sub: email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/datastore",
    }),
  );
  const unsigned = `${header}.${claim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(keyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64Url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    console.error("[firestore] token exchange failed", res.status);
    return null;
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: json.access_token,
    expiresAt: now + (json.expires_in || 3600),
  };
  return json.access_token;
}

function orderToFirestoreFields(order: Order): Record<string, unknown> {
  return {
    fields: {
      id: { stringValue: order.id },
      amountCents: { integerValue: String(order.amountCents) },
      currency: { stringValue: order.currency },
      status: { stringValue: order.status },
      paymentRef: order.paymentRef
        ? { stringValue: order.paymentRef }
        : { nullValue: null },
      description: { stringValue: order.description },
      createdAt: { stringValue: order.createdAt },
      updatedAt: { stringValue: order.updatedAt },
    },
  };
}

/** Mirror order to Firestore `orders/{id}`. Never writes card data. */
export async function mirrorOrderToFirestore(
  env: Env,
  order: Order,
): Promise<void> {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) return;

  try {
    const token = await getAccessToken(env);
    if (!token) return;

    const url =
      `https://firestore.googleapis.com/v1/projects/${projectId}` +
      `/databases/(default)/documents/orders/${encodeURIComponent(order.id)}`;

    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderToFirestoreFields(order)),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[firestore] mirror failed", res.status, text.slice(0, 200));
    }
  } catch (err) {
    console.error("[firestore] mirror error", err);
  }
}

export function firestoreConfigured(env: Env): boolean {
  return Boolean(
    env.FIREBASE_PROJECT_ID &&
      env.FIREBASE_CLIENT_EMAIL &&
      env.FIREBASE_PRIVATE_KEY,
  );
}
