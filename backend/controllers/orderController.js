import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getMenuItemsByIds } from '../services/menuService.js';
import { getRuntimeState } from '../services/restaurantService.js';
import { findPendingOrderDraft, savePendingOrderDraft } from '../services/pendingOrderService.js';
import { assertWithinDeliveryZone } from '../utils/deliveryZone.js';
import { assertRestaurantAcceptingOrders } from '../utils/restaurantStatus.js';
import {
  cancelOrderWithRefund,
  assignDeliveryPartner,
  closeActiveTableOrders,
  createDeliveryPerson,
  createCounterTableOrder as createCounterTableOrderRecord,
  deactivateDeliveryPerson,
  createRazorpayOrder,
  fetchRazorpayPayment,
  findLatestOrderByPhone,
  getAllOrders,
  getDeliveryPeople,
  getKitchenOrders,
  getOrderById,
  getReadyCount,
  generateDailyOrderCode,
  persistPaidOrder,
  updateOrderStatus,
  verifyPaymentSignature,
} from '../services/orderService.js';

const createOrderTrackingToken = (orderId) =>
  jwt.sign(
    {
      scope: 'order-tracking',
      orderId,
    },
    env.jwtSecret,
    { expiresIn: '30d' },
  );

const assertValidOrderTrackingToken = (orderId, trackingToken) => {
  try {
    const payload = jwt.verify(trackingToken, env.jwtSecret);
    if (payload.scope !== 'order-tracking' || payload.orderId !== orderId) {
      throw new Error('Order tracking token mismatch');
    }
  } catch {
    const error = new Error('Invalid order tracking token');
    error.statusCode = 401;
    throw error;
  }
};

