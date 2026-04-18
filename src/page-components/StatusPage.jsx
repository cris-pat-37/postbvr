'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useInterval } from '../hooks/useInterval.js';
import { fetchOrderById, lookupOrderByPhone } from '../services/orderService.js';
import { STATUS_LABELS, STATUS_STEPS_DELIVERY, STATUS_STEPS_DINEIN } from '../utils/constants.js';
import { formatPrice, formatTime } from '../utils/format.js';
import { parseDeliveryAddress } from '../utils/orderLocation.js';

const isRefundState = (order) =>
  ['REFUND_PENDING', 'REFUNDED', 'REFUND_FAILED'].includes(order?.payment_status || '') ||
  ['created', 'pending', 'processed', 'failed'].includes(order?.refund_status || '');

const isCancelledPresentation = (order) => order?.status === 'CANCELLED' || isRefundState(order);

const getRefundMessage = (order) => {
  if (order.payment_status === 'REFUNDED' || order.refund_status === 'processed') {
    return 'Your refund has been completed to the original payment method.';
  }

  if (order.payment_status === 'REFUND_PENDING' || ['created', 'pending'].includes(order.refund_status || '')) {
    return 'Your refund has been initiated and will reflect on the original payment method soon.';
  }

  if (order.payment_status === 'REFUND_FAILED' || order.refund_status === 'failed') {
    return 'Refund initiation needs manual review from the restaurant team.';
  }

  if (order.payment_status === 'PAID') {
    return 'Your payment is protected and the restaurant team will process the refund.';
  }

  return 'No payment was captured for this order.';
};

