import express from 'express';
import Joi from 'joi';
import {
  createOrder,
  createCounterTableOrder,
  createAdminDeliveryPerson,
  deleteAdminDeliveryPerson,
  fetchAdminOrders,
  fetchKitchenQueue,
  fetchOrderById,
  lookupOrderByPhone,
  patchDeliveryAssignment,
  patchOrderStatus,
  settleTableBill,
  createTestOrder,
  verifyPayment,
} from '../controllers/orderController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const itemSchema = Joi.object({
  id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  name: Joi.string().required(),
  price: Joi.number().required(),
  quantity: Joi.number().integer().min(1).required(),
});

const orderDraftSchema = Joi.object({
  receipt: Joi.string().allow('', null),
  orderCode: Joi.string().allow('', null),
  orderType: Joi.string().valid('dine-in', 'delivery').required(),
  customerName: Joi.string().required(),
  customerPhone: Joi.string().pattern(/^\d{10}$/).required(),
  tableNumber: Joi.alternatives().try(Joi.string(), Joi.number()).allow('', null),
  deliveryAddress: Joi.string().allow('', null),
  deliveryLatitude: Joi.number().allow(null),
  deliveryLongitude: Joi.number().allow(null),
  subtotal: Joi.number().required(),
  deliveryCharge: Joi.number().required(),
  total: Joi.number().required(),
  items: Joi.array().items(itemSchema).min(1).required(),
});

const router = express.Router();

router.post(
  '/create-order',
  validate(orderDraftSchema),
  createOrder,
);

router.post(
  '/test-checkout',
  validate(orderDraftSchema),
  createTestOrder,
);

router.post(
  '/verify-payment',
  validate(
    orderDraftSchema.keys({
      razorpayOrderId: Joi.string().required(),
      razorpayPaymentId: Joi.string().required(),
      razorpaySignature: Joi.string().required(),
    }),
  ),
  verifyPayment,
);

router.get(
  '/lookup',
  validate(Joi.object({ phone: Joi.string().pattern(/^\d{10}$/).required() }), 'query'),
  lookupOrderByPhone,
);
router.get(
  '/:orderId',
  validate(
    Joi.object({
      trackingToken: Joi.string().required(),
    }),
    'query',
  ),
  fetchOrderById,
);
router.get('/admin/all', requireAuth('owner'), fetchAdminOrders);
router.post(
  '/admin/dine-in/table-order',
  requireAuth('owner'),
  validate(
    Joi.object({
      customerName: Joi.string().allow('', null),
      customerPhone: Joi.string().allow('', null),
      tableNumber: Joi.number().integer().min(1).max(16).required(),
      subtotal: Joi.number().required(),
      total: Joi.number().required(),
      items: Joi.array().items(itemSchema).min(1).required(),
    }),
  ),
  createCounterTableOrder,
);
router.patch(
  '/admin/dine-in/table/:tableNumber/close',
  requireAuth('owner'),
  validate(
    Joi.object({
      tableNumber: Joi.number().integer().min(1).max(16).required(),
    }),
    'params',
  ),
  validate(
    Joi.object({
      paymentMethod: Joi.string().valid('CASH', 'CARD', 'UPI').required(),
    }),
  ),
  settleTableBill,
);
router.post(
  '/admin/delivery-people',
  requireAuth('owner'),
  validate(
    Joi.object({
      name: Joi.string().trim().min(2).max(80).required(),
      phone: Joi.string().pattern(/^\d{10}$/).required(),
    }),
  ),
  createAdminDeliveryPerson,
);
router.delete('/admin/delivery-people/:deliveryPersonId', requireAuth('owner'), deleteAdminDeliveryPerson);
router.patch(
  '/admin/:orderId/status',
  requireAuth('owner'),
  validate(
    Joi.object({
      status: Joi.string()
        .valid('NEW', 'CONFIRMED', 'IN_KITCHEN', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED', 'SERVED')
        .required(),
      rejectionReason: Joi.string().allow('', null),
    }),
  ),
  patchOrderStatus,
);
router.patch(
  '/admin/:orderId/assign-delivery',
  requireAuth('owner'),
  validate(
    Joi.object({
      deliveryPersonId: Joi.string().required(),
    }),
  ),
  patchDeliveryAssignment,
);
router.get('/kitchen/queue/list', requireAuth('kitchen'), fetchKitchenQueue);
router.patch(
  '/kitchen/:orderId/status',
  requireAuth('kitchen'),
  validate(
    Joi.object({
      status: Joi.string().valid('IN_KITCHEN', 'READY').required(),
    }),
  ),
  patchOrderStatus,
);
export default router;
