import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import { razorpay } from '../config/razorpay.js';
import {
  attachPaymentMetadata,
  attachPaymentMetadataToList,
  findPaymentRecordByOrderId,
  findPaymentRecordByPaymentId,
  upsertPaymentRecord,
} from './paymentRecordService.js';
import { serializeDeliveryAddress } from '../utils/deliveryAddress.js';
import { assertValidStatusTransition } from '../utils/orderStatus.js';

const raise = (error, fallback = 500) => {
  if (error) {
    const wrapped = new Error(error.message);
    wrapped.statusCode = fallback;
    throw wrapped;
  }
};

const stripMissingOptionalOrderColumn = (payload, error) => {
  const message = String(error?.message || '');
  const nextPayload = { ...payload };
  let changed = false;

  for (const column of ['rejection_reason', 'cook_started_at']) {
    const missingColumn =
      message.includes(`orders.${column}`) ||
      message.includes(`'${column}' column of 'orders'`) ||
      message.includes(`column "${column}"`) ||
      message.includes(`column '${column}'`);

    if (Object.prototype.hasOwnProperty.call(nextPayload, column) && missingColumn) {
      delete nextPayload[column];
      changed = true;
    }
  }

  return changed ? nextPayload : null;
};

const updateOrderRecord = async (orderId, payload) => {
  let nextPayload = { ...payload };

  while (true) {
    const { error } = await supabase.from('orders').update(nextPayload).eq('id', orderId);
    if (!error) {
      return nextPayload;
    }

    const fallbackPayload = stripMissingOptionalOrderColumn(nextPayload, error);
    if (fallbackPayload) {
      nextPayload = fallbackPayload;
      continue;
    }

    raise(error);
  }
};

export const createRazorpayOrder = async ({ amount, receipt }) =>
  razorpay.orders.create({
    amount,
    currency: 'INR',
    receipt,
    payment_capture: 1,
  });

export const fetchRazorpayPayment = async (paymentId) => razorpay.payments.fetch(paymentId);

const getIstDayUtcRange = () => {
  const now = new Date();
  const shifted = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const date = shifted.getUTCDate();

  const startUtc = new Date(Date.UTC(year, month, date, 0, 0, 0) - 5.5 * 60 * 60 * 1000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);

  return {
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
  };
};

export const generateDailyOrderCode = async (offset = 0) => {
  const { startUtc, endUtc } = getIstDayUtcRange();
  const { data, error } = await supabase
    .from('orders')
    .select('order_code')
    .gte('created_at', startUtc)
    .lt('created_at', endUtc);

  raise(error);

  const latestSequence = (data || []).reduce((max, row) => {
    const match = String(row.order_code || '').match(/^BVR(\d{4})$/i);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return `BVR${String(latestSequence + 1 + Number(offset || 0)).padStart(4, '0')}`;
};

const isDuplicateOrderCodeError = (error) => {
  const message = String(error?.message || '');
  return error?.code === '23505' || message.includes('orders_order_code_key') || message.includes('duplicate key value');
};

export const verifyPaymentSignature = ({ orderId, paymentId, signature, secret }) => {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return expected === signature;
};

export const persistPaidOrder = async ({
  orderCode,
  orderType,
  customerName,
  customerPhone,
  tableNumber,
  deliveryAddress,
  deliveryLatitude,
  deliveryLongitude,
  subtotal,
  deliveryCharge,
  total,
  items,
  razorpayOrderId,
  razorpayPaymentId,
}) => {
  const existingOrder = await getOrderByCode(orderCode);
  if (existingOrder) {
    if (razorpayOrderId || razorpayPaymentId) {
      await upsertPaymentRecord({
        orderId: existingOrder.id,
        orderCode: existingOrder.order_code,
        razorpayOrderId,
        razorpayPaymentId,
        amount: Math.round(Number(existingOrder.total || total || 0) * 100),
        paymentStatus: existingOrder.payment_status || 'PAID',
      });
    }
    return attachPaymentMetadata(existingOrder);
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      order_code: orderCode,
      type: orderType,
      table_number: orderType === 'dine-in' ? tableNumber : null,
      customer_name: customerName,
      customer_phone: customerPhone,
      delivery_address:
        orderType === 'delivery'
          ? serializeDeliveryAddress({
              address: deliveryAddress,
              latitude: deliveryLatitude,
              longitude: deliveryLongitude,
            })
          : null,
      subtotal,
      delivery_charge: deliveryCharge,
      total,
      status: 'CONFIRMED',
      payment_status: 'PAID',
    })
    .select()
    .single();

  raise(orderError);

  const { error: itemsError } = await supabase.from('order_items').insert(
    items.map((item) => ({
      order_id: order.id,
      item_name: item.name,
      quantity: item.quantity,
      price: item.price,
    })),
  );

  raise(itemsError);

  await upsertPaymentRecord({
    orderId: order.id,
    orderCode: order.order_code,
    razorpayOrderId,
    razorpayPaymentId,
    amount: Math.round(Number(total || 0) * 100),
    paymentStatus: 'PAID',
  });

  return attachPaymentMetadata(order);
};

export const createCounterTableOrder = async ({
  customerName,
  customerPhone,
  tableNumber,
  subtotal,
  total,
  items,
}) => {
  const fallbackName = String(customerName || '').trim() || `Walk-in Table ${tableNumber}`;
  const fallbackPhone = String(customerPhone || '').trim() || '0000000000';
  let order = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const orderCode = await generateDailyOrderCode(attempt);
    const { data: nextOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_code: orderCode,
        type: 'dine-in',
        table_number: String(tableNumber),
        customer_name: fallbackName,
        customer_phone: fallbackPhone,
        subtotal,
        delivery_charge: 0,
        total,
        status: 'IN_KITCHEN',
        payment_status: 'PENDING',
      })
      .select()
      .single();

    if (!orderError) {
      order = nextOrder;
      break;
    }

    if (!isDuplicateOrderCodeError(orderError)) {
      raise(orderError);
    }
  }

  if (!order) {
    const error = new Error('Could not allocate a unique order code. Please try again.');
    error.statusCode = 409;
    throw error;
  }

  const { error: itemsError } = await supabase.from('order_items').insert(
    items.map((item) => ({
      order_id: order.id,
      item_name: item.name,
      quantity: item.quantity,
      price: item.price,
    })),
  );

  raise(itemsError);

  return getOrderById(order.id);
};

