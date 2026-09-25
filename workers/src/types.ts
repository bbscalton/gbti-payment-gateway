/** Order fields only — never PAN, CVV, or expiry. */
export type OrderStatus = "pending" | "paid" | "failed" | "refunded";

export interface Order {
  id: string;
  amountCents: number;
  currency: string;
  description: string;
  status: OrderStatus;
  paymentRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Env {
  ORDERS: KVNamespace;
  WEBHOOK_SECRET: string;
  /** Optional absolute public base URL; falls back to request origin. */
  PUBLIC_BASE_URL?: string;
  /** Optional Firestore mirror (Admin REST via service account JWT). */
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
}
