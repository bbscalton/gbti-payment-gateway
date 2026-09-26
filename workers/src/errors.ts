/**
 * Sapp — Error Code Catalogue
 * Standardized error responses with machine-readable codes
 */

import type { ApiError, ErrorCode } from "./types";

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  invalid_request: "The request was invalid or malformed",
  authentication_required: "Authentication is required for this endpoint",
  invalid_api_key: "The provided API key is invalid or expired",
  forbidden: "You do not have permission to access this resource",
  not_found: "The requested resource was not found",
  order_not_found: "The specified order was not found",
  merchant_not_found: "The specified merchant was not found",
  idempotency_conflict: "A different request was already made with this idempotency key",
  rate_limited: "Too many requests. Please retry after the specified time",
  invalid_card_number: "The card number is invalid",
  card_expired: "The card has expired",
  invalid_cvv: "The CVV/CVC is invalid",
  card_declined: "The card was declined by the issuer",
  insufficient_funds: "The card has insufficient funds",
  do_not_honor: "The card was declined. Contact your bank for details",
  "3ds_required": "3-D Secure authentication is required",
  "3ds_failed": "3-D Secure authentication failed",
  invalid_amount: "The amount is invalid or out of range",
  invalid_currency: "Only GYD currency is supported",
  invalid_state_transition: "This operation is not allowed in the current order state",
  refund_exceeds_captured: "Refund amount exceeds the captured amount",
  capture_exceeds_authorized: "Capture amount exceeds the authorized amount",
  webhook_secret_missing: "Webhook secret is not configured",
  webhook_signature_invalid: "The webhook signature is invalid",
  webhook_replay_detected: "This webhook event has already been processed",
  internal_error: "An internal error occurred. Please try again later",
  use_test_card: "This is a sandbox environment. Please use a test card number",
};

export function createError(
  code: ErrorCode,
  message?: string,
  details?: Record<string, unknown>
): ApiError {
  return {
    error: {
      code,
      message: message || ERROR_MESSAGES[code],
      ...(details && { details }),
    },
  };
}

export function errorResponse(
  code: ErrorCode,
  status: number,
  message?: string,
  details?: Record<string, unknown>
): { body: ApiError; status: number } {
  return {
    body: createError(code, message, details),
    status,
  };
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  authentication_required: 401,
  invalid_api_key: 401,
  forbidden: 403,
  not_found: 404,
  order_not_found: 404,
  merchant_not_found: 404,
  idempotency_conflict: 409,
  rate_limited: 429,
  invalid_card_number: 400,
  card_expired: 400,
  invalid_cvv: 400,
  card_declined: 402,
  insufficient_funds: 402,
  do_not_honor: 402,
  "3ds_required": 402,
  "3ds_failed": 402,
  invalid_amount: 400,
  invalid_currency: 400,
  invalid_state_transition: 409,
  refund_exceeds_captured: 400,
  capture_exceeds_authorized: 400,
  webhook_secret_missing: 500,
  webhook_signature_invalid: 401,
  webhook_replay_detected: 409,
  internal_error: 500,
  use_test_card: 400,
};