export default function StatusPage() {
  const { orderId, orderTrackingToken, orderHistory, rememberOrder, setOrderCode, setOrderId, setOrderTrackingToken } = useAppContext();
  const { showToast } = useToast();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [countdownNow, setCountdownNow] = useState(Date.now());

  const loadStatus = async () => {
    if (!orderId || !orderTrackingToken) return;
    try {
      setLoading(true);
      const nextOrder = await fetchOrderById(orderId, orderTrackingToken);
      setOrder(nextOrder);
      rememberOrder({
        id: nextOrder.id,
        orderCode: nextOrder.order_code,
        trackingToken: orderTrackingToken,
        customerPhone: nextOrder.customer_phone,
        type: nextOrder.type,
        status: nextOrder.status,
        total: nextOrder.total,
        createdAt: nextOrder.created_at,
      });
    } catch {
      setOrder(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, [orderId, orderTrackingToken]);

  useInterval(() => {
    if (orderId && orderTrackingToken) loadStatus();
  }, 10000);

  useInterval(() => {
    setCountdownNow(Date.now());
  }, order && !isCancelledPresentation(order) && ['CONFIRMED', 'IN_KITCHEN'].includes(order.status) ? 1000 : null);

  const onLookup = async () => {
    if (!/^\d{10}$/.test(lookupPhone)) {
      setLookupError('Please enter a valid 10-digit phone number');
      return;
    }

    try {
      const data = await lookupOrderByPhone(lookupPhone);
      rememberOrder({
        id: data.id,
        orderCode: data.order_code,
        trackingToken: data.trackingToken,
        customerPhone: lookupPhone,
      });
      setLookupError('');
      showToast('Order found! Loading status...');
    } catch {
      setLookupError('No order found for this number');
    }
  };

  const selectRecentOrder = (entry) => {
    rememberOrder({
      id: entry.id,
      orderCode: entry.orderCode,
      trackingToken: entry.trackingToken,
      customerPhone: entry.customerPhone,
      type: entry.type,
      status: entry.status,
      total: entry.total,
      createdAt: entry.createdAt,
    });
    setOrder(null);
    setLookupError('');
  };

  const getPreparationCountdown = () => {
    if (!order || isCancelledPresentation(order) || !['CONFIRMED', 'IN_KITCHEN'].includes(order.status)) {
      return null;
    }

    const startMs = new Date(order.created_at).getTime();
    if (Number.isNaN(startMs)) {
      return null;
    }

    const remainingMs = Math.max(0, startMs + 25 * 60 * 1000 - countdownNow);
    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const preparationCountdown = getPreparationCountdown();

  const renderStatusTracker = () => {
    if (!order) return null;

    if (isCancelledPresentation(order)) {
      return (
        <div className="rejected-card">
          <div className="rejected-icon">X</div>
          <h3>Order Cancelled</h3>
          <div className="reason-text">{order.rejection_reason || 'Order could not be fulfilled'}</div>
          <p className="refund-note">{getRefundMessage(order)}</p>
          <Link className="back-btn" href="/menu?mode=outside">
            Back to Menu
          </Link>
        </div>
      );
    }

    const steps = order.type === 'delivery' ? STATUS_STEPS_DELIVERY : STATUS_STEPS_DINEIN;
    const currentIndex = steps.indexOf(order.status);

    return steps.map((step, index) => {
      const className = index < currentIndex ? 'completed' : index === currentIndex ? 'active' : 'pending';
      const icon = index < currentIndex ? 'OK' : index === currentIndex ? '...' : 'O';

      return (
        <div className={`step ${className}`} key={step}>
          {index !== steps.length - 1 && <div className="step-line" />}
          <div className="step-dot">{icon}</div>
          <div className="step-info">
            <div className="step-label">{STATUS_LABELS[step]}</div>
            <div className="step-time">{index === 0 ? formatTime(order.created_at) : index === currentIndex ? 'In progress' : '-'}</div>
          </div>
        </div>
      );
    });
  };

  const deliveryMeta = order?.type === 'delivery' ? parseDeliveryAddress(order.delivery_address || '') : null;
  const addressLabel = deliveryMeta?.address || order?.delivery_address || 'Delivery';

  return (
    <div>
      <nav className="navbar">
        <div className="nav-inner">
          <Link className="back-link" href="/menu?mode=outside">
            {'<-'} <span>Menu</span>
          </Link>
          <h1 className="page-title">Order Status</h1>
          <div style={{ width: 50 }} />
        </div>
      </nav>

      <main className="status-main">
        {loading && !order ? (
          <>
            <div className="card skeleton-panel">
              <div className="skeleton-line wide" />
              <div className="skeleton-line mid" />
              <div className="skeleton-line wide" />
            </div>
            <div className="card skeleton-panel">
              <div className="skeleton-line wide" />
              <div className="skeleton-line wide" />
              <div className="skeleton-line mid" />
              <div className="skeleton-line wide" />
            </div>
          </>
        ) : !order ? (
          <div className="lookup-card">
            <h2>Find Your Order</h2>
            <p>Lost your status? Enter the phone number used to place your order.</p>
            <input
              className="input-field"
              maxLength={10}
              onChange={(event) => setLookupPhone(event.target.value.replace(/\D/g, ''))}
              placeholder="10-digit phone number"
              type="tel"
              value={lookupPhone}
            />
            <button className="btn-gold" onClick={onLookup} type="button">
              Find
            </button>
            {!!lookupError && <div className="form-error">{lookupError}</div>}
            <Link className="lookup-link" href="/menu?mode=outside">
              Order More
            </Link>
            {!!orderHistory.length && (
              <div className="recent-orders-block">
                <h3 className="recent-orders-title">Recent Orders On This Device</h3>
                <div className="recent-orders-list">
                  {orderHistory.map((entry) => (
                    <button className="recent-order-card" key={entry.id} onClick={() => selectRecentOrder(entry)} type="button">
                      <span className="recent-order-code">#{entry.orderCode || 'Order'}</span>
                      <span className="recent-order-meta">{entry.customerPhone || 'Saved on this device'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="card">
              <div className="status-header">
                <div>
                  <h2 className="order-title">Order #{order.order_code}</h2>
                  <span className="order-badge">{order.type === 'delivery' ? 'Delivery' : `Dine-In · Table ${order.table_number || '?'}`}</span>
                </div>
                <div className="status-header-right">
                  <div className="muted-small">{formatTime(order.created_at)}</div>
                  <div className={isCancelledPresentation(order) ? 'order-total cancelled' : 'order-total'}>
                    {formatPrice(order.total)} {isCancelledPresentation(order) ? 'X' : 'OK'}
                  </div>
                </div>
              </div>
              <div className="muted-small">{order.type === 'delivery' ? `${addressLabel} · Paid via UPI` : `Table ${order.table_number || '?'} · Paid via UPI`}</div>
            </div>

            {!!preparationCountdown && (
              <div className="card eta-card">
                <div className="eta-label">Estimated preparation time</div>
                <div className="eta-timer">{preparationCountdown}</div>
                <div className="muted-small">This countdown starts once the restaurant accepts your order.</div>
              </div>
            )}

            <div className="card">
              <h2 className="card-title">Live Status</h2>
              <div>{renderStatusTracker()}</div>
            </div>

            {order.status === 'OUT_FOR_DELIVERY' && order.delivery_people && (
              <div className="card">
                <h2 className="card-title">Your Delivery Partner</h2>
                <div className="delivery-card-row">
                  <div className="delivery-avatar">DP</div>
                  <div>
                    <div className="delivery-name">{order.delivery_people.name}</div>
                    <a className="delivery-phone" href={`tel:${order.delivery_people.phone}`}>
                      {order.delivery_people.phone}
                    </a>
                  </div>
                </div>
              </div>
            )}

            <div className="card">
              <button className="collapse-header" onClick={() => setExpanded((value) => !value)} type="button">
                <h2 className="card-title">Items Ordered</h2>
                <span>{expanded ? '^' : 'v'}</span>
              </button>
              {expanded && (
                <div className="collapse-body open">
                  {(order.order_items || []).map((item) => (
                    <div className="items-row" key={`${item.item_name}-${item.id || item.quantity}`}>
                      <span>
                        {item.item_name} x {item.quantity}
                      </span>
                      <span className="gold-text">{formatPrice(item.price * item.quantity)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="auto-note">Status updates automatically every 10 seconds</p>
            <div className="center-box">
              <Link className="btn-gold inline-button" href="/menu?mode=outside">
                Order More
              </Link>
            </div>
            {!!orderHistory.length && (
              <div className="recent-orders-block compact">
                <h3 className="recent-orders-title">Your Saved Orders</h3>
                <div className="recent-orders-list">
                  {orderHistory.map((entry) => (
                    <button className={`recent-order-card ${entry.id === order.id ? 'active' : ''}`} key={entry.id} onClick={() => selectRecentOrder(entry)} type="button">
                      <span className="recent-order-code">#{entry.orderCode || 'Order'}</span>
                      <span className="recent-order-meta">{entry.id === order.id ? 'Currently open' : 'Tap to view'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
