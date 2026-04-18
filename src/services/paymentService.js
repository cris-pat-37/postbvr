'use client';

import { api } from './api.js';

export const createPaymentOrder = async (payload) => {
  const { data } = await api.post('/orders/create-order', payload);
  return data;
};

export const verifyPayment = async (payload) => {
  const { data } = await api.post('/orders/verify-payment', payload);
  return data;
};

export const createTestOrder = async (payload) => {
  const { data } = await api.post('/orders/test-checkout', payload);
  return data;
};
