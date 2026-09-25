/**
 * In-memory + JSON-file order store for the GBTI sandbox demo.
 * Does NOT store card numbers, expiry, or CVV.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "orders.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ orders: {} }, null, 2));
  }
}

function readAll() {
  ensureStore();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

function writeAll(data) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function createOrder({ amountCents, currency, description }) {
  const data = readAll();
  const id = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const order = {
    id,
    amountCents,
    currency,
    description: description || "GBT I payment",
    status: "pending",
    paymentRef: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  data.orders[id] = order;
  writeAll(data);
  return order;
}

function getOrder(id) {
  const data = readAll();
  return data.orders[id] || null;
}

function updateOrder(id, patch) {
  const data = readAll();
  const order = data.orders[id];
  if (!order) return null;
  Object.assign(order, patch, { updatedAt: new Date().toISOString() });
  data.orders[id] = order;
  writeAll(data);
  return order;
}

function listOrders() {
  const data = readAll();
  return Object.values(data.orders).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}

module.exports = {
  createOrder,
  getOrder,
  updateOrder,
  listOrders,
};
