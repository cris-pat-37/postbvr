import { formatPrice, formatTime } from './format.js';
import { parseDeliveryAddress } from './orderLocation.js';

const RECEIPT_DETAILS = {
  name: process.env.NEXT_PUBLIC_RECEIPT_NAME || 'BANGARU VAKILI',
  subtitle: process.env.NEXT_PUBLIC_RECEIPT_SUBTITLE || 'FAMILY RESTAURANT',
  address: process.env.NEXT_PUBLIC_RECEIPT_ADDRESS || 'SHIVAJI NAGAR, NALGONDA',
  gstin: process.env.NEXT_PUBLIC_RECEIPT_GSTIN || '36ELLPP6523H1ZP',
  phone: process.env.NEXT_PUBLIC_RECEIPT_PHONE || '7337334474 / 9701054013',
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getOrderMetaLine = (order) => {
  if (order.type === 'delivery') {
    const deliveryMeta = parseDeliveryAddress(order.delivery_address || '');
    return deliveryMeta.address || 'Delivery order';
  }

  return order.customer_name || 'Dine-in order';
};

const getLineTotal = (item) => {
  const unitPrice = Number(item.price_at_purchase ?? item.price ?? 0);
  return unitPrice * Number(item.quantity || 0);
};

const getBillCopyLabel = (orderCode) => {
  if (typeof window === 'undefined') {
    return 'ORIGINAL COPY';
  }

  const storageKey = 'bvr_bill_print_counts_v1';
  let counts = {};

  try {
    counts = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
  } catch {
    counts = {};
  }

  const nextCount = Number(counts[orderCode] || 0) + 1;
  counts[orderCode] = nextCount;
  window.localStorage.setItem(storageKey, JSON.stringify(counts));

  return nextCount === 1 ? 'ORIGINAL COPY' : 'DUPLICATE COPY';
};

const formatReceiptDate = (isoString) => {
  try {
    return new Date(isoString).toLocaleDateString('en-GB').replace(/\//g, '-');
  } catch {
    return '--/--/----';
  }
};

export const buildBillMarkup = (order, qrUrl = '', copyLabel = 'ORIGINAL COPY') => {
  const itemsMarkup = (order.order_items || [])
    .map((item) => {
      const unitPrice = Number(item.price_at_purchase ?? item.price ?? 0);
      const lineTotal = getLineTotal(item);

      return `
        <tr>
          <td>${escapeHtml(item.item_name)}</td>
          <td class="num">${escapeHtml(item.quantity)}</td>
          <td class="num">${escapeHtml(formatPrice(unitPrice))}</td>
          <td class="num">${escapeHtml(formatPrice(lineTotal))}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Counter Bill ${escapeHtml(order.order_code)}</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
            font-family: "Courier New", Courier, monospace;
            width: 80mm;
            font-weight: 700;
          }
          body { padding: 8px 8px 12px; }
          .center { text-align: center; }
          .title {
            font-size: 18px;
            font-weight: 900;
            letter-spacing: .8px;
            text-transform: uppercase;
          }
          .brand {
            margin-top: 2px;
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
          }
          .subhead {
            margin-top: 2px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
          }
          .divider {
            border-top: 1px dashed #000;
            margin: 6px 0;
          }
          .row {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            font-size: 11px;
            line-height: 1.35;
            font-weight: 700;
          }
          .meta {
            font-size: 11px;
            line-height: 1.35;
            word-break: break-word;
            font-weight: 700;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            font-weight: 700;
          }
          th, td {
            padding: 4px 0;
            border-bottom: 1px dotted #999;
            vertical-align: top;
            font-weight: 700;
          }
          th { text-align: left; }
          .num { text-align: right; white-space: nowrap; }
          .summary {
            margin-top: 6px;
            font-size: 11px;
            font-weight: 700;
          }
          .summary-line {
            display: flex;
            justify-content: space-between;
            padding: 2px 0;
            font-weight: 700;
          }
          .total {
            font-size: 15px;
            font-weight: 900;
          }
          .qr-block {
            margin-top: 10px;
            text-align: center;
          }
          .qr-copy {
            font-size: 11px;
            font-weight: 700;
            margin-bottom: 4px;
          }
          .qr-subcopy {
            font-size: 10px;
            margin-bottom: 6px;
            font-weight: 700;
          }
          .qr-image {
            width: 128px;
            max-width: 100%;
            height: auto;
            display: inline-block;
          }
          .footer {
            margin-top: 8px;
            font-size: 11px;
            text-align: center;
            font-weight: 700;
            text-transform: uppercase;
          }
        </style>
      </head>
      <body>
        <div class="center title">${escapeHtml(RECEIPT_DETAILS.name)}</div>
        <div class="center brand">${escapeHtml(RECEIPT_DETAILS.subtitle)}</div>
        <div class="center subhead">${escapeHtml(RECEIPT_DETAILS.address)}</div>
        <div class="center subhead">GSTIN: ${escapeHtml(RECEIPT_DETAILS.gstin)}</div>
        <div class="center subhead">CELL: ${escapeHtml(RECEIPT_DETAILS.phone)}</div>
        <div class="divider"></div>
        <div class="center title">CASH / BILL</div>
        <div class="divider"></div>
        <div class="row">
          <span>${order.type === 'delivery' ? 'DELIVERY' : `TABLE ${escapeHtml(order.table_number || '000')}`}</span>
          <span>CUR 01</span>
          <span>WAITER 00</span>
        </div>
        <div class="row">
          <span>NO. ${escapeHtml(order.order_code)}</span>
          <span>DATE: ${escapeHtml(formatReceiptDate(order.created_at))}</span>
        </div>
        <div class="center brand">${escapeHtml(copyLabel)}</div>
        <div class="meta">${escapeHtml(getOrderMetaLine(order))}</div>
        <div class="divider"></div>
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th class="num">Qty</th>
              <th class="num">Rate</th>
              <th class="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemsMarkup || '<tr><td colspan="4">No items found</td></tr>'}
          </tbody>
        </table>
        <div class="summary">
          <div class="summary-line"><span>ITM</span><span>${escapeHtml(String((order.order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)))}</span></div>
          <div class="summary-line total"><span>TOTAL</span><span>${escapeHtml(formatPrice(order.total || 0))}</span></div>
          <div class="summary-line"><span>PAYMENT</span><span>${escapeHtml(order.payment_method || 'Online')}</span></div>
          <div class="summary-line"><span>TIME</span><span>${escapeHtml(formatTime(order.created_at))}</span></div>
        </div>
        <div class="divider"></div>
        ${
          qrUrl
            ? `
              <div class="qr-block">
                <div class="qr-copy">ORDER WITH US AGAIN</div>
                <div class="qr-subcopy">Scan to find Bangaru Vakili online</div>
                <img class="qr-image" src="${escapeHtml(qrUrl)}" alt="Bangaru Vakili ordering QR code" />
              </div>
              <div class="divider"></div>
            `
            : ''
        }
        <div class="footer">THANKS VISIT AGAIN</div>
      </body>
    </html>
  `;
};

export const printBillSlip = (order) => {
  if (typeof window === 'undefined' || !order) {
    return false;
  }

  const qrUrl = `${window.location.origin}/qrcode_bangaruvakili.com.png`;
  const copyLabel = getBillCopyLabel(order.order_code);
  const printWindow = window.open('', '_blank', 'width=420,height=820');
  if (!printWindow) {
    return false;
  }

  printWindow.document.open();
  printWindow.document.write(buildBillMarkup(order, qrUrl, copyLabel));
  printWindow.document.close();
  printWindow.focus();

  window.setTimeout(() => {
    printWindow.print();
  }, 300);

  return true;
};
