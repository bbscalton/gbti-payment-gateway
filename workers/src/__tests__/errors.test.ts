import { describe, it, expect } from "vitest";
import { createError, ERROR_MESSAGES, HTTP_STATUS } from "../errors";

describe("Error Codes", () => {
  it("should have messages for all error codes", () => {
    const errorCodes = Object.keys(HTTP_STATUS);
    for (const code of errorCodes) {
      expect(ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES]).toBeDefined();
      expect(ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES].length).toBeGreaterThan(0);
    }
  });

  it("should have HTTP status for all error codes", () => {
    const errorCodes = Object.keys(ERROR_MESSAGES);
    for (const code of errorCodes) {
      expect(HTTP_STATUS[code as keyof typeof HTTP_STATUS]).toBeDefined();
      expect(HTTP_STATUS[code as keyof typeof HTTP_STATUS]).toBeGreaterThanOrEqual(400);
    }
  });

  it("should create proper error objects", () => {
    const error = createError("card_declined");
    expect(error.error.code).toBe("card_declined");
    expect(error.error.message).toBe(ERROR_MESSAGES.card_declined);
  });

  it("should allow custom messages", () => {
    const error = createError("invalid_request", "Custom message");
    expect(error.error.code).toBe("invalid_request");
    expect(error.error.message).toBe("Custom message");
  });

  it("should allow additional details", () => {
    const error = createError("rate_limited", undefined, { retryAfter: 60 });
    expect(error.error.details).toEqual({ retryAfter: 60 });
  });

  it("should use correct HTTP status codes", () => {
    expect(HTTP_STATUS.authentication_required).toBe(401);
    expect(HTTP_STATUS.invalid_api_key).toBe(401);
    expect(HTTP_STATUS.forbidden).toBe(403);
    expect(HTTP_STATUS.not_found).toBe(404);
    expect(HTTP_STATUS.rate_limited).toBe(429);
    expect(HTTP_STATUS.card_declined).toBe(402);
    expect(HTTP_STATUS.internal_error).toBe(500);
  });

  it("should have use_test_card error", () => {
    expect(ERROR_MESSAGES.use_test_card).toBeDefined();
    expect(HTTP_STATUS.use_test_card).toBe(400);
  });
});
