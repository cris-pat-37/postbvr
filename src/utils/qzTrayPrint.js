import { formatTime } from './format.js';
import { parseDeliveryAddress } from './orderLocation.js';

const QZ_ENABLED = process.env.NEXT_PUBLIC_QZ_ENABLED === 'true';
const QZ_USE_SIGNING = process.env.NEXT_PUBLIC_QZ_USE_SIGNING === 'true';
const COUNTER_PRINTER_NAME = (process.env.NEXT_PUBLIC_QZ_COUNTER_PRINTER || '').trim();
const KITCHEN_PRINTER_NAME = (process.env.NEXT_PUBLIC_QZ_KITCHEN_PRINTER || '').trim();
const LINE_WIDTH = 42;

let qzModulePromise;
let securityConfigured = false;

const ESC = '\x1B';
const GS = '\x1D';

const wrapText = (value, width = LINE_WIDTH) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return [''];

  const words = text.split(' ');
  const lines = [];
  let current = '';

  words.forEach((word) => {
    if (!current) {
      current = word;
      return;
    }

    if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
      return;
    }

    lines.push(current);
    current = word;
  });

  if (current) {
    lines.push(current);
  }

  return lines;
};

const padLine = (left, right = '', width = LINE_WIDTH) => {
  const leftText = String(left || '');
  const rightText = String(right || '');
  const gap = Math.max(1, width - leftText.length - rightText.length);
  return `${leftText}${' '.repeat(gap)}${rightText}`;
};

const divider = '-'.repeat(LINE_WIDTH);

const getOrderMetaLine = (order) => {
  if (order.type === 'delivery') {
    const deliveryMeta = parseDeliveryAddress(order.delivery_address || '');
    return deliveryMeta.address || 'Delivery order';
  }

  return order.customer_name || `Table ${order.table_number || '-'}`;
};

const buildKotPayload = (order) => {
  const parts = [
    `${ESC}@`,
    `${ESC}a\x01`,
    `${GS}!\x11`,
    'KOT\n',
    `${GS}!\x00`,
    'Bangaru Vakili\n',
    `${ESC}E\x01`,
    'KITCHEN COPY\n',
    `${ESC}E\x00`,
    `${divider}\n`,
    `${ESC}a\x00`,
    `${padLine('Order', `#${order.order_code}`)}\n`,
    `${padLine('Time', formatTime(order.created_at))}\n`,
    `${padLine('Type', order.type === 'delivery' ? 'DELIVERY' : `TABLE ${order.table_number || '-'}`)}\n`,
    `${divider}\n`,
    'DETAILS\n',
    ...wrapText(getOrderMetaLine(order)).map((line) => `${line}\n`),
    `${divider}\n`,
    'ITEMS\n',
  ];

  (order.order_items || []).forEach((item) => {
    const itemLines = wrapText(item.item_name, LINE_WIDTH - 4);
    itemLines.forEach((line, index) => {
      parts.push(`${padLine(index === 0 ? line : `  ${line}`, index === 0 ? `x${item.quantity}` : '')}\n`);
    });
  });

  parts.push(`${divider}\n`, `${ESC}a\x01`, 'Prepared from BVR live order system\n', '\n\n\n', `${GS}V\x00`);
  return [parts.join('')];
};

