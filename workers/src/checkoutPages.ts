/**
 * Sapp — Hosted Checkout Pages
 * Card data entry with security headers and sandbox warning
 */

import type { Order } from "./types";

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatGyd(amountCents: number): string {
  return (amountCents / 100).toLocaleString("en-GY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function getSecurityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": 
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; " +
      "font-src 'self'; " +
      "connect-src 'self'; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self'",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

export function renderCheckoutPage(order: Order, publicBaseUrl: string): string {
  const amountGyd = formatGyd(order.amountCents);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sapp — Secure Checkout</title>
  <style>
    :root {
      --primary: #1a365d;
      --primary-deep: #0f2744;
      --accent: #38a169;
      --accent-light: #48bb78;
      --cream: #f7fafc;
      --muted: #718096;
      --error: #c53030;
      --warning-bg: #fed7d7;
      --warning-text: #742a2a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(160deg, var(--primary-deep) 0%, #1a4971 45%, #2a5a7a 100%);
      min-height: 100vh;
      color: #1a1a1a;
    }
    .wrap { max-width: 420px; margin: 0 auto; padding: 28px 16px 40px; }
    .sandbox-banner {
      background: var(--warning-bg);
      color: var(--warning-text);
      text-align: center;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 12px 16px;
      border-bottom: 2px solid #fc8181;
    }
    .sandbox-banner strong { display: block; font-size: 0.95rem; margin-bottom: 4px; }
    .brand { text-align: center; color: #fff; margin-bottom: 20px; }
    .brand .mark {
      display: inline-block; letter-spacing: 0.12em; font-size: 0.75rem;
      color: var(--accent); text-transform: uppercase; margin-bottom: 6px;
    }
    .brand h1 { margin: 0; font-size: 1.65rem; font-weight: 600; letter-spacing: 0.02em; }
    .brand p { margin: 8px 0 0; opacity: 0.85; font-size: 0.9rem; }
    .panel {
      background: var(--cream); border-radius: 8px; padding: 22px 20px 24px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.25); border-top: 4px solid var(--accent);
    }
    .summary {
      border-bottom: 1px solid #e2e8f0; padding-bottom: 14px; margin-bottom: 16px;
    }
    .summary .desc { color: var(--muted); font-size: 0.9rem; }
    .summary .amt { font-size: 1.55rem; color: var(--primary); font-weight: 700; margin-top: 4px; }
    .summary .amt span { font-size: 0.85rem; font-weight: 600; letter-spacing: 0.06em; }
    label {
      display: block; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--primary); margin: 12px 0 6px; font-weight: 600;
    }
    input {
      width: 100%; padding: 11px 12px; border: 1px solid #cbd5e0; border-radius: 4px;
      font-size: 1rem; background: #fff;
    }
    input:focus { outline: 2px solid var(--accent); border-color: var(--accent); }
    .row { display: flex; gap: 12px; }
    .row > div { flex: 1; }
    .hint {
      margin-top: 14px; font-size: 0.82rem; color: var(--muted);
      line-height: 1.5; background: #edf2f7; padding: 12px; border-radius: 4px;
    }
    .hint strong { color: var(--primary); }
    button[type=submit] {
      width: 100%; margin-top: 18px; padding: 14px; border: none; border-radius: 4px;
      background: var(--accent); color: #fff; font-size: 1rem; font-weight: 600;
      letter-spacing: 0.02em; cursor: pointer;
    }
    button[type=submit]:hover { background: var(--accent-light); }
    button[type=submit]:disabled { opacity: 0.6; cursor: wait; }
    .secure {
      text-align: center; margin-top: 14px; font-size: 0.75rem; color: var(--muted);
    }
    .secure svg { vertical-align: middle; margin-right: 4px; }
    .error {
      display: none; background: #fff5f5; color: var(--error); padding: 10px 12px;
      border-radius: 4px; font-size: 0.85rem; margin-bottom: 12px; border: 1px solid #feb2b2;
    }
  </style>
</head>
<body>
  <div class="sandbox-banner">
    <strong>⚠️ SANDBOX / TEST MODE</strong>
    This is not a real payment. Do NOT enter real card details.<br>
    Use test card: 4111 1111 1111 1111
  </div>
  <div class="wrap">
    <div class="brand">
      <div class="mark">Secure Payment Gateway</div>
      <h1>Sapp</h1>
      <p>Protected checkout</p>
    </div>
    <div class="panel">
      <div class="summary">
        <div class="desc">${escapeHtml(order.description)}</div>
        <div class="amt"><span>GYD</span> ${amountGyd}</div>
        <div class="desc" style="margin-top:6px">Order ${escapeHtml(order.id)}</div>
      </div>
      <div id="err" class="error"></div>
      <form id="payForm" method="POST" action="${escapeHtml(publicBaseUrl)}/mock-processor/charge" autocomplete="off">
        <input type="hidden" name="orderId" value="${escapeHtml(order.id)}" />
        <label for="pan">Card number</label>
        <input id="pan" name="pan" inputmode="numeric" maxlength="19" placeholder="4111 1111 1111 1111" required />
        <div class="row">
          <div>
            <label for="expiryMonth">Expiry MM</label>
            <input id="expiryMonth" name="expiryMonth" inputmode="numeric" maxlength="2" placeholder="12" required />
          </div>
          <div>
            <label for="expiryYear">Expiry YY</label>
            <input id="expiryYear" name="expiryYear" inputmode="numeric" maxlength="4" placeholder="28" required />
          </div>
          <div>
            <label for="cvv">CVV</label>
            <input id="cvv" name="cvv" inputmode="numeric" maxlength="4" placeholder="123" required />
          </div>
        </div>
        <div class="hint">
          <strong>Test cards only:</strong><br>
          Success: <code>4111 1111 1111 1111</code><br>
          Decline: <code>4000 0000 0000 0002</code><br>
          3DS Challenge: <code>4000 0000 0000 3220</code><br>
          Any future expiry (e.g. 12/28) and any 3-digit CVV.
        </div>
        <button type="submit" id="submitBtn">Pay GYD ${amountGyd}</button>
        <div class="secure">
          <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
            <path d="M10 5V4a4 4 0 0 0-8 0v1a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zM4 4a2 2 0 1 1 4 0v1H4V4z"/>
          </svg>
          TLS encrypted · Card data never stored
        </div>
      </form>
    </div>
  </div>
  <script>
    const form = document.getElementById('payForm');
    const err = document.getElementById('err');
    const btn = document.getElementById('submitBtn');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.style.display = 'none';
      btn.disabled = true;
      const fd = new FormData(form);
      try {
        const res = await fetch(form.action, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: new URLSearchParams(fd)
        });
        const data = await res.json();
        if (data.redirectUrl) {
          window.location.href = data.redirectUrl;
          return;
        }
        err.textContent = data.message || data.error?.message || 'Payment failed';
        err.style.display = 'block';
      } catch (ex) {
        err.textContent = 'Network error. Please try again.';
        err.style.display = 'block';
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export function renderResultPage(order: Order, success: boolean): string {
  const amountGyd = formatGyd(order.amountCents);
  const title = success ? "Payment successful" : "Payment failed";
  const color = success ? "#38a169" : "#c53030";
  const icon = success 
    ? '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — Sapp</title>
  <style>
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(160deg, #0f2744, #1a4971);
      color: #fff; text-align: center; padding: 24px;
    }
    .card {
      background: #f7fafc; color: #1a1a1a; padding: 32px 28px; border-radius: 8px;
      max-width: 400px; width: 100%; border-top: 4px solid ${color};
      box-shadow: 0 12px 40px rgba(0,0,0,0.25);
    }
    .icon { color: ${color}; margin-bottom: 12px; }
    h1 { color: ${color}; font-size: 1.35rem; margin: 0 0 8px; }
    p { color: #718096; margin: 8px 0; font-size: 0.95rem; }
    .amt { font-size: 1.4rem; color: #1a365d; font-weight: 700; margin: 16px 0; }
    .note { font-size: 0.8rem; color: #a0aec0; margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
    .brand { letter-spacing: 0.08em; font-size: 0.7rem; color: #38a169; text-transform: uppercase; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">Sapp</div>
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <div class="amt">GYD ${amountGyd}</div>
    <p>Order ${escapeHtml(order.id)}</p>
    <p>${success ? "You may return to the merchant app." : "Please try another card or contact support."}</p>
    <p class="note">
      ${success ? "Payment confirmed via signed webhook." : ""}
      This is a sandbox environment — no real funds were transferred.
    </p>
  </div>
</body>
</html>`;
}

export function render3dsChallengePage(order: Order, paymentRef: string, publicBaseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>3-D Secure Challenge — Sapp</title>
  <style>
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(160deg, #0f2744, #1a4971);
      color: #fff; text-align: center; padding: 24px;
    }
    .card {
      background: #f7fafc; color: #1a1a1a; padding: 32px 28px; border-radius: 8px;
      max-width: 400px; width: 100%;
      box-shadow: 0 12px 40px rgba(0,0,0,0.25);
    }
    h1 { color: #1a365d; font-size: 1.2rem; margin: 0 0 16px; }
    p { color: #718096; margin: 12px 0; font-size: 0.95rem; }
    .code { font-size: 2rem; font-weight: 700; color: #1a365d; letter-spacing: 0.2em; margin: 20px 0; }
    input {
      width: 100%; padding: 12px; font-size: 1.2rem; text-align: center;
      border: 2px solid #cbd5e0; border-radius: 4px; margin-bottom: 16px;
    }
    button {
      width: 100%; padding: 14px; border: none; border-radius: 4px;
      background: #38a169; color: #fff; font-size: 1rem; font-weight: 600; cursor: pointer;
    }
    button:hover { background: #48bb78; }
    .note { font-size: 0.8rem; color: #a0aec0; margin-top: 20px; }
    .brand { letter-spacing: 0.08em; font-size: 0.7rem; color: #38a169; text-transform: uppercase; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">3-D Secure Challenge</div>
    <h1>Verify Your Identity</h1>
    <p>Enter the code sent to your registered phone/email:</p>
    <div class="code">123456</div>
    <p style="font-size: 0.85rem; color: #a0aec0;">(Sandbox: Enter any 6-digit code to proceed)</p>
    <form method="POST" action="${escapeHtml(publicBaseUrl)}/3ds-complete">
      <input type="hidden" name="paymentRef" value="${escapeHtml(paymentRef)}" />
      <input type="hidden" name="orderId" value="${escapeHtml(order.id)}" />
      <input type="text" name="code" maxlength="6" placeholder="Enter code" required />
      <button type="submit">Verify</button>
    </form>
    <p class="note">This is a simulated 3-D Secure challenge for sandbox testing.</p>
  </div>
</body>
</html>`;
}
