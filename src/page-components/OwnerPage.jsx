'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useInterval } from '../hooks/useInterval.js';
import { ownerLogin } from '../services/authService.js';
import { fetchAdminMenuItems, updateMenuAvailability } from '../services/menuService.js';
import {
  addDeliveryPerson,
  assignDeliveryPartner,
  createCounterTableOrder,
  fetchAdminOrders,
  removeDeliveryPerson,
  settleTableBill,
  updateAdminOrderStatus,
} from '../services/orderService.js';
import { formatPrice, timeAgo } from '../utils/format.js';
import { printBillSlip } from '../utils/billPrint.js';
import { printKotSlip } from '../utils/kotPrint.js';
import { getDirectionsUrl, parseDeliveryAddress } from '../utils/orderLocation.js';
import { notifyNewOrder, primeAlertAudio, requestStaffNotificationPermission, startNewOrderAlertLoop, stopNewOrderAlertLoop } from '../utils/staffAlerts.js';

const statusBadgeMap = {
  NEW: { bg: '#3b82f620', color: '#3b82f6', text: 'NEW' },
  CONFIRMED: { bg: '#d4a01720', color: '#d4a017', text: 'CONFIRMED' },
  IN_KITCHEN: { bg: '#f9731620', color: '#f97316', text: 'IN KITCHEN' },
  READY: { bg: '#22c55e20', color: '#22c55e', text: 'READY' },
  SERVED: { bg: '#14b8a620', color: '#14b8a6', text: 'SERVED' },
  OUT_FOR_DELIVERY: { bg: '#8b5cf620', color: '#8b5cf6', text: 'OUT FOR DELIVERY' },
  COMPLETED: { bg: '#22c55e20', color: '#22c55e', text: 'COMPLETED' },
  CANCELLED: { bg: '#ef444420', color: '#ef4444', text: 'CANCELLED' },
};

const paymentMethods = ['CASH', 'CARD', 'UPI'];
const tableOptions = Array.from({ length: 16 }, (_, index) => String(index + 1));

const getRefundNote = (order) => {
  if (order.payment_status === 'REFUNDED' || order.refund_status === 'processed') {
    return 'Refund completed to the original payment method.';
  }

  if (order.payment_status === 'REFUND_PENDING' || ['created', 'pending'].includes(order.refund_status || '')) {
    return 'Refund initiated and waiting for banking settlement.';
  }

  if (order.payment_status === 'REFUND_FAILED' || order.refund_status === 'failed') {
    return `Refund failed${order.refund_failure_reason ? `: ${order.refund_failure_reason}` : '.'}`;
  }

  return '';
};