const buildBillPayload = (order) => {
  const parts = [
    `${ESC}@`,
    `${ESC}a\x01`,
    `${GS}!\x11`,
    'BILL\n',
    `${GS}!\x00`,
    'Bangaru Vakili\n',
    `${ESC}E\x01`,
    'COUNTER COPY\n',
    `${ESC}E\x00`,
    `${divider}\n`,
    `${ESC}a\x00`,
    `${padLine('Order', `#${order.order_code}`)}\n`,
    `${padLine('Time', formatTime(order.created_at))}\n`,
    `${padLine('Type', order.type === 'delivery' ? 'DELIVERY' : `TABLE ${order.table_number || '-'}`)}\n`,
    `${divider}\n`,
    'ITEMS\n',
  ];

  (order.order_items || []).forEach((item) => {
    const unitPrice = Number(item.price_at_purchase ?? item.price ?? 0);
    const lineTotal = unitPrice * Number(item.quantity || 0);
    const itemLines = wrapText(item.item_name, 20);

    itemLines.forEach((line, index) => {
      if (index === 0) {
        parts.push(`${padLine(line, `x${item.quantity}`)}\n`);
      } else {
        parts.push(`${line}\n`);
      }
    });

    parts.push(`${padLine(`  @ ${unitPrice.toFixed(0)}`, lineTotal.toFixed(0))}\n`);
  });

  parts.push(
    `${divider}\n`,
    `${ESC}E\x01`,
    `${padLine('TOTAL', `${Number(order.total || 0).toFixed(0)}`)}\n`,
    `${ESC}E\x00`,
    `${padLine('Payment', order.payment_method || 'Online')}\n`,
    `${divider}\n`,
    `${ESC}a\x01`,
    'Thank you for ordering\n',
    '\n\n\n',
    `${GS}V\x00`,
  );

  return [parts.join('')];
};

const getQz = async () => {
  if (!qzModulePromise) {
    qzModulePromise = new Promise((resolve, reject) => {
      let attempts = 0;

      const check = () => {
        if (typeof window !== 'undefined' && window.qz) {
          resolve(window.qz);
          return;
        }

        attempts += 1;
        if (attempts >= 40) {
          reject(new Error('QZ Tray browser script did not load.'));
          return;
        }

        window.setTimeout(check, 150);
      };

      check();
    });
  }

  return qzModulePromise;
};

const configureSecurity = async (qz) => {
  if (securityConfigured) return;

  qz.security.setSignatureAlgorithm('SHA512');

  if (QZ_USE_SIGNING) {
    qz.security.setCertificatePromise((resolve, reject) => {
      fetch('/api/qz/certificate', { cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
          return response.text();
        })
        .then(resolve)
        .catch(reject);
    });

    qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
      fetch('/api/qz/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: toSign,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
          return response.text();
        })
        .then(resolve)
        .catch(reject);
    });
  }

  securityConfigured = true;
};

const ensureConnected = async (qz) => {
  await configureSecurity(qz);
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect();
  }
};

const resolvePrinterName = async (qz, preferredName) => {
  if (preferredName) {
    return qz.printers.find(preferredName);
  }

  return qz.printers.getDefault();
};

const createConfig = (qz, printer) =>
  qz.configs.create(printer, {
    copies: 1,
    forceRaw: true,
  });

export const printKotAndBill = async (order) => {
  if (typeof window === 'undefined' || !order || !QZ_ENABLED) {
    return { ok: false, code: 'disabled', reason: 'QZ printing is disabled.' };
  }

  try {
    const qz = await getQz();
    await ensureConnected(qz);

    const kitchenPrinter = await resolvePrinterName(qz, KITCHEN_PRINTER_NAME || COUNTER_PRINTER_NAME);
    const counterPrinter = await resolvePrinterName(qz, COUNTER_PRINTER_NAME || KITCHEN_PRINTER_NAME);

    if (!kitchenPrinter || !counterPrinter) {
      throw new Error('No printer was found through QZ Tray.');
    }

    await qz.print(createConfig(qz, kitchenPrinter), buildKotPayload(order));
    await qz.print(createConfig(qz, counterPrinter), buildBillPayload(order));

    return {
      ok: true,
      kitchenPrinter,
      counterPrinter,
    };
  } catch (error) {
    const message = error?.message || 'QZ Tray printing failed.';

    if (message.includes('browser script did not load')) {
      return { ok: false, code: 'script-missing', reason: 'QZ Tray browser script did not load.' };
    }

    if (message.includes('Unable to establish connection with QZ')) {
      return { ok: false, code: 'desktop-app-missing', reason: 'QZ Tray desktop app is not installed or not running.' };
    }

    if (message.includes('No printer')) {
      return { ok: false, code: 'printer-not-found', reason: 'No printer was found through QZ Tray.' };
    }

    return { ok: false, code: 'unknown', reason: message };
  }
};