const buildCanonicalOrderDraft = async (payload) => {
  const resolvedOrderCode = String(payload.orderCode || '').trim() || (await generateDailyOrderCode());

  const itemIds = [...new Set((payload.items || []).map((item) => item.id))];
  const menuItems = await getMenuItemsByIds(itemIds);
  const menuItemMap = new Map(menuItems.map((item) => [String(item.id), item]));

  const items = (payload.items || []).map((item) => {
    const menuItem = menuItemMap.get(String(item.id));
    if (!menuItem) {
      const error = new Error(`Menu item not found: ${item.id}`);
      error.statusCode = 400;
      throw error;
    }

    if (!menuItem.is_available) {
      const error = new Error(`${menuItem.name} is currently unavailable`);
      error.statusCode = 409;
      throw error;
    }

    return {
      id: String(menuItem.id),
      name: menuItem.name,
      price: Number(menuItem.price),
      quantity: Number(item.quantity),
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryCharge = payload.orderType === 'delivery' && !env.freeDeliveryEnabled ? 30 : 0;
  const total = subtotal + deliveryCharge;

  if (payload.orderType === 'dine-in' && !payload.tableNumber) {
    const error = new Error('Table number is required for dine-in orders');
    error.statusCode = 400;
    throw error;
  }

  if (payload.orderType === 'delivery' && !String(payload.deliveryAddress || '').trim()) {
    const error = new Error('Delivery address is required for delivery orders');
    error.statusCode = 400;
    throw error;
  }

  return {
    receipt: payload.receipt || resolvedOrderCode,
    orderCode: resolvedOrderCode,
    orderType: payload.orderType,
    customerName: String(payload.customerName || '').trim(),
    customerPhone: String(payload.customerPhone || '').trim(),
    tableNumber: payload.orderType === 'dine-in' ? payload.tableNumber : null,
    deliveryAddress: payload.orderType === 'delivery' ? String(payload.deliveryAddress || '').trim() : '',
    deliveryLatitude: payload.orderType === 'delivery' ? payload.deliveryLatitude : null,
    deliveryLongitude: payload.orderType === 'delivery' ? payload.deliveryLongitude : null,
    items,
    subtotal,
    deliveryCharge,
    total,
  };
};

const assertDeliveryEligibility = (payload) => {
  if (payload.orderType !== 'delivery') return;

  assertWithinDeliveryZone({
    customerLocation: {
      latitude: payload.deliveryLatitude,
      longitude: payload.deliveryLongitude,
    },
    restaurantLocation: env.restaurantLocation,
    radiusKm: env.deliveryRadiusKm,
  });
};

export const createOrder = async (req, res) => {
  assertRestaurantAcceptingOrders(await getRuntimeState());
  const canonicalDraft = await buildCanonicalOrderDraft(req.body);
  assertDeliveryEligibility(canonicalDraft);

  const order = await createRazorpayOrder({
    amount: canonicalDraft.total * 100,
    receipt: canonicalDraft.receipt,
  });

  await savePendingOrderDraft({
    razorpayOrderId: order.id,
    amount: order.amount,
    receipt: canonicalDraft.receipt,
    draft: canonicalDraft,
  });

  res.json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: env.razorpayKeyId,
  });
};

export const verifyPayment = async (req, res) => {
  assertRestaurantAcceptingOrders(await getRuntimeState());
  const valid = verifyPaymentSignature({
    orderId: req.body.razorpayOrderId,
    paymentId: req.body.razorpayPaymentId,
    signature: req.body.razorpaySignature,
    secret: env.razorpayKeySecret,
  });

  if (!valid) {
    return res.status(400).json({ message: 'Payment verification failed' });
  }

  const draftRecord = await findPendingOrderDraft(req.body.razorpayOrderId);
  if (!draftRecord?.draft) {
    return res.status(409).json({ message: 'Pending order draft not found for this payment' });
  }

  const canonicalOrder = draftRecord.draft;
  assertDeliveryEligibility(canonicalOrder);

  const payment = await fetchRazorpayPayment(req.body.razorpayPaymentId);
  if (payment.order_id !== req.body.razorpayOrderId) {
    return res.status(400).json({ message: 'Payment order mismatch' });
  }

  if (payment.status !== 'captured' && payment.status !== 'authorized') {
    return res.status(400).json({ message: 'Payment is not captured yet' });
  }

  if (Number(payment.amount) !== Math.round(Number(canonicalOrder.total) * 100)) {
    return res.status(400).json({ message: 'Payment amount mismatch' });
  }

  const order = await persistPaidOrder({
    orderCode: canonicalOrder.orderCode,
    orderType: canonicalOrder.orderType,
    customerName: canonicalOrder.customerName,
    customerPhone: canonicalOrder.customerPhone,
    tableNumber: canonicalOrder.tableNumber,
    deliveryAddress: canonicalOrder.deliveryAddress,
    deliveryLatitude: canonicalOrder.deliveryLatitude,
    deliveryLongitude: canonicalOrder.deliveryLongitude,
    subtotal: canonicalOrder.subtotal,
    deliveryCharge: canonicalOrder.deliveryCharge,
    total: canonicalOrder.total,
    items: canonicalOrder.items,
    razorpayOrderId: req.body.razorpayOrderId,
    razorpayPaymentId: req.body.razorpayPaymentId,
  });

  return res.json({
    orderId: order.id,
    orderCode: order.order_code,
    trackingToken: createOrderTrackingToken(order.id),
  });
};

export const createTestOrder = async (req, res) => {
  if (!env.localTestOrdersEnabled) {
    return res.status(403).json({ message: 'Test orders are disabled' });
  }

  assertRestaurantAcceptingOrders(await getRuntimeState());
  const canonicalDraft = await buildCanonicalOrderDraft(req.body);
  assertDeliveryEligibility(canonicalDraft);

  const order = await persistPaidOrder({
    orderCode: canonicalDraft.orderCode,
    orderType: canonicalDraft.orderType,
    customerName: canonicalDraft.customerName,
    customerPhone: canonicalDraft.customerPhone,
    tableNumber: canonicalDraft.tableNumber,
    deliveryAddress: canonicalDraft.deliveryAddress,
    deliveryLatitude: canonicalDraft.deliveryLatitude,
    deliveryLongitude: canonicalDraft.deliveryLongitude,
    subtotal: canonicalDraft.subtotal,
    deliveryCharge: canonicalDraft.deliveryCharge,
    total: canonicalDraft.total,
    items: canonicalDraft.items,
    razorpayOrderId: `test_order_${canonicalDraft.orderCode}`,
    razorpayPaymentId: `test_payment_${canonicalDraft.orderCode}`,
  });

  return res.json({
    orderId: order.id,
    orderCode: order.order_code,
    trackingToken: createOrderTrackingToken(order.id),
    testMode: true,
  });
};

export const fetchOrderById = async (req, res) => {
  assertValidOrderTrackingToken(req.params.orderId, req.query.trackingToken);
  const order = await getOrderById(req.params.orderId);
  res.json({ order });
};

export const lookupOrderByPhone = async (req, res) => {
  const data = await findLatestOrderByPhone(req.query.phone);
  if (!data) {
    return res.status(404).json({ message: 'No order found for this number' });
  }
  return res.json({
    ...data,
    trackingToken: createOrderTrackingToken(data.id),
  });
};

export const fetchAdminOrders = async (_req, res) => {
  const [orders, deliveryPeople] = await Promise.all([getAllOrders(), getDeliveryPeople()]);
  res.json({ orders, deliveryPeople });
};

export const createCounterTableOrder = async (req, res) => {
  const subtotal = Number(req.body.subtotal || 0);
  const total = Number(req.body.total || subtotal);

  const order = await createCounterTableOrderRecord({
    customerName: req.body.customerName,
    customerPhone: req.body.customerPhone,
    tableNumber: req.body.tableNumber,
    subtotal,
    total,
    items: req.body.items,
  });

  res.status(201).json({
    success: true,
    order,
    orderId: order.id,
    orderCode: order.order_code,
  });
};

export const settleTableBill = async (req, res) => {
  const closedCount = await closeActiveTableOrders(req.params.tableNumber);
  res.json({
    success: true,
    tableNumber: String(req.params.tableNumber),
    paymentMethod: req.body.paymentMethod,
    closedCount,
  });
};

export const patchOrderStatus = async (req, res) => {
  if (req.body.status === 'CANCELLED') {
    const order = await cancelOrderWithRefund(req.params.orderId, req.body.rejectionReason);
    return res.json({
      success: true,
      order,
      refund: {
        status: order.refund_status,
        refundId: order.refund_id,
      },
    });
  }

  await updateOrderStatus(req.params.orderId, req.body.status, req.body.rejectionReason);
  return res.json({ success: true });
};

export const patchDeliveryAssignment = async (req, res) => {
  await assignDeliveryPartner(req.params.orderId, req.body.deliveryPersonId);
  res.json({ success: true });
};

export const createAdminDeliveryPerson = async (req, res) => {
  const person = await createDeliveryPerson({
    name: req.body.name,
    phone: req.body.phone,
  });

  res.status(201).json({ person });
};

export const deleteAdminDeliveryPerson = async (req, res) => {
  const person = await deactivateDeliveryPerson(req.params.deliveryPersonId);
  res.json({ success: true, person });
};

export const fetchKitchenQueue = async (_req, res) => {
  const [orders, readyCount] = await Promise.all([getKitchenOrders(), getReadyCount()]);
  res.json({ orders, readyCount });
};