export const getOrderByCode = async (orderCode) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), delivery_people(name, phone)')
    .eq('order_code', orderCode)
    .maybeSingle();

  raise(error);
  return attachPaymentMetadata(data);
};

export const getOrderById = async (orderId) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), delivery_people(name, phone)')
    .eq('id', orderId)
    .single();

  raise(error, 404);
  return attachPaymentMetadata(data);
};

export const findLatestOrderByPhone = async (phone) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_code')
    .eq('customer_phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  raise(error);
  return data;
};

export const getAllOrders = async () => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), delivery_people(name, phone)')
    .order('created_at', { ascending: false });

  raise(error);
  return attachPaymentMetadataToList(data || []);
};

export const closeActiveTableOrders = async (tableNumber) => {
  const normalizedTable = String(tableNumber);
  const { data: tableOrders, error: ordersError } = await supabase
    .from('orders')
    .select('id, status, payment_status, type, table_number')
    .eq('type', 'dine-in')
    .eq('table_number', normalizedTable)
    .neq('status', 'CANCELLED')
    .neq('payment_status', 'PAID');

  raise(ordersError);

  for (const order of tableOrders || []) {
    await updateOrderRecord(order.id, {
      status: 'COMPLETED',
      payment_status: 'PAID',
    });
  }

  return (tableOrders || []).length;
};

export const getOrderSummary = async (orderId) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_code, status, type, payment_status, total')
    .eq('id', orderId)
    .single();
  raise(error, 404);
  return data;
};

export const getDeliveryPeople = async () => {
  const { data, error } = await supabase
    .from('delivery_people')
    .select('*')
    .eq('is_active', true);

  raise(error);
  return data || [];
};

export const createDeliveryPerson = async ({ name, phone }) => {
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  const normalizedName = String(name || '').trim();

  const { data: existingPerson, error: existingError } = await supabase
    .from('delivery_people')
    .select('*')
    .eq('phone', normalizedPhone)
    .maybeSingle();

  raise(existingError);

  if (existingPerson) {
    if (existingPerson.is_active) {
      const error = new Error('A delivery person with this phone number already exists.');
      error.statusCode = 409;
      throw error;
    }

    const { data, error } = await supabase
      .from('delivery_people')
      .update({ name: normalizedName, is_active: true })
      .eq('id', existingPerson.id)
      .select()
      .single();

    raise(error);
    return data;
  }

  const { data, error } = await supabase
    .from('delivery_people')
    .insert({ name: normalizedName, phone: normalizedPhone, is_active: true })
    .select()
    .single();

  raise(error);
  return data;
};

