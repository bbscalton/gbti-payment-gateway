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

export function renderCheckoutPage(order: Order, publicBaseUrl: string): string {
  const amountGyd = formatGyd(order.amountCents);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GBTI Secure Checkout</title>
  <style>
    :root {
      --gbti-navy: #0b3d5c;
      --gbti-navy-deep: #072a40;
      --gbti-gold: #c9a227;
      --gbti-cream: #f7f5f0;
      --gbti-muted: #5a6b75;
      --gbti-error: #9b2c2c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Georgia, "Times New Roman", serif;
      background: linear-gradient(160deg, var(--gbti-navy-deep) 0%, #0e4a6b 45%, #1a5f7a 100%);
      min-height: 100vh;
      color: #1a1a1a;
    }
    .wrap { max-width: 420px; margin: 0 auto; padding: 28px 16px 40px; }
    .brand { text-align: center; color: #fff; margin-bottom: 20px; }
    .brand .mark {
      display: inline-block; letter-spacing: 0.28em; font-size: 0.75rem;
      color: var(--gbti-gold); text-transform: uppercase; margin-bottom: 6px;
    }
    .brand h1 { margin: 0; font-size: 1.65rem; font-weight: 600; letter-spacing: 0.04em; }
    .brand p { margin: 8px 0 0; opacity: 0.85; font-size: 0.9rem; font-family: "Segoe UI", sans-serif; }
    .panel {
      background: var(--gbti-cream); border-radius: 4px; padding: 22px 20px 24px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.25); border-top: 3px solid var(--gbti-gold);
    }
    .summary {
      border-bottom: 1px solid #ddd5c5; padding-bottom: 14px; margin-bottom: 16px;
      font-family: "Segoe UI", sans-serif;
    }
    .summary .desc { color: var(--gbti-muted); font-size: 0.9rem; }
    .summary .amt { font-size: 1.55rem; color: var(--gbti-navy); font-weight: 700; margin-top: 4px; }
    .summary .amt span { font-size: 0.85rem; font-weight: 600; letter-spacing: 0.06em; }
    label {
      display: block; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--gbti-navy); margin: 12px 0 6px; font-family: "Segoe UI", sans-serif; font-weight: 600;
    }
    input {
      width: 100%; padding: 11px 12px; border: 1px solid #c9c2b4; border-radius: 3px;
      font-size: 1rem; font-family: "Segoe UI", sans-serif; background: #fff;
    }
    input:focus { outline: 2px solid var(--gbti-gold); border-color: var(--gbti-gold); }
    .row { display: flex; gap: 12px; }
    .row > div { flex: 1; }
    .hint {
      margin-top: 14px; font-size: 0.78rem; color: var(--gbti-muted);
      font-family: "Segoe UI", sans-serif; line-height: 1.4;
    }
    button[type=submit] {
      width: 100%; margin-top: 18px; padding: 14px; border: none; border-radius: 3px;
      background: var(--gbti-navy); color: #fff; font-size: 1rem; font-weight: 600;
      letter-spacing: 0.04em; cursor: pointer; font-family: "Segoe UI", sans-serif;
    }
    button[type=submit]:hover { background: var(--gbti-navy-deep); }
    button[type=submit]:disabled { opacity: 0.6; cursor: wait; }
    .secure {
      text-align: center; margin-top: 14px; font-size: 0.75rem; color: var(--gbti-muted);
      font-family: "Segoe UI", sans-serif;
    }
    .error {
      display: none; background: #fde8e8; color: var(--gbti-error); padding: 10px 12px;
      border-radius: 3px; font-size: 0.85rem; margin-bottom: 12px; font-family: "Segoe UI", sans-serif;
    }
    .sandbox-banner {
      background: rgba(201, 162, 39, 0.2); color: #fff; text-align: center; font-size: 0.72rem;
      letter-spacing: 0.08em; text-transform: uppercase; padding: 8px; font-family: "Segoe UI", sans-serif;
    }
  </style>
</head>
<body>
  <div class="sandbox-banner">GBTI Sandbox Hosted Checkout — Card data never stored by merchant</div>
  <div class="wrap">
    <div class="brand">
      <div class="mark">Secure merchant payments · Guyana</div>
      <h1>GBTI Bank</h1>
      <p>Secure card payment</p>
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
        <p class="hint">Test success: 4111 1111 1111 1111 · Decline: 4000 0000 0000 0002. Card fields post only to the mock acquirer — not to the merchant app or API.</p>
        <button type="submit" id="submitBtn">Pay GYD ${amountGyd}</button>
        <div class="secure">TLS · Hosted fields · PCI-aligned demo pattern</div>
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
        err.textContent = data.message || 'Payment failed';
        err.style.display = 'block';
      } catch (ex) {
        err.textContent = 'Network error. Is the sandbox gateway reachable?';
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
  const color = success ? "#1f6f4a" : "#9b2c2c";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — GBTI</title>
  <style>
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: "Segoe UI", Georgia, serif;
      background: linear-gradient(160deg, #072a40, #0e4a6b);
      color: #fff; text-align: center; padding: 24px;
    }
    .card {
      background: #f7f5f0; color: #1a1a1a; padding: 28px 24px; border-radius: 4px;
      max-width: 380px; width: 100%; border-top: 3px solid #c9a227;
    }
    h1 { color: ${color}; font-size: 1.35rem; margin: 0 0 8px; }
    p { color: #5a6b75; margin: 8px 0; font-size: 0.95rem; }
    .amt { font-size: 1.4rem; color: #0b3d5c; font-weight: 700; }
  </style>
</head>
<body>
  <div class="card">
    <div style="letter-spacing:0.2em;font-size:0.7rem;color:#c9a227;text-transform:uppercase;margin-bottom:10px">GBTI Bank</div>
    <h1>${title}</h1>
    <div class="amt">GYD ${amountGyd}</div>
    <p>Order ${escapeHtml(order.id)}</p>
    <p>${success ? "You may return to the merchant app." : "Please try another card or contact support."}</p>
    <p style="font-size:0.75rem;margin-top:16px">Status is confirmed by signed webhook — not by this page alone.</p>
  </div>
</body>
</html>`;
}
