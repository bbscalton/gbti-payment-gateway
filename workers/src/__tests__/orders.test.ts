import { describe, it, expect, beforeEach } from "vitest";
import { isValidTransition } from "../orders";

describe("Order State Machine", () => {
  describe("isValidTransition", () => {
    it("should allow pending -> authorized", () => {
      expect(isValidTransition("pending", "authorized")).toBe(true);
    });

    it("should allow pending -> captured (direct capture)", () => {
      expect(isValidTransition("pending", "captured")).toBe(true);
    });

    it("should allow pending -> failed", () => {
      expect(isValidTransition("pending", "failed")).toBe(true);
    });

    it("should allow authorized -> captured", () => {
      expect(isValidTransition("authorized", "captured")).toBe(true);
    });

    it("should allow authorized -> voided", () => {
      expect(isValidTransition("authorized", "voided")).toBe(true);
    });

    it("should allow authorized -> partially_captured", () => {
      expect(isValidTransition("authorized", "partially_captured")).toBe(true);
    });

    it("should allow captured -> refunded", () => {
      expect(isValidTransition("captured", "refunded")).toBe(true);
    });

    it("should allow captured -> partially_refunded", () => {
      expect(isValidTransition("captured", "partially_refunded")).toBe(true);
    });

    it("should allow captured -> disputed", () => {
      expect(isValidTransition("captured", "disputed")).toBe(true);
    });

    it("should allow partially_refunded -> refunded", () => {
      expect(isValidTransition("partially_refunded", "refunded")).toBe(true);
    });

    it("should allow partially_refunded -> disputed", () => {
      expect(isValidTransition("partially_refunded", "disputed")).toBe(true);
    });

    it("should allow disputed -> chargeback_won", () => {
      expect(isValidTransition("disputed", "chargeback_won")).toBe(true);
    });

    it("should allow disputed -> chargeback_lost", () => {
      expect(isValidTransition("disputed", "chargeback_lost")).toBe(true);
    });

    it("should NOT allow voided -> any state", () => {
      expect(isValidTransition("voided", "pending")).toBe(false);
      expect(isValidTransition("voided", "captured")).toBe(false);
      expect(isValidTransition("voided", "refunded")).toBe(false);
    });

    it("should NOT allow failed -> any state", () => {
      expect(isValidTransition("failed", "pending")).toBe(false);
      expect(isValidTransition("failed", "captured")).toBe(false);
      expect(isValidTransition("failed", "authorized")).toBe(false);
    });

    it("should NOT allow refunded -> any state", () => {
      expect(isValidTransition("refunded", "pending")).toBe(false);
      expect(isValidTransition("refunded", "captured")).toBe(false);
    });

    it("should NOT allow chargeback_won -> any state", () => {
      expect(isValidTransition("chargeback_won", "disputed")).toBe(false);
      expect(isValidTransition("chargeback_won", "refunded")).toBe(false);
    });

    it("should NOT allow chargeback_lost -> any state", () => {
      expect(isValidTransition("chargeback_lost", "disputed")).toBe(false);
      expect(isValidTransition("chargeback_lost", "captured")).toBe(false);
    });

    it("should NOT allow backwards transitions", () => {
      expect(isValidTransition("captured", "authorized")).toBe(false);
      expect(isValidTransition("captured", "pending")).toBe(false);
      expect(isValidTransition("authorized", "pending")).toBe(false);
      expect(isValidTransition("refunded", "captured")).toBe(false);
    });

    it("should NOT allow captured -> voided", () => {
      expect(isValidTransition("captured", "voided")).toBe(false);
    });
  });
});
