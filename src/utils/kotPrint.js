import { formatTime } from './format.js';
import { parseDeliveryAddress } from './orderLocation.js';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getOrderModeLabel = (order) => {
  if (order.type === 'delivery') return 'DELIVERY';
  return `DINE-IN${order.table_number ? ` / TABLE ${order.table_number}` : ''}`;
};

const getOrderMetaLine = (order) => {
  if (order.type === 'delivery') {
    const deliveryMeta = parseDeliveryAddress(order.delivery_address || '');
    return deliveryMeta.address || 'Delivery order';
  }

  return order.customer_name || 'Dine-in order';
};

export const buildKotMarkup = (order) => {
  const itemsMarkup = (order.order_items || [])
    .map(
      (item) => `
        <div class="item-row">
          <div class="item-name">${escapeHtml(item.item_name)}</div>
          <div class="item-qty">x${escapeHtml(item.quantity)}</div>
        </div>
      `,
    )
    .join('');

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>KOT ${escapeHtml(order.order_code)}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
            font-family: Arial, Helvetica, sans-serif;
            width: 80mm;
          }
          body { padding: 8px 8px 12px; }
          .center { text-align: center; }
          .title {
            font-size: 18px;
            font-weight: 800;
            letter-spacing: 1px;
          }
          .brand {
            margin-top: 4px;
            font-size: 13px;
            font-weight: 700;
          }
          .divider {
            border-top: 1px dashed #000;
            margin: 8px 0;
          }
          .row {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            font-size: 12px;
            line-height: 1.45;
          }
          .meta {
            font-size: 12px;
            line-height: 1.45;
            word-break: break-word;
          }
          .section-label {
            margin-top: 4px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .6px;
          }
          .item-row {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            padding: 4px 0;
            font-size: 13px;
            line-height: 1.35;
            border-bottom: 1px dotted #aaa;
          }
          .item-name {
            flex: 1;
            font-weight: 700;
            word-break: break-word;
          }
          .item-qty {
            min-width: 34px;
            text-align: right;
            font-weight: 700;
          }
          .footer {
            margin-top: 8px;
            font-size: 11px;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="center title">KOT</div>
        <div class="center brand">Bangaru Vakili</div>
        <div class="divider"></div>
        <div class="row"><strong>Order</strong><strong>#${escapeHtml(order.order_code)}</strong></div>
        <div class="row"><span>Time</span><span>${escapeHtml(formatTime(order.created_at))}</span></div>
        <div class="row"><span>Type</span><span>${escapeHtml(getOrderModeLabel(order))}</span></div>
        <div class="section-label">Order Details</div>
        <div class="meta">${escapeHtml(getOrderMetaLine(order))}</div>
        <div class="divider"></div>
        <div class="section-label">Items</div>
        ${itemsMarkup || '<div class="meta">No items found</div>'}
        <div class="divider"></div>
        <div class="footer">Prepared from BVR live order system</div>
      </body>
    </html>
  `;
};

export const printKotSlip = (order) => {
  if (typeof window === 'undefined' || !order) {
    return false;
  }

  const printWindow = window.open('', '_blank', 'width=420,height=720');
  if (!printWindow) {
    return false;
  }

  printWindow.document.open();
  printWindow.document.write(buildKotMarkup(order));
  printWindow.document.close();
  printWindow.focus();

  window.setTimeout(() => {
    printWindow.print();
  }, 300);

  return true;
};