export const deactivateDeliveryPerson = async (deliveryPersonId) => {
  const { data: activeOrder, error: activeOrderError } = await supabase
    .from('orders')
    .select('id, order_code')
    .eq('delivery_person_id', deliveryPersonId)
    .eq('status', 'OUT_FOR_DELIVERY')
    .limit(1)
    .maybeSingle();

  raise(activeOrderError);

  if (activeOrder) {
    const error = new Error(`Cannot remove this delivery person while order #${activeOrder.order_code} is out for delivery.`);
    error.statusCode = 409;
    throw error;
  }

  const { data, error } = await supabase
    .from('delivery_people')
    .update({ is_active: false })
    .eq('id', deliveryPersonId)
    .select()
    .single();

  raise(error, 404);
  return data;
};

export const updateOrderStatus = async (orderId, status, rejectionReason = null) => {
  const currentOrder = await getOrderSummary(orderId);
  assertValidStatusTransition({
    currentStatus: currentOrder.status,
    nextStatus: status,
    orderType: currentOrder.type,
  });

  const payload = { status };
  if (rejectionReason) {
    payload.rejection_reason = rejectionReason;
  }
  if (status === 'IN_KITCHEN') {
    payload.cook_started_at = new Date().toISOString();
  }

  await updateOrderRecord(orderId, payload);
};

export const cancelOrderWithRefund = async (orderId, rejectionReason = null) => {
  const currentOrder = await getOrderSummary(orderId);
  if (currentOrder.status === 'CANCELLED') {
    return getOrderById(orderId);
  }

  assertValidStatusTransition({
    currentStatus: currentOrder.status,
    nextStatus: 'CANCELLED',
    orderType: currentOrder.type,
  });

  const refundReason = rejectionReason || 'Cancelled by restaurant';
  const payload = {
    status: 'CANCELLED',
    rejection_reason: refundReason,
  };

  if (currentOrder.payment_status === 'PAID') {
    const paymentRecord = await findPaymentRecordByOrderId(orderId);
    if (!paymentRecord?.razorpayPaymentId) {
      const error = new Error('Refund-safe cancellation is blocked because payment metadata is missing for this order.');
      error.statusCode = 409;
      throw error;
    }

    if (!(paymentRecord.refundId && ['created', 'pending', 'processed', 'failed'].includes(paymentRecord.refundStatus || ''))) {
      const refundAmount = Math.round(Number(currentOrder.total || 0) * 100);
      const refund = await razorpay.payments.refund(paymentRecord.razorpayPaymentId, {
        amount: refundAmount,
        speed: 'normal',
        notes: {
          order_code: currentOrder.order_code,
          reason: refundReason,
        },
      });

      await upsertPaymentRecord({
        ...paymentRecord,
        orderId,
        orderCode: currentOrder.order_code,
        refundId: refund.id,
        refundAmount: refund.amount,
        refundStatus: refund.status,
        refundFailureReason: refund.error_description || null,
        refundInitiatedAt: new Date().toISOString(),
        refundProcessedAt: refund.status === 'processed' ? new Date().toISOString() : null,
        paymentStatus: currentOrder.payment_status,
      });
    }
  }

  await updateOrderRecord(orderId, payload);

  return getOrderById(orderId);
};

export const assignDeliveryPartner = async (orderId, deliveryPersonId) => {
  const currentOrder = await getOrderSummary(orderId);
  assertValidStatusTransition({
    currentStatus: currentOrder.status,
    nextStatus: 'OUT_FOR_DELIVERY',
    orderType: currentOrder.type,
  });

  if (currentOrder.type !== 'delivery') {
    const error = new Error('Only delivery orders can be assigned to a delivery partner');
    error.statusCode = 400;
    throw error;
  }

  const { error } = await supabase
    .from('orders')
    .update({ delivery_person_id: deliveryPersonId, status: 'OUT_FOR_DELIVERY' })
    .eq('id', orderId);

  raise(error);
};

export const getKitchenOrders = async () => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .in('status', ['CONFIRMED', 'IN_KITCHEN'])
    .order('created_at', { ascending: true });

  raise(error);
  return attachPaymentMetadataToList(data || []);
};

export const getReadyCount = async () => {
  const { count, error } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'READY');

  raise(error);
  return count || 0;
};

export const syncRefundStatusFromWebhook = async ({ paymentId, refundId, refundAmount, refundStatus, refundFailureReason = null }) => {
  const paymentRecord = await findPaymentRecordByPaymentId(paymentId);
  if (!paymentRecord?.orderId) {
    return null;
  }

  await upsertPaymentRecord({
    ...paymentRecord,
    refundId,
    refundAmount,
    refundStatus,
    refundFailureReason,
    refundInitiatedAt: paymentRecord.refundInitiatedAt || new Date().toISOString(),
    refundProcessedAt: refundStatus === 'processed' ? new Date().toISOString() : paymentRecord.refundProcessedAt || null,
    paymentStatus: paymentRecord.paymentStatus || 'PAID',
  });

  return paymentRecord.orderId;
};
