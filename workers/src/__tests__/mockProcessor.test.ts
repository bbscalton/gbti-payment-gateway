import { describe, it, expect } from "vitest";
import { 
  processCard, 
  TEST_CARDS, 
  signWebhookPayload, 
  verifyWebhookSignature 
} from "../mockProcessor";

describe("Mock Processor - Test Card Rules", () => {
  it("should approve the success test card 4111111111111111", () => {
    const result = processCard({
      pan: "4111111111111111",
      expiryMonth: "12",
      expiryYear: "28",
      cvv: "123",
      captureNow: true,
    });
    expect(result.outcome).toBe("captured");
    expect(result.paymentRef).toMatch(/^pay_/);
  });

  it("should authorize (not capture) when captureNow is false", () => {
    const result = processCard({
      pan: "4111111111111111",
      expiryMonth: "12",
      expiryYear: "28",
      cvv: "123",
      captureNow: false,
    });
    expect(result.outcome).toBe("authorized");
  });

  it("should decline the decline test card 4000000000000002", () => {
    const result = processCard({
      pan: "4000000000000002",
      expiryMonth: "12",
      expiryYear: "28",
      cvv: "123",
    });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("card_declined");
  });

  it("should decline insufficient funds test card", () => {
    const result = processCard({
      pan: "4000000000000010",
      expiryMonth: "12",
      expiryYear: "28",
      cvv: "123",
    });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("insufficient_funds");
  });

  it("should require 3DS for the 3DS test card", () => {
    const result = processCard({
      pan: "4000000000003220",
      expiryMonth: "12",
      expiryYear: "28",
      cvv: "123",
    });
    expect(result.outcome).toBe("3ds_required");
    expect(result.threeDsChallengeUrl).toBeDefined();
  });

  it("should REJECT unknown Luhn-valid card numbers with use_test_card", () => {
    const result = processCard({
      pan: "4532015112830366",
      expiryMonth: "12",
      expiryYear: "28",
      cvv: "123",
    });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("use_test_card");
  });

  it("should REJECT any random valid-looking card", () => {
    const result = processCard({
      pan: "5425233430109903",
      expiryMonth: "12",
      expiryYear: "28",
      cvv: "123",
    });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("use_test_card");
  });

  it("should reject invalid card numbers", () => {
    const result = processCard({
      pan: "1234567890123456",
      expiryMonth: "12",
      expiryYear: "28",
      cvv: "123",
    });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("invalid_card_number");
  });

  it("should reject expired cards", () => {
    const result = processCard({
      pan: "4111111111111111",
      expiryMonth: "01",
      expiryYear: "20",
      cvv: "123",
    });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("card_expired");
  });

  it("should reject invalid CVV", () => {
    const result = processCard({
      pan: "4111111111111111",
      expiryMonth: "12",
      expiryYear: "28",
      cvv: "12",
    });
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("invalid_cvv");
  });

  it("should handle spaces in PAN", () => {
    const result = processCard({
      pan: "4111 1111 1111 1111",
      expiryMonth: "12",
      expiryYear: "28",
      cvv: "123",
      captureNow: true,
    });
    expect(result.outcome).toBe("captured");
  });

  it("should support all documented test cards", () => {
    const testCardNumbers = Object.keys(TEST_CARDS);
    expect(testCardNumbers.length).toBeGreaterThan(5);
    
    for (const cardNumber of testCardNumbers) {
      const result = processCard({
        pan: cardNumber,
        expiryMonth: "12",
        expiryYear: "30",
        cvv: "123",
        captureNow: true,
      });
      
      const expected = TEST_CARDS[cardNumber];
      if (expected.outcome === "success") {
        expect(result.outcome).toBe("captured");
      } else if (expected.outcome === "decline") {
        expect(result.outcome).toBe("failed");
        expect(result.reason).toBe(expected.reason);
      } else if (expected.outcome === "3ds") {
        expect(result.outcome).toBe("3ds_required");
      }
    }
  });
});

describe("Webhook Signature - New Format", () => {
  const testSecret = "whsec_test_secret_12345";
  const testPayload = JSON.stringify({ orderId: "ord_123", status: "captured" });

  it("should sign payloads with timestamp", async () => {
    const signature = await signWebhookPayload(testPayload, testSecret);
    expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
  });

  it("should verify valid signatures", async () => {
    const signature = await signWebhookPayload(testPayload, testSecret);
    const result = await verifyWebhookSignature(testPayload, signature, testSecret);
    expect(result.valid).toBe(true);
  });

  it("should reject signatures with wrong secret", async () => {
    const signature = await signWebhookPayload(testPayload, testSecret);
    const result = await verifyWebhookSignature(testPayload, signature, "wrong_secret");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("signature_mismatch");
  });

  it("should reject modified payloads", async () => {
    const signature = await signWebhookPayload(testPayload, testSecret);
    const modifiedPayload = JSON.stringify({ orderId: "ord_456", status: "captured" });
    const result = await verifyWebhookSignature(modifiedPayload, signature, testSecret);
    expect(result.valid).toBe(false);
  });

  it("should reject expired timestamps", async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
    const signature = await signWebhookPayload(testPayload, testSecret, oldTimestamp);
    const result = await verifyWebhookSignature(testPayload, signature, testSecret, 300);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("timestamp_outside_tolerance");
  });

  it("should accept timestamps within tolerance", async () => {
    const recentTimestamp = Math.floor(Date.now() / 1000) - 100;
    const signature = await signWebhookPayload(testPayload, testSecret, recentTimestamp);
    const result = await verifyWebhookSignature(testPayload, signature, testSecret, 300);
    expect(result.valid).toBe(true);
  });

  it("should reject missing signatures", async () => {
    const result = await verifyWebhookSignature(testPayload, undefined, testSecret);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("missing_signature_or_secret");
  });

  it("should reject invalid signature format", async () => {
    const result = await verifyWebhookSignature(testPayload, "invalid_format", testSecret);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_signature_format");
  });
});

describe("Webhook Signature - Legacy Format", () => {
  const testSecret = "test_secret";
  const testPayload = JSON.stringify({ orderId: "ord_123" });

  it("should still accept legacy sha256= format for backwards compatibility", async () => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(testSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(testPayload));
    const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
    const legacySignature = `sha256=${hex}`;
    
    const result = await verifyWebhookSignature(testPayload, legacySignature, testSecret);
    expect(result.valid).toBe(true);
  });
});