const groupTableOrders = (orders) => {
  const groups = new Map();

  for (const order of orders) {
    const tableNumber = String(order.table_number || 'Unknown');
    if (!groups.has(tableNumber)) {
      groups.set(tableNumber, {
        tableNumber,
        orders: [],
        total: 0,
        itemCount: 0,
        latestCreatedAt: order.created_at,
        customerName: order.customer_name || '',
        customerPhone: order.customer_phone || '',
      });
    }

    const group = groups.get(tableNumber);
    group.orders.push(order);
    group.total += Number(order.total || 0);
    group.itemCount += (order.order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    if (new Date(order.created_at) > new Date(group.latestCreatedAt)) {
      group.latestCreatedAt = order.created_at;
    }
    if (order.customer_name && !String(order.customer_name).startsWith('Walk-in Table')) {
      group.customerName = order.customer_name;
    }
    if (order.customer_phone && order.customer_phone !== '0000000000') {
      group.customerPhone = order.customer_phone;
    }
  }

  return Array.from(groups.values()).sort((a, b) => Number(a.tableNumber) - Number(b.tableNumber));
};

const buildAggregatedBillOrder = (group, paymentMethod = 'Pending') => {
  const itemMap = new Map();

  for (const order of group.orders) {
    for (const item of order.order_items || []) {
      const unitPrice = Number(item.price_at_purchase ?? item.price ?? 0);
      const key = `${item.item_name}__${unitPrice}`;
      const existing = itemMap.get(key);
      if (existing) {
        existing.quantity += Number(item.quantity || 0);
      } else {
        itemMap.set(key, {
          item_name: item.item_name,
          quantity: Number(item.quantity || 0),
          price: unitPrice,
        });
      }
    }
  }

  return {
    order_code: `TABLE-${group.tableNumber}`,
    type: 'dine-in',
    table_number: group.tableNumber,
    customer_name: group.customerName || `Walk-in Table ${group.tableNumber}`,
    customer_phone: group.customerPhone || '',
    created_at: group.latestCreatedAt,
    total: group.total,
    payment_method: paymentMethod,
    order_items: Array.from(itemMap.values()),
  };
};

export default function OwnerPage() {
  const { ownerToken, setOwnerToken, restaurantStatus, setKitchenPaused, setMaintenanceMode } = useAppContext();
  const { showToast } = useToast();
  const [orders, setOrders] = useState([]);
  const [deliveryPeople, setDeliveryPeople] = useState([]);
  const [managedItems, setManagedItems] = useState([]);
  const [currentTab, setCurrentTab] = useState('orders');
  const [currentFilter, setCurrentFilter] = useState('all');
  const [menuFilter, setMenuFilter] = useState('all');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [rejectingOrderId, setRejectingOrderId] = useState('');
  const [selectedReason, setSelectedReason] = useState('');
  const [deliveryStaffForm, setDeliveryStaffForm] = useState({ name: '', phone: '' });
  const [addingDeliveryStaff, setAddingDeliveryStaff] = useState(false);
  const [removingDeliveryStaffId, setRemovingDeliveryStaffId] = useState('');
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [tableNumber, setTableNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [builderCategory, setBuilderCategory] = useState('all');
  const [builderQuery, setBuilderQuery] = useState('');
  const [draftItems, setDraftItems] = useState([]);
  const [submittingTableOrder, setSubmittingTableOrder] = useState(false);
  const [billingTableNumber, setBillingTableNumber] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('CASH');
  const [settlingTable, setSettlingTable] = useState(false);
  const knownOrderIdsRef = useRef(new Set());
  const orderEntryRef = useRef(null);

  const handleAuthFailure = (error) => {
    if (error?.response?.status === 401) {
      setOwnerToken('');
      showToast('Session expired. Please login again.', 'error');
      return true;
    }

    return false;
  };

  const loadOrders = async ({ silent = false } = {}) => {
    if (!ownerToken) return;
    try {
      if (!silent) {
        setLoadingOrders(true);
      }
      const data = await fetchAdminOrders(ownerToken);
      const nextOrderIds = new Set(data.orders.map((order) => order.id));
      const incomingOrders = data.orders.filter((order) => !knownOrderIdsRef.current.has(order.id) && order.type === 'delivery');
      if (knownOrderIdsRef.current.size && incomingOrders.length) {
        const latestOrder = incomingOrders[0];
        showToast(`New order received: #${latestOrder.order_code}`);
        startNewOrderAlertLoop();
        notifyNewOrder('New BVR order', `Order #${latestOrder.order_code} is waiting in the owner dashboard.`);
      }
      knownOrderIdsRef.current = nextOrderIds;
      setOrders(data.orders);
      setDeliveryPeople(data.deliveryPeople);
    } catch (error) {
      handleAuthFailure(error);
    } finally {
      setLoadingOrders(false);
    }
  };

  const loadMenu = async () => {
    if (!ownerToken) return;
    try {
      setLoadingMenu(true);
      const items = await fetchAdminMenuItems(ownerToken);
      setManagedItems(items);
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast('Failed to load menu', 'error');
      }
    } finally {
      setLoadingMenu(false);
    }
  };

  useEffect(() => {
    if (ownerToken) {
      loadOrders();
      loadMenu();
    }
  }, [ownerToken]);

  useEffect(() => {
    if (!ownerToken) return;

    const unlockAlerts = () => {
      primeAlertAudio();
      requestStaffNotificationPermission();
    };

    unlockAlerts();
    window.addEventListener('pointerdown', unlockAlerts, { passive: true });
    window.addEventListener('keydown', unlockAlerts);

    return () => {
      window.removeEventListener('pointerdown', unlockAlerts);
      window.removeEventListener('keydown', unlockAlerts);
    };
  }, [ownerToken]);

  useInterval(() => {
    if (ownerToken) {
      loadOrders({ silent: true });
    }
  }, ownerToken ? 10000 : null);

  const deliveryOrders = useMemo(() => orders.filter((order) => order.type === 'delivery'), [orders]);
  const activeTableGroups = useMemo(
    () =>
      groupTableOrders(
        orders.filter(
          (order) => order.type === 'dine-in' && order.status !== 'CANCELLED' && order.payment_status !== 'PAID',
        ),
      ),
    [orders],
  );

  const filteredDeliveryOrders = useMemo(() => {
    if (currentFilter === 'all') return deliveryOrders;
    if (currentFilter === 'new') return deliveryOrders.filter((order) => order.status === 'NEW');
    if (currentFilter === 'active') return deliveryOrders.filter((order) => ['CONFIRMED', 'IN_KITCHEN'].includes(order.status));
    if (currentFilter === 'ready') return deliveryOrders.filter((order) => ['READY', 'OUT_FOR_DELIVERY'].includes(order.status));
    return deliveryOrders.filter((order) => ['COMPLETED', 'SERVED', 'CANCELLED'].includes(order.status));
  }, [currentFilter, deliveryOrders]);

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const todayOrders = orders.filter((order) => new Date(order.created_at).toDateString() === today);
    return {
      pending: deliveryOrders.filter((order) => order.status === 'NEW').length + activeTableGroups.length,
      active: orders.filter((order) => !['COMPLETED', 'CANCELLED'].includes(order.status)).length,
      today: todayOrders.length,
      revenue: todayOrders.filter((order) => order.status !== 'CANCELLED').reduce((sum, order) => sum + (order.total || 0), 0),
    };
  }, [activeTableGroups.length, deliveryOrders, orders]);

  const menuCategories = [...new Set(managedItems.map((item) => item.menu_categories?.name).filter(Boolean))];
  const visibleMenuItems = menuFilter === 'all' ? managedItems : managedItems.filter((item) => item.menu_categories?.name === menuFilter);
  const builderItems = useMemo(() => {
    const availableItems = managedItems.filter((item) => item.is_available);
    return availableItems.filter((item) => {
      const categoryMatch = builderCategory === 'all' || item.menu_categories?.name === builderCategory;
      const queryMatch = !builderQuery.trim() || item.name.toLowerCase().includes(builderQuery.trim().toLowerCase());
      return categoryMatch && queryMatch;
    });
  }, [builderCategory, builderQuery, managedItems]);

  const handleLogin = async () => {
    try {
      await primeAlertAudio();
      requestStaffNotificationPermission();
      const data = await ownerLogin(email, password);
      setOwnerToken(data.token);
      setLoginError('');
      showToast('Welcome, owner!');
    } catch (error) {
      setLoginError(error.response?.data?.message || 'Invalid email or password');
    }
  };

  const handleStatusUpdate = async (orderId, status, rejectionReason = null) => {
    try {
      stopNewOrderAlertLoop();
      const result = await updateAdminOrderStatus(ownerToken, orderId, status, rejectionReason);
      if (status === 'CANCELLED' && result?.refund?.status) {
        showToast(`Order cancelled. Refund ${result.refund.status === 'processed' ? 'completed' : 'initiated'}.`);
      } else {
        showToast('Order updated.');
      }
      setRejectingOrderId('');
      setSelectedReason('');
      await loadOrders();
      return result;
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Update failed', 'error');
      }
      return null;
    }
  };

  const handlePrintKot = async (order) => {
    const printOpened = printKotSlip(order);
    if (!printOpened) {
      showToast('Could not open KOT print window. Please check pop-up permission.', 'error');
      return false;
    }
    showToast(`KOT print window opened for order #${order.order_code}`);
    return true;
  };

  const handlePrintBill = async (order) => {
    const printOpened = printBillSlip(order);
    if (!printOpened) {
      showToast('Could not open bill print window. Please check pop-up permission.', 'error');
      return false;
    }
    showToast(`Bill print window opened for ${order.order_code}`);
    return true;
  };

  const handleAssignDelivery = async (orderId, deliveryPersonId) => {
    if (!deliveryPersonId) {
      showToast('Please select a delivery partner', 'error');
      return;
    }

    try {
      stopNewOrderAlertLoop();
      await assignDeliveryPartner(ownerToken, orderId, deliveryPersonId);
      showToast('Delivery partner assigned.');
      await loadOrders();
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast('Assignment failed', 'error');
      }
    }
  };

  const handleDeliveryStaffChange = (event) => {
    const { name, value } = event.target;
    setDeliveryStaffForm((current) => ({
      ...current,
      [name]: name === 'phone' ? value.replace(/\D/g, '').slice(0, 10) : value,
    }));
  };

  const handleAddDeliveryStaff = async () => {
    const name = deliveryStaffForm.name.trim();
    const phone = deliveryStaffForm.phone.trim();

    if (name.length < 2) {
      showToast('Please enter the delivery person name.', 'error');
      return;
    }

    if (!/^\d{10}$/.test(phone)) {
      showToast('Please enter a valid 10-digit phone number.', 'error');
      return;
    }

    try {
      stopNewOrderAlertLoop();
      setAddingDeliveryStaff(true);
      const person = await addDeliveryPerson(ownerToken, { name, phone });
      setDeliveryPeople((current) => [person, ...current.filter((existing) => existing.id !== person.id)]);
      setDeliveryStaffForm({ name: '', phone: '' });
      showToast('Delivery person added.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Could not add delivery person', 'error');
      }
    } finally {
      setAddingDeliveryStaff(false);
    }
  };

  const handleRemoveDeliveryStaff = async (person) => {
    const confirmed = window.confirm(`Remove ${person.name} from active delivery staff?`);
    if (!confirmed) return;

    try {
      stopNewOrderAlertLoop();
      setRemovingDeliveryStaffId(person.id);
      await removeDeliveryPerson(ownerToken, person.id);
      setDeliveryPeople((current) => current.filter((existing) => existing.id !== person.id));
      showToast('Delivery person removed from active staff.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Could not remove delivery person', 'error');
      }
    } finally {
      setRemovingDeliveryStaffId('');
    }
  };

  const handleToggleMenu = async (itemId, isAvailable) => {
    try {
      stopNewOrderAlertLoop();
      await updateMenuAvailability(ownerToken, itemId, isAvailable);
      setManagedItems((previous) => previous.map((item) => (item.id === itemId ? { ...item, is_available: isAvailable } : item)));
      showToast(isAvailable ? 'Marked available.' : 'Marked unavailable.', isAvailable ? 'success' : 'info');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast('Update failed', 'error');
      }
    }
  };

  const handleKitchenToggle = async () => {
    try {
      stopNewOrderAlertLoop();
      await setKitchenPaused(!restaurantStatus.kitchenPaused);
      showToast(restaurantStatus.kitchenPaused ? 'Kitchen is back on and orders are open.' : 'Kitchen paused. New orders are blocked.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast('Could not update kitchen status', 'error');
      }
    }
  };

  const handleMaintenanceToggle = async () => {
    try {
      stopNewOrderAlertLoop();
      await setMaintenanceMode(!restaurantStatus.maintenanceMode);
      showToast(restaurantStatus.maintenanceMode ? 'Website is back online.' : 'Maintenance mode is now live for customers.');
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast('Could not update maintenance mode', 'error');
      }
    }
  };

  const changeDraftItem = (menuItem, delta) => {
    setDraftItems((current) => {
      const existing = current.find((item) => item.id === menuItem.id);
      if (!existing && delta < 0) {
        return current;
      }

      if (existing) {
        return current
          .map((item) => (item.id === menuItem.id ? { ...item, quantity: item.quantity + delta } : item))
          .filter((item) => item.quantity > 0);
      }

      return [...current, { id: menuItem.id, name: menuItem.name, price: Number(menuItem.price), quantity: 1 }];
    });
  };

  const draftSubtotal = useMemo(
    () => draftItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0),
    [draftItems],
  );

  const resetDraft = () => {
    setDraftItems([]);
    setBuilderQuery('');
    setBuilderCategory('all');
  };

  const handleCreateTableKot = async () => {
    if (!String(tableNumber).trim()) {
      showToast('Enter table number first.', 'error');
      return;
    }
    if (!draftItems.length) {
      showToast('Add at least one item for this table.', 'error');
      return;
    }

    try {
      setSubmittingTableOrder(true);
      const response = await createCounterTableOrder(ownerToken, {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        tableNumber: String(tableNumber).trim(),
        subtotal: draftSubtotal,
        total: draftSubtotal,
        items: draftItems,
      });

      await handlePrintKot(response.order);
      showToast(`KOT created for Table ${tableNumber}.`);
      resetDraft();
      await loadOrders();
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Could not create table KOT', 'error');
      }
    } finally {
      setSubmittingTableOrder(false);
    }
  };

  const startAddMoreForTable = (group) => {
    setTableNumber(group.tableNumber);
    setCustomerName(group.customerName || '');
    setCustomerPhone(group.customerPhone || '');
    resetDraft();
    orderEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`Ready to add more items for Table ${group.tableNumber}.`, 'info');
  };

  const openBillingForTable = (group) => {
    setBillingTableNumber(group.tableNumber);
    setSelectedPaymentMethod('CASH');
  };

  const selectedBillingGroup = useMemo(
    () => activeTableGroups.find((group) => group.tableNumber === billingTableNumber) || null,
    [activeTableGroups, billingTableNumber],
  );

  const handleSettleCurrentTable = async () => {
    if (!selectedBillingGroup) return;

    try {
      setSettlingTable(true);
      await settleTableBill(ownerToken, selectedBillingGroup.tableNumber, selectedPaymentMethod);
      showToast(`Table ${selectedBillingGroup.tableNumber} closed as ${selectedPaymentMethod}.`);
      setBillingTableNumber('');
      await loadOrders();
    } catch (error) {
      if (!handleAuthFailure(error)) {
        showToast(error.response?.data?.message || 'Could not close table', 'error');
      }
    } finally {
      setSettlingTable(false);
    }
  };

  if (!ownerToken) {
    return (
      <div className="login-overlay auth-screen">
        <div className="login-box">
          <h2>Owner Login</h2>
          <div className="stacked-fields">
            <input className="input-field" onChange={(event) => setEmail(event.target.value)} placeholder="Email" type="email" value={email} />
            <div className="password-input-wrap">
              <input className="input-field password-input" onChange={(event) => setPassword(event.target.value)} placeholder="Password" type={showPassword ? 'text' : 'password'} value={password} />
              <button className="password-toggle-btn" onClick={() => setShowPassword((value) => !value)} type="button">
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <button className="btn-gold" onClick={handleLogin} type="button">
              Login
            </button>
            {!!loginError && <p className="form-error">{loginError}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <nav className="navbar">
        <div className="nav-inner">
          <h1 className="page-title">Owner Dashboard</h1>
          <button
            className="logout-link button-reset"
            onClick={() => {
              stopNewOrderAlertLoop();
              setOwnerToken('');
            }}
            type="button"
          >
            Logout
          </button>
        </div>
      </nav>

      <main className="dashboard-main">
        <div className="owner-tabs">
          <button className={`owner-tab ${currentTab === 'orders' ? 'active' : ''}`} onClick={() => setCurrentTab('orders')} type="button">
            Orders
          </button>
          <button className={`owner-tab ${currentTab === 'menu' ? 'active' : ''}`} onClick={() => setCurrentTab('menu')} type="button">
            Menu
          </button>
        </div>

        <div className="status-control-card">
          <div>
            <div className="status-control-label">Kitchen Control</div>
            <div className={`status-chip ${restaurantStatus.kitchenPaused ? 'paused' : 'live'}`}>
              {restaurantStatus.kitchenPaused ? 'Paused manually' : 'Accepting orders'}
            </div>
            <p className="muted-small">
              {restaurantStatus.kitchenPaused
                ? 'Checkout is blocked until the kitchen is turned back on.'
                : 'Ordering is live and synchronized with the kitchen dashboard.'}
            </p>
          </div>
          <button className={`status-toggle-btn ${restaurantStatus.kitchenPaused ? 'resume' : 'pause'}`} onClick={handleKitchenToggle} type="button">
            {restaurantStatus.kitchenPaused ? 'Turn Kitchen On' : 'Pause Kitchen'}
          </button>
        </div>

        <div className="status-control-card">
          <div>
            <div className="status-control-label">Website Maintenance</div>
            <div className={`status-chip ${restaurantStatus.maintenanceMode ? 'paused' : 'live'}`}>
              {restaurantStatus.maintenanceMode ? 'Maintenance is live' : 'Website is public'}
            </div>
            <p className="muted-small">
              {restaurantStatus.maintenanceMode
                ? 'Customers see a maintenance screen until you turn the website back on.'
                : 'Turn this on when you want to temporarily hide the public website and stop customer access.'}
            </p>
          </div>
          <button className={`status-toggle-btn ${restaurantStatus.maintenanceMode ? 'resume' : 'pause'}`} onClick={handleMaintenanceToggle} type="button">
            {restaurantStatus.maintenanceMode ? 'Turn Website On' : 'Enable Maintenance'}
          </button>
        </div>

        <div className="status-control-card staff-control-card">
          <div className="staff-control-copy">
            <div className="status-control-label">Delivery Staff</div>
            <p className="muted-small">Add a new delivery person here. Their name and phone will show to the customer after assignment.</p>
            <div className="staff-list-row">
              {deliveryPeople.length ? (
                deliveryPeople.map((person) => (
                  <span className="staff-person-chip" key={person.id}>
                    <span>{person.name} · {person.phone}</span>
                    <button
                      className="staff-remove-btn"
                      disabled={removingDeliveryStaffId === person.id}
                      onClick={() => handleRemoveDeliveryStaff(person)}
                      type="button"
                    >
                      {removingDeliveryStaffId === person.id ? 'Removing...' : 'Remove'}
                    </button>
                  </span>
                ))
              ) : (
                <span className="muted-small">No active delivery staff added yet.</span>
              )}
            </div>
          </div>
          <div className="staff-form-card">
            <input
              className="input-field"
              name="name"
              onChange={handleDeliveryStaffChange}
              placeholder="Delivery person name"
              type="text"
              value={deliveryStaffForm.name}
            />
            <input
              className="input-field"
              inputMode="numeric"
              maxLength={10}
              name="phone"
              onChange={handleDeliveryStaffChange}
              placeholder="10-digit phone number"
              type="tel"
              value={deliveryStaffForm.phone}
            />
            <button className="status-toggle-btn resume" disabled={addingDeliveryStaff} onClick={handleAddDeliveryStaff} type="button">
              {addingDeliveryStaff ? 'Adding...' : 'Add Delivery Person'}
            </button>
          </div>
        </div>

        {currentTab === 'orders' ? (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-num">{stats.pending}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-card">
                <div className="stat-num">{stats.active}</div>
                <div className="stat-label">Active</div>
              </div>
              <div className="stat-card">
                <div className="stat-num">{stats.today}</div>
                <div className="stat-label">Today</div>
              </div>
            </div>

            <div className="card revenue-card">
              <div className="stat-label">Today's Revenue</div>
              <div className="revenue-total">{formatPrice(stats.revenue)}</div>
            </div>

            <div className="card" ref={orderEntryRef}>
              <div className="status-control-label" style={{ marginBottom: 12 }}>Counter Table Order Entry</div>
              <p className="muted-small" style={{ marginBottom: 16 }}>
                Waiter tells the table number here, you add items, then create a KOT. Customers do not pay while ordering in restaurant.
              </p>
              <div className="staff-form-card" style={{ alignItems: 'stretch' }}>
                <select className="input-field" onChange={(event) => setTableNumber(event.target.value)} value={tableNumber}>
                  <option value="">Select table number</option>
                  {tableOptions.map((option) => (
                    <option key={option} value={option}>
                      Table {option}
                    </option>
                  ))}
                </select>
                <input className="input-field" onChange={(event) => setCustomerName(event.target.value)} placeholder="Customer name (optional)" type="text" value={customerName} />
                <input className="input-field" inputMode="numeric" maxLength={10} onChange={(event) => setCustomerPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="Customer phone (optional)" type="tel" value={customerPhone} />
              </div>

              <div className="filter-wrap" style={{ marginTop: 16 }}>
                <button className={`filter-btn ${builderCategory === 'all' ? 'active' : ''}`} onClick={() => setBuilderCategory('all')} type="button">
                  All Items
                </button>
                {menuCategories.map((category) => (
                  <button className={`filter-btn ${builderCategory === category ? 'active' : ''}`} key={category} onClick={() => setBuilderCategory(category)} type="button">
                    {category}
                  </button>
                ))}
              </div>

              <input className="input-field" onChange={(event) => setBuilderQuery(event.target.value)} placeholder="Search item name" style={{ marginTop: 12 }} type="text" value={builderQuery} />

              <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
                {builderItems.slice(0, 18).map((item) => {
                  const qty = draftItems.find((draftItem) => draftItem.id === item.id)?.quantity || 0;
                  return (
                    <div className="menu-item-row" key={item.id}>
                      <div className="menu-item-thumb">{item.image_url ? <img alt={item.name} src={item.image_url} /> : '🍽️'}</div>
                      <div className="menu-item-body">
                        <div className="menu-item-name">{item.name}</div>
                        <div className="muted-small">{item.menu_categories?.name || 'Other'}</div>
                      </div>
                      <div className="menu-item-side">
                        <span className="gold-text strong">{formatPrice(item.price)}</span>
                        <div className="qty-wrap">
                          <button className="qty-btn small" onClick={() => changeDraftItem(item, -1)} type="button">
                            -
                          </button>
                          <span className="qty-num">{qty}</span>
                          <button className="qty-btn small" onClick={() => changeDraftItem(item, 1)} type="button">
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="summary-row top-border" style={{ marginTop: 16 }}>
                <span>Draft Total</span>
                <span className="gold-text strong">{formatPrice(draftSubtotal)}</span>
              </div>

              <div className="action-row">
                <button className="act-btn act-secondary" onClick={resetDraft} type="button">
                  Clear Draft
                </button>
                <button className="act-btn act-confirm" disabled={submittingTableOrder} onClick={handleCreateTableKot} type="button">
                  {submittingTableOrder ? 'Creating KOT...' : 'Create KOT For Table'}
                </button>
              </div>
            </div>

            <div className="card">
              <div className="status-control-label" style={{ marginBottom: 12 }}>Active Table Orders</div>
              {!activeTableGroups.length && <div className="muted-small">No active in-restaurant tables right now.</div>}
              {activeTableGroups.map((group) => (
                <div className="card" key={group.tableNumber} style={{ marginBottom: 16 }}>
                  <div className="order-card-head">
                    <div>
                      <h3 className="order-card-title">Table {group.tableNumber}</h3>
                      <div className="muted-small">{timeAgo(group.latestCreatedAt)} · {group.orders.length} KOTs · {group.itemCount} items</div>
                      <div className="muted-small">{group.customerName || `Walk-in Table ${group.tableNumber}`}{group.customerPhone ? ` · ${group.customerPhone}` : ''}</div>
                    </div>
                    <div className="order-card-price">
                      <span className="badge" style={{ background: '#d4a01720', color: '#d4a017' }}>PENDING BILL</span>
                      <div className="gold-text strong">{formatPrice(group.total)}</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 10 }}>
                    {group.orders.map((order) => (
                      <div key={order.id} style={{ border: '1px solid rgba(212,160,23,0.18)', borderRadius: 14, padding: 14 }}>
                        <div className="order-card-head">
                          <div>
                            <div className="gold-text strong">#{order.order_code}</div>
                            <div className="muted-small">{timeAgo(order.created_at)}</div>
                          </div>
                          <span className="badge" style={{ background: statusBadgeMap[order.status]?.bg, color: statusBadgeMap[order.status]?.color }}>
                            {statusBadgeMap[order.status]?.text || order.status}
                          </span>
                        </div>
                        <div className="order-items-copy">{(order.order_items || []).map((item) => `${item.item_name} ×${item.quantity}`).join(', ')}</div>
                        <div className="action-row">
                          {order.status === 'IN_KITCHEN' && (
                            <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'READY')} type="button">
                              Mark Ready
                            </button>
                          )}
                          {order.status === 'READY' && (
                            <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'SERVED')} type="button">
                              Mark Served
                            </button>
                          )}
                          {['IN_KITCHEN', 'READY', 'SERVED', 'CONFIRMED'].includes(order.status) && (
                            <button className="act-btn act-secondary" onClick={() => handlePrintKot(order)} type="button">
                              {order.status === 'SERVED' ? 'Reprint KOT' : 'Print KOT'}
                            </button>
                          )}
                          {order.status !== 'SERVED' && order.status !== 'COMPLETED' && (
                            <button className="act-btn act-danger" onClick={() => setRejectingOrderId(order.id)} type="button">
                              Cancel KOT
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="action-row" style={{ marginTop: 16 }}>
                    <button className="act-btn act-secondary" onClick={() => startAddMoreForTable(group)} type="button">
                      Add More Items
                    </button>
                    <button className="act-btn act-secondary" onClick={() => handlePrintBill(buildAggregatedBillOrder(group, 'Pending'))} type="button">
                      Print Final Bill
                    </button>
                    <button className="act-btn act-confirm" onClick={() => openBillingForTable(group)} type="button">
                      Close Table / Take Payment
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="filter-wrap">
              {['all', 'new', 'active', 'ready', 'completed'].map((filter) => (
                <button className={`filter-btn ${currentFilter === filter ? 'active' : ''}`} key={filter} onClick={() => setCurrentFilter(filter)} type="button">
                  {filter}
                </button>
              ))}
            </div>

            <div className="card">
              <div className="status-control-label" style={{ marginBottom: 12 }}>Outside Restaurant Orders</div>
              {loadingOrders && !deliveryOrders.length
                ? Array.from({ length: 3 }).map((_, index) => (
                    <div className="card dashboard-order-card skeleton-panel" key={`owner-order-skeleton-${index}`}>
                      <div className="skeleton-line wide" />
                      <div className="skeleton-line mid" />
                      <div className="skeleton-line wide" />
                      <div className="skeleton-line buttonish" />
                    </div>
                  ))
                : null}

              {filteredDeliveryOrders.map((order) => {
                const deliveryMeta = parseDeliveryAddress(order.delivery_address || '');
                const directionsUrl = getDirectionsUrl(deliveryMeta);

                return (
                  <div className="card" key={order.id} style={{ marginBottom: 16 }}>
                    <div className="order-card-head">
                      <div>
                        <h3 className="order-card-title">#{order.order_code}</h3>
                        <div className="muted-small">{timeAgo(order.created_at)}</div>
                        <span className="tiny-badge">DELIVERY</span>
                      </div>
                      <div className="order-card-price">
                        <span className="badge" style={{ background: statusBadgeMap[order.status]?.bg, color: statusBadgeMap[order.status]?.color }}>
                          {statusBadgeMap[order.status]?.text || order.status}
                        </span>
                        <div className="gold-text strong">{formatPrice(order.total)}</div>
                      </div>
                    </div>

                    <div className="muted-small">Customer: {order.customer_name} · {order.customer_phone}</div>
                    <div className="order-items-copy">{(order.order_items || []).map((item) => `${item.item_name} ×${item.quantity}`).join(', ')}</div>
                    {!!deliveryMeta.address && (
                      <div className="delivery-info-block">
                        <div className="muted-small">Address: {deliveryMeta.address}</div>
                        {!!directionsUrl && (
                          <a className="order-map-link" href={directionsUrl} rel="noreferrer" target="_blank">
                            Open in Maps
                          </a>
                        )}
                      </div>
                    )}
                    {order.status === 'OUT_FOR_DELIVERY' && order.delivery_people && (
                      <div className="muted-small">
                        Rider: {order.delivery_people.name} · {order.delivery_people.phone}
                      </div>
                    )}
                    {!!getRefundNote(order) && <div className="reason-note">{getRefundNote(order)}</div>}
                    {!!order.rejection_reason && <div className="reason-note">Reason: {order.rejection_reason}</div>}

                    {order.status === 'NEW' && (
                      <div className="action-row">
                        <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'IN_KITCHEN')} type="button">
                          Accept & Send to Kitchen
                        </button>
                        <button className="act-btn act-secondary" onClick={() => handlePrintKot({ ...order, status: 'IN_KITCHEN' })} type="button">
                          Print KOT
                        </button>
                        <button className="act-btn act-secondary" onClick={() => handlePrintBill(order)} type="button">
                          Print Bill
                        </button>
                        <button className="act-btn act-danger" onClick={() => setRejectingOrderId(order.id)} type="button">
                          Cancel Order
                        </button>
                      </div>
                    )}
                    {order.status === 'IN_KITCHEN' && (
                      <div className="action-row">
                        <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'READY')} type="button">
                          Mark Ready
                        </button>
                        <button className="act-btn act-secondary" onClick={() => handlePrintKot(order)} type="button">
                          Reprint KOT
                        </button>
                        <button className="act-btn act-danger" onClick={() => setRejectingOrderId(order.id)} type="button">
                          Cancel Order
                        </button>
                      </div>
                    )}
                    {order.status === 'READY' && (
                      <div className="action-row">
                        <select className="input-field" defaultValue="" id={`delivery-person-${order.id}`}>
                          <option value="">Select Rider</option>
                          {deliveryPeople.map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                        <button className="act-btn act-confirm" onClick={() => handleAssignDelivery(order.id, document.getElementById(`delivery-person-${order.id}`)?.value)} type="button">
                          Assign
                        </button>
                      </div>
                    )}
                    {order.status === 'OUT_FOR_DELIVERY' && (
                      <button className="act-btn act-confirm" onClick={() => handleStatusUpdate(order.id, 'COMPLETED')} type="button">
                        Mark Delivered
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="availability-bar">
              <span>
                Available: <strong>{managedItems.filter((item) => item.is_available).length}</strong>
              </span>
              <span>
                Unavailable: <strong>{managedItems.filter((item) => !item.is_available).length}</strong>
              </span>
            </div>

            <div className="filter-wrap">
              <button className={`filter-btn ${menuFilter === 'all' ? 'active' : ''}`} onClick={() => setMenuFilter('all')} type="button">
                All ({managedItems.length})
              </button>
              {menuCategories.map((category) => (
                <button className={`filter-btn ${menuFilter === category ? 'active' : ''}`} key={category} onClick={() => setMenuFilter(category)} type="button">
                  {category} ({managedItems.filter((item) => item.menu_categories?.name === category).length})
                </button>
              ))}
            </div>

            <div className="card">
              {loadingMenu && !managedItems.length
                ? Array.from({ length: 5 }).map((_, index) => (
                    <div className="menu-item-row" key={`menu-skeleton-${index}`}>
                      <div className="menu-item-thumb skeleton-img" />
                      <div className="menu-item-body">
                        <div className="skeleton-line wide" />
                        <div className="skeleton-line mid" />
                      </div>
                    </div>
                  ))
                : visibleMenuItems.map((item) => (
                    <div className="menu-item-row" key={item.id}>
                      <div className="menu-item-thumb">{item.image_url ? <img alt={item.name} src={item.image_url} /> : '🍽️'}</div>
                      <div className="menu-item-body">
                        <div className="menu-item-name">{item.name}</div>
                        <div className="muted-small">{item.menu_categories?.name || 'Other'}</div>
                        <div className={item.is_available ? 'available-text' : 'unavailable-text'}>● {item.is_available ? 'Available' : 'Unavailable'}</div>
                      </div>
                      <div className="menu-item-side">
                        <span className="gold-text strong">{formatPrice(item.price)}</span>
                        <label className="toggle-switch">
                          <input checked={item.is_available} onChange={(event) => handleToggleMenu(item.id, event.target.checked)} type="checkbox" />
                          <span className="toggle-slider" />
                        </label>
                      </div>
                    </div>
                  ))}
            </div>
          </>
        )}
      </main>

      {!!rejectingOrderId && (
        <div className="reject-overlay open">
          <div className="reject-box">
            <h3>Cancel this order?</h3>
            <p className="muted-small">If the customer has already paid online, a refund will be initiated automatically.</p>
            {['Restaurant issue', 'Item unavailable', 'Delivery not available now', 'Kitchen overloaded'].map((reason) => (
              <button className={`reason-option ${selectedReason === reason ? 'selected' : ''}`} key={reason} onClick={() => setSelectedReason(reason)} type="button">
                {reason}
              </button>
            ))}
            <div className="reject-actions">
              <button className="reject-cancel-btn" onClick={() => setRejectingOrderId('')} type="button">
                Cancel
              </button>
              <button className="reject-confirm-btn" disabled={!selectedReason} onClick={() => handleStatusUpdate(rejectingOrderId, 'CANCELLED', selectedReason)} type="button">
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {!!selectedBillingGroup && (
        <div className="reject-overlay open">
          <div className="reject-box">
            <h3>Close Table {selectedBillingGroup.tableNumber}</h3>
            <p className="muted-small">
              Choose how the customer paid, then print or close the final table bill.
            </p>
            {paymentMethods.map((method) => (
              <button className={`reason-option ${selectedPaymentMethod === method ? 'selected' : ''}`} key={method} onClick={() => setSelectedPaymentMethod(method)} type="button">
                {method}
              </button>
            ))}
            <div className="reason-note">Total: {formatPrice(selectedBillingGroup.total)}</div>
            <div className="reject-actions" style={{ flexWrap: 'wrap' }}>
              <button className="reject-cancel-btn" onClick={() => setBillingTableNumber('')} type="button">
                Cancel
              </button>
              <button className="act-btn act-secondary" onClick={() => handlePrintBill(buildAggregatedBillOrder(selectedBillingGroup, selectedPaymentMethod))} type="button">
                Print Final Bill
              </button>
              <button className="reject-confirm-btn" disabled={settlingTable} onClick={handleSettleCurrentTable} type="button">
                {settlingTable ? 'Closing...' : 'Mark Paid & Close Table'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
