// ==========================================
//  ร้านหนังสือรัตน์ – Orders Portal orders.js
//  เชื่อมต่อ Supabase โดยตรง (จัดการออเดอร์)
// ==========================================

const SUPABASE_URL  = 'https://ueptjmsurtshpcldpxxp.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcHRqbXN1cnRzaHBjbGRweHhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NjQzNDIsImV4cCI6MjEwMjI0MDM0Mn0.lma8_ZDsRl35NHAFv7qWE7kF-wQeNGp_uYdHbfM1958';

let supabaseClient    = null;
let realtimeChannel   = null;
let allOrders         = [];
let lastFilteredOrders = [];
let lastFilteredOrderRows = [];
let activeDetailOrder = null;
let marketplaceImportState = null;
let marketplaceImports = { shopee: null, tiktok: null };
let currentOrdersTab = 'website';

const MARKETPLACE_CONFIG = {
  shopee: {
    label: 'Shopee',
    exportFilePrefix: 'orders-shopee',
    columns: [
      { key: 'orderNumber', header: 'หมายเลขคำสั่งซื้อ', aliases: ['หมายเลขคำสั่งซื้อ', 'เลขออเดอร์'] },
      { key: 'sku', header: 'เลขอ้างอิง SKU (SKU Reference No.) หรือ เลขอ้างอิง SKU', aliases: ['เลขอ้างอิง SKU (SKU Reference No.) หรือ เลขอ้างอิง SKU', 'เลขอ้างอิง SKU', 'SKU'] },
      { key: 'productName', header: 'ชื่อสินค้า', aliases: ['ชื่อสินค้า'] },
      { key: 'quantity', header: 'จำนวน', aliases: ['จำนวน', 'qty', 'quantity'] },
      { key: 'orderDate', header: 'วันที่ทำการสั่งซื้อ', aliases: ['วันที่ทำการสั่งซื้อ', 'วันที่สั่งซื้อ'] },
      { key: 'shipByDate', header: 'วันที่คาดว่าจะทำการจัดส่งสินค้า', aliases: ['วันที่คาดว่าจะทำการจัดส่งสินค้า', 'วันที่ต้องจัดส่ง'] },
      { key: 'trackingNumber', header: '*หมายเลขติดตามพัสดุ หรือ หมายเลขติดตามพัสดุ', aliases: ['*หมายเลขติดตามพัสดุ หรือ หมายเลขติดตามพัสดุ', 'หมายเลขติดตามพัสดุ', 'เลขพัสดุ'] },
      { key: 'paidTime', header: 'เวลาการชำระเงิน', aliases: ['เวลาการชำระเงิน', 'เวลาชำระเงิน'] },
      { key: 'price', header: 'จำนวนเงินทั้งหมด หรือ ยอดรวม', aliases: ['จำนวนเงินทั้งหมด หรือ ยอดรวม', 'ยอดรวม', 'ราคา'] },
      { key: 'shippingFee', header: 'ค่าจัดส่งที่ชำระโดยผู้ซื้อ', aliases: ['ค่าจัดส่งที่ชำระโดยผู้ซื้อ', 'ค่าจัดส่ง'] },
      { key: 'buyer', header: 'ชื่อผู้ใช้ (ผู้ซื้อ)', aliases: ['ชื่อผู้ใช้ (ผู้ซื้อ)', 'ผู้ซื้อ'] },
    ],
  },
  tiktok: {
    label: 'TikTok',
    exportFilePrefix: 'orders-tiktok',
    columns: [
      { key: 'orderNumber', header: 'Order ID', aliases: ['Order ID', 'เลขออเดอร์'] },
      { key: 'sku', header: 'Seller SKU', aliases: ['Seller SKU', 'SKU'] },
      { key: 'productName', header: 'Product Name', aliases: ['Product Name', 'ชื่อสินค้า'] },
      { key: 'quantity', header: 'Quantity', aliases: ['Quantity', 'จำนวน'] },
      { key: 'orderDate', header: 'Created Time', aliases: ['Created Time', 'วันที่สั่งซื้อ'] },
      { key: 'shipByDate', header: 'Paid Time', aliases: ['Paid Time', 'วันที่ต้องจัดส่ง'] },
      { key: 'trackingNumber', header: 'Tracking ID', aliases: ['Tracking ID', 'เลขพัสดุ'] },
      { key: 'paidTime', header: 'Paid Time', aliases: ['Paid Time', 'เวลาชำระเงิน'] },
      { key: 'price', header: 'SKU Subtotal After Discount', aliases: ['SKU Subtotal After Discount', 'ราคา'] },
      { key: 'shippingFee', header: 'Shipping Fee After Discount', aliases: ['Shipping Fee After Discount', 'ค่าจัดส่ง'] },
      { key: 'buyer', header: 'Buyer Username', aliases: ['Buyer Username', 'ผู้ซื้อ'] },
    ],
  },
};

// ── Helpers ──────────────────────────────────────────────────────

function safeText(val, fallback = '') {
  const text = typeof val === 'string' ? val : (val ?? fallback);
  return typeof text === 'string' ? decodeMojibake(text) : text;
}

function safeParseJson(val, fallback) {
  if (!val) return fallback;
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

function decodeMojibake(text) {
  if (typeof text !== 'string' || !text) return text;

  const suspicious =
    text.includes('à¸') ||
    text.includes('à¹') ||
    text.includes('Ã') ||
    text.includes('Â') ||
    text.includes('âˆ’');

  if (!suspicious) return text;

  try {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      bytes[i] = text.charCodeAt(i) & 0xFF;
    }
    const decoded = new TextDecoder('utf-8').decode(bytes);
    if (decoded && /[\u0E00-\u0E7F]/.test(decoded)) {
      return decoded;
    }
  } catch {}

  try {
    const decoded = decodeURIComponent(escape(text));
    if (decoded && /[\u0E00-\u0E7F]/.test(decoded)) {
      return decoded;
    }
  } catch {}

  return text
    .replaceAll('âˆ’', '-')
    .replaceAll('Â·', '·')
    .replaceAll('à¸¿', '฿');
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return dateStr; }
}

function formatAddressMultiLine(addrStr) {
  if (!addrStr || addrStr === '-') return '<span class="text-stone-400 text-[11px]">-</span>';

  // If address contains newlines, render formatted lines in card
  if (addrStr.includes('\n')) {
    const lines = addrStr.split('\n').filter(Boolean);
    return `
      <div class="mt-1.5 bg-stone-100/80 dark:bg-stone-800/60 p-2.5 rounded-xl border border-stone-200/60 dark:border-stone-700/60 text-[11px] space-y-0.5">
        ${lines.map(l => `<p class="text-stone-600 dark:text-stone-300 leading-snug">${safeText(l)}</p>`).join('')}
      </div>
    `;
  }

  // Split by space into house, subdistrict, district, province, postcode
  const parts = addrStr.trim().split(/\s+/);
  if (parts.length >= 2) {
    let postcode = '';
    if (parts.length > 0 && /^\d{5}$/.test(parts[parts.length - 1])) {
      postcode = parts.pop();
    }
    let province = parts.length > 0 ? parts.pop() : '';
    let district = parts.length > 0 ? parts.pop() : '';
    let subdistrict = parts.length > 0 ? parts.pop() : '';
    let house = parts.join(' ');

    const formatSub  = subdistrict ? (subdistrict.startsWith('ต.') || subdistrict.startsWith('ตำบล') || subdistrict.startsWith('แขวง') ? subdistrict : `ต.${subdistrict}`) : '';
    const formatDist = district ? (district.startsWith('อ.') || district.startsWith('เขต') ? district : `อ.${district}`) : '';
    const formatProv = province ? (province.startsWith('จ.') || province.startsWith('จังหวัด') ? province : `จ.${province}`) : '';

    return `
      <div class="mt-1.5 bg-stone-100/80 dark:bg-stone-800/60 p-2.5 rounded-xl border border-stone-200/60 dark:border-stone-700/60 text-[11px] space-y-0.5 shadow-2xs">
        ${house ? `<p class="font-bold text-stone-800 dark:text-stone-200 leading-tight">${safeText(house)}</p>` : ''}
        ${(formatSub || formatDist) ? `<p class="text-stone-600 dark:text-stone-300 leading-tight">${safeText(formatSub)} ${safeText(formatDist)}</p>` : ''}
        ${(formatProv || postcode) ? `<p class="text-stone-600 dark:text-stone-300 leading-tight">${safeText(formatProv)} <span class="font-mono font-semibold text-stone-500 dark:text-stone-400">${safeText(postcode)}</span></p>` : ''}
      </div>
    `;
  }

  return `
    <div class="mt-1.5 bg-stone-100/80 dark:bg-stone-800/60 p-2.5 rounded-xl border border-stone-200/60 dark:border-stone-700/60 text-[11px]">
      <p class="text-stone-600 dark:text-stone-300 leading-tight">${safeText(addrStr)}</p>
    </div>
  `;
}

function formatDateForExport(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('th-TH', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return safeText(dateStr, '');
  }
}

function formatCompactDate(dateStr) {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('th-TH', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return safeText(dateStr, '-');
  }
}

function getOrderItems(order) {
  if (Array.isArray(order?._items) && order._items.length) return order._items;
  const parsed = safeParseJson(order?.items, []);
  return Array.isArray(parsed) ? parsed : [];
}

function getOrderTrackingNumber(order) {
  return safeText(
    order?.tracking_number ||
    order?.tracking_id ||
    order?.tracking_no ||
    order?.shipping_tracking ||
    '',
    ''
  );
}

function getOrderShipByDate(order) {
  return order?.ship_by_date || order?.shipping_due_at || order?.delivery_due_at || order?.updated_at || order?.created_at || '';
}

function getOrderPaidTime(order) {
  return order?.paid_at || order?.payment_paid_at || (order?.payment_status === 'paid' ? (order?.updated_at || order?.created_at) : '') || '';
}

function getOrderShippingFee(order) {
  const raw = Number(order?.shipping_fee ?? order?.delivery_fee ?? order?.shipping_amount ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

function normalizeOrderRows(orders) {
  return (orders || []).flatMap((order) => {
    const items = getOrderItems(order);
    const sourceItems = items.length
      ? items
      : [{ product_name: '-', product_sku: '', quantity: 0, subtotal: order?.total_amount || 0, unit_price: order?.total_amount || 0 }];

    return sourceItems.map((item, index) => {
      const quantity = Number(item?.quantity ?? item?.qty ?? 0) || 0;
      const subtotal = Number(item?.subtotal ?? item?.unit_price * (quantity || 1) ?? 0) || 0;

      return {
        rowId: `${order.id}-${index}`,
        orderId: order.id,
        orderNumber: safeText(order.order_number, `#${order.id}`),
        sku: safeText(item?.product_sku || item?.sku || item?.seller_sku || '', '-'),
        productName: safeText(item?.product_name || item?.name || 'ไม่ระบุสินค้า'),
        quantity,
        orderDate: order.created_at || '',
        shipByDate: getOrderShipByDate(order),
        trackingNumber: getOrderTrackingNumber(order),
        paidTime: getOrderPaidTime(order),
        price: subtotal,
        shippingFee: getOrderShippingFee(order),
        buyer: safeText(order.customer_name, 'ลูกค้า'),
        phone: safeText(order.customer_phone, '-'),
        address: safeText(order.customer_address, '-'),
        note: safeText(order.note, ''),
        paymentMethod: safeText(order.payment_method, ''),
        paymentStatus: safeText(order.payment_status || 'pending', 'pending'),
        status: safeText(order.status || 'pending', 'pending'),
      };
    });
  });
}

function getMarketplaceColumns(platform) {
  return MARKETPLACE_CONFIG[platform]?.columns || [];
}

function getMarketplaceCellValue(row, columnKey) {
  switch (columnKey) {
    case 'orderNumber': return row.orderNumber;
    case 'sku': return row.sku;
    case 'productName': return row.productName;
    case 'quantity': return row.quantity;
    case 'orderDate': return formatDateForExport(row.orderDate);
    case 'shipByDate': return formatDateForExport(row.shipByDate);
    case 'trackingNumber': return row.trackingNumber;
    case 'paidTime': return formatDateForExport(row.paidTime);
    case 'price': return row.price;
    case 'shippingFee': return row.shippingFee;
    case 'buyer': return row.buyer;
    default: return '';
  }
}

function findImportedValue(row, aliases) {
  const entries = Object.entries(row || {});
  const aliasSet = aliases.map((alias) => String(alias).trim().toLowerCase());
  for (const [key, value] of entries) {
    if (aliasSet.includes(String(key).trim().toLowerCase())) {
      return value;
    }
  }
  return '';
}

function chunkArray(items, chunkSize = 200) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

async function saveMarketplaceImportToSupabase({ platform, file, sheetName, normalizedRows, rawRows }) {
  if (!supabaseClient) {
    throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');
  }

  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError) throw sessionError;

  const user = sessionData?.session?.user;
  if (!user) {
    throw new Error('กรุณาเข้าสู่ระบบแอดมินก่อนอัปโหลดไฟล์');
  }

  const batchPayload = {
    platform,
    file_name: file?.name || `${platform}-upload.xlsx`,
    file_size_bytes: Number(file?.size || 0),
    source_sheet_name: sheetName || '',
    row_count: normalizedRows.length,
    uploaded_by: user.id,
    uploaded_email: user.email || '',
  };

  const { data: batchRow, error: batchError } = await supabaseClient
    .from('marketplace_import_batches')
    .insert(batchPayload)
    .select('id')
    .single();

  if (batchError) throw batchError;

  if (!normalizedRows.length) {
    return batchRow.id;
  }

  const rowPayloads = normalizedRows.map((row, index) => ({
    batch_id: batchRow.id,
    platform,
    row_index: index + 1,
    order_number: safeText(row.orderNumber, ''),
    sku: safeText(row.sku, ''),
    product_name: safeText(row.productName, ''),
    quantity: safeText(row.quantity, ''),
    order_date: safeText(row.orderDate, ''),
    ship_by_date: safeText(row.shipByDate, ''),
    tracking_number: safeText(row.trackingNumber, ''),
    paid_time: safeText(row.paidTime, ''),
    price: safeText(row.price, ''),
    shipping_fee: safeText(row.shippingFee, ''),
    buyer: safeText(row.buyer, ''),
    raw_payload: rawRows?.[index] ?? row,
  }));

  const rowChunks = chunkArray(rowPayloads, 200);
  for (const chunk of rowChunks) {
    const { error: rowError } = await supabaseClient
      .from('marketplace_import_rows')
      .insert(chunk);

    if (rowError) throw rowError;
  }

  return batchRow.id;
}

async function loadMarketplaceImportData(platform, forceReload = false) {
  if (!supabaseClient || !['shopee', 'tiktok'].includes(platform)) return;
  if (!forceReload && marketplaceImports[platform]) {
    renderMarketplaceImportData(platform);
    return;
  }

  try {
    const { data: batches, error: batchError } = await supabaseClient
      .from('marketplace_import_batches')
      .select('*')
      .eq('platform', platform)
      .order('created_at', { ascending: false })
      .limit(1);

    if (batchError) throw batchError;

    const latestBatch = batches?.[0] || null;
    let rows = [];

    const { data: importRows, error: rowError } = await supabaseClient
      .from('marketplace_import_rows')
      .select('*')
      .eq('platform', platform)
      .order('batch_id', { ascending: false })
      .order('row_index', { ascending: true });

    if (rowError) throw rowError;
    rows = importRows || [];

    marketplaceImports[platform] = { batch: latestBatch, rows };
    renderMarketplaceImportData(platform);
  } catch (error) {
    console.error(`Load ${platform} import data error:`, error);
    showToast(`โหลดข้อมูล ${safeText(platform, '').toUpperCase()} ไม่สำเร็จ: ${error.message}`);
  }
}

function renderMarketplaceImportData(platform) {
  const summary = document.getElementById(`${platform}-import-summary`);
  const count = document.getElementById(`${platform}-import-count`);
  const tbody = document.getElementById(`${platform}-import-rows`);
  if (!summary || !count || !tbody) return;

  const state = marketplaceImports[platform];
  const batch = state?.batch;
  const rows = state?.rows || [];

  if (!batch) {
    summary.innerHTML = `ยังไม่มีข้อมูลอัปโหลด ${platform === 'shopee' ? 'Shopee' : 'TikTok'}`;
    count.textContent = '0 แถว';
    tbody.innerHTML = `<tr><td colspan="5" class="py-8 px-3 text-center text-stone-400">ยังไม่มีข้อมูลอัปโหลด ${platform === 'shopee' ? 'Shopee' : 'TikTok'}</td></tr>`;
    return;
  }

  summary.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      <div class="rounded-2xl border border-stone-200/70 dark:border-stone-800/70 bg-white/80 dark:bg-stone-950/60 px-4 py-3">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.18em] text-stone-400">ไฟล์</p>
        <p class="mt-1 text-sm font-bold text-stone-700 dark:text-stone-200 break-all">${safeText(batch.file_name, '-')}</p>
      </div>
      <div class="rounded-2xl border border-stone-200/70 dark:border-stone-800/70 bg-white/80 dark:bg-stone-950/60 px-4 py-3">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.18em] text-stone-400">อัปโหลดโดย</p>
        <p class="mt-1 text-sm font-bold text-stone-700 dark:text-stone-200 break-all">${safeText(batch.uploaded_email || '-', '-')}</p>
      </div>
      <div class="rounded-2xl border border-stone-200/70 dark:border-stone-800/70 bg-white/80 dark:bg-stone-950/60 px-4 py-3">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.18em] text-stone-400">วันเวลา</p>
        <p class="mt-1 text-sm font-bold text-stone-700 dark:text-stone-200">${formatDate(batch.created_at)}</p>
      </div>
      <div class="rounded-2xl border border-stone-200/70 dark:border-stone-800/70 bg-white/80 dark:bg-stone-950/60 px-4 py-3">
        <p class="text-[10px] font-extrabold uppercase tracking-[0.18em] text-stone-400">จำนวน</p>
        <p class="mt-1 text-sm font-bold text-stone-700 dark:text-stone-200">${Number(batch.row_count || 0).toLocaleString()} แถว</p>
      </div>
    </div>
  `;

  count.textContent = `${rows.length.toLocaleString()} แถว`;
  tbody.innerHTML = rows.length
    ? rows.map((row) => `
        <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition">
          <td class="py-3 px-3 align-top font-semibold text-stone-700 dark:text-stone-200">${safeText(row.order_number, '-')}</td>
          <td class="py-3 px-3 align-top font-mono text-stone-500 dark:text-stone-300">${safeText(row.sku, '-')}</td>
          <td class="py-3 px-3 align-top text-stone-700 dark:text-stone-200">${safeText(row.product_name, '-')}</td>
          <td class="py-3 px-3 align-top text-center text-stone-700 dark:text-stone-200">${safeText(row.quantity, '-')}</td>
          <td class="py-3 px-3 align-top text-stone-700 dark:text-stone-200">${safeText(row.buyer, '-')}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="5" class="py-8 px-3 text-center text-stone-400">ไม่พบข้อมูลรายการจากไฟล์ล่าสุด</td></tr>`;
}

function setupOrdersTableHeaders() {
  const headRow = document.querySelector('#orders-table-wrapper thead tr');
  if (!headRow) return;
  headRow.innerHTML = `
    <th class="py-3.5 px-4">เลขออเดอร์</th>
    <th class="py-3.5 px-4">SKU</th>
    <th class="py-3.5 px-4">ชื่อสินค้า</th>
    <th class="py-3.5 px-4 text-center">จำนวน</th>
    <th class="py-3.5 px-4">วันที่สั่งซื้อ</th>
    <th class="py-3.5 px-4">วันที่ต้องจัดส่ง</th>
    <th class="py-3.5 px-4">เลขพัสดุ</th>
    <th class="py-3.5 px-4">เวลาชำระเงิน</th>
    <th class="py-3.5 px-4 text-right">ราคา</th>
    <th class="py-3.5 px-4 text-right">ค่าจัดส่ง</th>
    <th class="py-3.5 px-4">ผู้ซื้อ</th>
    <th class="py-3.5 px-4 text-center">จัดการ</th>
  `;
}

// ── Theme ────────────────────────────────────────────────────────

function initTheme() {
  const stored = localStorage.getItem('theme');
  const isDark = stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function isAllowedAdminSession(session) {
  const appMeta = session?.user?.app_metadata || {};
  const role = String(appMeta.role || '').trim().toLowerCase();
  const roles = Array.isArray(appMeta.roles)
    ? appMeta.roles.map((item) => String(item).trim().toLowerCase())
    : [];

  return role === 'admin' || roles.includes('admin');
}

// ── Supabase Init & Realtime ──────────────────────────────────────

function initSupabase() {
  if (!window.supabase) {
    console.error('Supabase SDK ยังไม่โหลด');
    return false;
  }
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    subscribeRealtime();
    console.log('Orders Supabase connected:', SUPABASE_URL);
    return true;
  } catch (err) {
    console.error('Supabase init error:', err);
    return false;
  }
}

function subscribeRealtime() {
  if (!supabaseClient) return;
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel = supabaseClient
    .channel('orders-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, payload => {
      console.log('Orders Realtime change:', payload.eventType);
      showToast('มีการอัปเดตคำสั่งซื้อใหม่ในระบบ');
      loadOrders(true);
    })
    .subscribe();
}

// ── Load Orders ───────────────────────────────────────────────────

async function loadOrders(isSilent = false) {
  const spinner = document.getElementById('orders-loading');
  const wrapper = document.getElementById('orders-table-wrapper');
  const empty   = document.getElementById('orders-empty');

  if (!isSilent) {
    spinner?.classList.remove('hidden');
    wrapper?.classList.add('hidden');
    empty?.classList.add('hidden');
  }

  if (!supabaseClient) {
    spinner?.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }

  try {
    // ดึง orders และ order_items พร้อมกัน
    const [ordersRes, itemsRes] = await Promise.all([
      supabaseClient.from('orders').select('*').order('id', { ascending: false }),
      supabaseClient.from('order_items').select('*')
    ]);

    if (ordersRes.error) throw ordersRes.error;

    const orders = ordersRes.data || [];
    const items  = itemsRes.data  || [];

    // แนบ _items เข้ากับแต่ละออเดอร์
    const itemsByOrder = {};
    items.forEach(item => {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push(item);
    });
    orders.forEach(o => { o._items = itemsByOrder[o.id] || []; });

    allOrders = orders;
    if (!isSilent) spinner?.classList.add('hidden');

    updateSummaryStats();
    filterOrders();
  } catch (err) {
    console.error('Error loading orders:', err);
    if (!isSilent) spinner?.classList.add('hidden');
    showToast('โหลดคำสั่งซื้อผิดพลาด: ' + err.message);
  }
}

function updateSummaryStats() {
  const total   = allOrders.length;
  const pending = allOrders.filter(o => o.status === 'pending').length;
  const done    = allOrders.filter(o => o.status === 'confirmed' || o.status === 'shipped' || o.status === 'done').length;

  const totalRevenue = allOrders
    .filter(o => o.status !== 'cancelled')
    .reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);

  document.getElementById('stat-total-orders').textContent   = total;
  document.getElementById('stat-pending-orders').textContent = pending;
  document.getElementById('stat-done-orders').textContent    = done;
  document.getElementById('stat-revenue').textContent        = '฿' + totalRevenue.toLocaleString();
}

// ── Filter & Render Orders Table ──────────────────────────────────

function clearDateFilter() {
  const start = document.getElementById('order-date-start');
  const end   = document.getElementById('order-date-end');
  if (start) start.value = '';
  if (end) end.value = '';
  filterOrders();
}

function filterOrders() {
  const search    = document.getElementById('order-search')?.value.toLowerCase().trim() || '';
  const status    = document.getElementById('order-status-filter')?.value || 'all';
  const pay       = document.getElementById('order-payment-filter')?.value || 'all';
  const slip      = document.getElementById('order-slip-filter')?.value || 'all';
  const startDate = document.getElementById('order-date-start')?.value || '';
  const endDate   = document.getElementById('order-date-end')?.value || '';

  const filtered = allOrders.filter(o => {
    const num   = safeText(o.order_number).toLowerCase();
    const name  = safeText(o.customer_name).toLowerCase();
    const phone = safeText(o.customer_phone).toLowerCase();
    const note  = safeText(o.note).toLowerCase();

    if (search && !num.includes(search) && !name.includes(search) && !phone.includes(search) && !note.includes(search)) {
      return false;
    }

    if (status !== 'all' && o.status !== status) return false;

    if (pay !== 'all' && o.payment_method !== pay) return false;

    if (slip !== 'all') {
      const pStatus = o.payment_status || 'pending';
      if (pStatus !== slip) return false;
    }

    // กรองตามวันที่ (YYYY-MM-DD)
    if (o.created_at) {
      const orderDate = new Date(o.created_at).toISOString().split('T')[0];
      if (startDate && orderDate < startDate) return false;
      if (endDate && orderDate > endDate) return false;
    }

    return true;
  });

  // เรียงลำดับ:
  // 1. สถานะออเดอร์: pending → confirmed → shipped → done → cancelled
  // 2. ในกลุ่มเดียวกัน: สลิปรอตรวจ → อนุมัติแล้ว → ไม่อนุมัติ (ล่างสุด)
  const statusPriority  = { pending: 0, confirmed: 1, shipped: 2, done: 3, cancelled: 4 };
  const payPriority     = { pending: 0, paid: 1, failed: 2 };
  filtered.sort((a, b) => {
    const sa = statusPriority[a.status] ?? 5;
    const sb = statusPriority[b.status] ?? 5;
    if (sa !== sb) return sa - sb;

    const pa = payPriority[a.payment_status] ?? 0;
    const pb = payPriority[b.payment_status] ?? 0;
    if (pa !== pb) return pa - pb;

    // ถ้าเท่ากันทุกอย่าง เรียงออเดอร์ใหม่สุดก่อน
    return b.id - a.id;
  });

  lastFilteredOrders = filtered;
  renderOrdersTable(filtered);
}

function exportOrdersToExcel() {
  const sourceOrders = lastFilteredOrders.length ? lastFilteredOrders : allOrders;

  if (!sourceOrders.length) {
    showToast('ไม่มีรายการคำสั่งซื้อให้ส่งออก');
    return;
  }

  if (!window.XLSX) {
    showToast('ไม่พบเครื่องมือสำหรับสร้างไฟล์ Excel');
    return;
  }

  const exportRows = sourceOrders.map((order, index) => {
    const items = Array.isArray(order.items) ? order.items : safeParseJson(order.items, []);
    const productSummary = (Array.isArray(items) ? items : [])
      .map((item) => {
        const name = safeText(item?.product_name, 'ไม่ระบุสินค้า');
        const qty = Number(item?.qty ?? item?.quantity ?? 1);
        return `${name} x${qty}`;
      })
      .join(' | ');

    const totalAmount = Number(order.total_amount ?? order.total ?? 0);
    const paymentStatus = order.payment_status || 'pending';
    const orderStatus = order.status || 'pending';

    return {
      'ลำดับ': index + 1,
      'เลขคำสั่งซื้อ': safeText(order.order_number, `#${order.id}`),
      'วันที่สั่งซื้อ': order.created_at ? new Date(order.created_at).toLocaleString('th-TH') : '',
      'ชื่อลูกค้า': safeText(order.customer_name, '-'),
      'เบอร์โทร': safeText(order.customer_phone, '-'),
      'ที่อยู่จัดส่ง': safeText(order.customer_address, '-'),
      'หมายเหตุ': safeText(order.note, ''),
      'รายการสินค้า': productSummary,
      'ช่องทางชำระ': order.payment_method === 'line' || order.payment_method === 'promptpay' ? 'แอดมิน (Line)' : order.payment_method === 'cod' ? 'เก็บเงินปลายทาง' : safeText(order.payment_method, '-'),
      'สถานะสลิป': paymentStatus === 'paid' ? 'อนุมัติแล้ว' : paymentStatus === 'failed' ? 'ไม่อนุมัติ' : 'รอตรวจสอบ',
      'สถานะออเดอร์': orderStatus,
      'ยอดรวม (บาท)': totalAmount,
    };
  });

  const worksheet = window.XLSX.utils.json_to_sheet(exportRows);
  worksheet['!cols'] = [
    { wch: 8 },
    { wch: 20 },
    { wch: 24 },
    { wch: 24 },
    { wch: 16 },
    { wch: 38 },
    { wch: 24 },
    { wch: 52 },
    { wch: 20 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
  ];

  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders');

  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  window.XLSX.writeFile(workbook, `orders-export-${stamp}.xlsx`);
  showToast(`ส่งออกคำสั่งซื้อ ${exportRows.length} รายการเป็นไฟล์ Excel แล้ว`);
}

window.exportOrdersToExcel = exportOrdersToExcel;

function getStatusBadge(status) {
  switch (status) {
    case 'pending':
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300">
                <i class="fas fa-clock text-[9px]"></i> รอตรวจสอบ
              </span>`;
    case 'confirmed':
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300">
                <i class="fas fa-check text-[9px]"></i> ยืนยันแล้ว
              </span>`;
    case 'shipped':
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300">
                <i class="fas fa-truck-fast text-[9px]"></i> จัดส่งแล้ว
              </span>`;
    case 'done':
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
                <i class="fas fa-circle-check text-[9px]"></i> เสร็จสิ้น
              </span>`;
    case 'cancelled':
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400">
                <i class="fas fa-circle-xmark text-[9px]"></i> ยกเลิก
              </span>`;
    default:
      return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-stone-100 text-stone-600">${status}</span>`;
  }
}

function renderOrdersTable(list) {
  const wrapper = document.getElementById('orders-table-wrapper');
  const empty   = document.getElementById('orders-empty');
  const tbody   = document.getElementById('orders-rows');

  if (list.length === 0) {
    wrapper?.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  wrapper?.classList.remove('hidden');

  tbody.innerHTML = list.map(order => {
    const orderNum  = order.order_number || `#${order.id}`;
    const dateStr   = formatDate(order.created_at);
    const name      = safeText(order.customer_name, 'ลูกค้า');
    const phone     = safeText(order.customer_phone, '-');
    const address   = safeText(order.customer_address, '-');
    const total     = parseFloat(order.total_amount || 0).toLocaleString();
    const isLine  = order.payment_method === 'line' || order.payment_method === 'promptpay';

    const payBadge  = isLine
      ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/50 px-2 py-0.5 rounded-md border border-sky-200 dark:border-sky-800">
           <i class="fas fa-qrcode text-[9px]"></i> แอดมิน (Line)
         </span>`
      : `<span class="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md border border-amber-200 dark:border-amber-800">
           <i class="fas fa-hand-holding-dollar text-[9px]"></i> COD
         </span>`;

    // คอลัมน์สถานะสลิป / ดูรูปสลิป / ปุ่มอนุมัติด่วน
    let slipUrl = order.payment_slip_path || '';
    if (slipUrl && !slipUrl.startsWith('http') && !slipUrl.startsWith('data:')) {
      slipUrl = `${SUPABASE_URL}/storage/v1/object/public/payment-slips/${slipUrl}`;
    }

    let slipColCell = '';
    if (!isLine) {
      slipColCell = `<span class="text-stone-400 text-[10px] font-medium">- เก็บปลายทาง -</span>`;
    } else {
      const slipImgHtml = slipUrl
        ? `<img src="${slipUrl}" alt="สลิป" onclick="openSlipModalWithUrl('${slipUrl}', ${order.id})" title="คลิกเพื่อดูสลิปรูปใหญ่" class="w-12 h-12 object-cover rounded-xl border border-stone-200 dark:border-stone-700 cursor-pointer hover:scale-105 hover:shadow-md transition shrink-0 bg-stone-100 dark:bg-stone-800">`
        : `<div class="w-12 h-12 rounded-xl bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-center text-stone-400 text-[10px] shrink-0" title="ไม่มีภาพสลิป"><i class="fas fa-image opacity-60"></i></div>`;

      let statusActionHtml = '';
      if (order.payment_status === 'paid') {
        statusActionHtml = `
          <span class="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-lg text-[10px] font-bold">
            <i class="fas fa-check-circle text-emerald-500"></i> อนุมัติแล้ว
          </span>
        `;
      } else if (order.payment_status === 'failed') {
        statusActionHtml = `
          <span class="inline-flex items-center gap-1 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded-lg text-[10px] font-bold">
            <i class="fas fa-circle-xmark text-rose-500"></i> ไม่อนุมัติ
          </span>
        `;
      } else {
        statusActionHtml = `
          <div class="flex flex-col gap-1 w-full">
            <button onclick="quickApproveSlip(${order.id})" title="อนุมัติสลิป" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] px-2 py-1 rounded-lg shadow-sm transition flex items-center justify-center gap-1">
              <i class="fas fa-check"></i> อนุมัติ
            </button>
            <button onclick="quickRejectSlip(${order.id})" title="ไม่อนุมัติสลิป" class="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] px-2 py-1 rounded-lg shadow-sm transition flex items-center justify-center gap-1">
              <i class="fas fa-times"></i> ปฏิเสธ
            </button>
          </div>
        `;
      }

      slipColCell = `
        <div class="flex flex-col items-center justify-center gap-1.5 py-1">
          ${slipImgHtml}
          ${statusActionHtml}
        </div>
      `;
    }

    return `
      <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
        <!-- Order Number & Date -->
        <td class="py-3.5 px-4">
          <p class="font-extrabold text-stone-900 dark:text-stone-100 font-sans text-xs hover:text-primary transition cursor-pointer" onclick="openOrderDetailModal(${order.id})">${orderNum}</p>
          <p class="text-[10px] text-stone-400 mt-0.5">${dateStr}</p>
        </td>

        <!-- Customer Info -->
        <td class="py-3.5 px-4 min-w-[200px]">
          <div class="flex items-center gap-1.5 font-extrabold text-stone-900 dark:text-stone-100 text-xs">
            <i class="fas fa-user-circle text-primary dark:text-amber-400 text-[12px]"></i>
            <span>${name}</span>
          </div>
          <div class="text-[10px] font-mono text-stone-500 dark:text-stone-400 flex items-center gap-1.5 mt-0.5">
            <i class="fas fa-phone text-[9px] opacity-60"></i>
            <span>${phone}</span>
          </div>
          ${formatAddressMultiLine(order.customer_address)}
        </td>

        <!-- Items List -->
        <td class="py-3.5 px-4 min-w-[200px]">
          ${(order._items || []).length === 0
            ? `<span class="text-stone-400 text-[10px]">-</span>`
            : (order._items || []).map(item => `
                <div class="flex items-start justify-between gap-2 py-0.5">
                  <span class="text-[11px] text-stone-800 dark:text-stone-200 leading-snug flex-1">
                    <span class="font-semibold">${safeText(item.product_name)}</span>
                    <span class="text-stone-400 ml-1">x${item.quantity}</span>
                  </span>
                  <span class="text-[11px] font-bold text-primary dark:text-amber-300 shrink-0 font-sans">
                    ฿${parseFloat(item.subtotal || item.unit_price * item.quantity || 0).toLocaleString()}
                  </span>
                </div>
              `).join('')
          }
        </td>

        <!-- Payment Method -->
        <td class="py-3.5 px-4 text-center">
          ${payBadge}
        </td>

        <!-- Total Amount -->
        <td class="py-3.5 px-4 text-right font-black text-primary dark:text-amber-300 font-sans text-sm">
          ฿${total}
        </td>

        <!-- Slip Approval Column -->
        <td class="py-3.5 px-4 text-center">
          ${slipColCell}
        </td>

        <!-- Quick Status Change -->
        <td class="py-3.5 px-4 text-center">
          <div class="inline-block">
            <select onchange="quickUpdateOrderStatus(${order.id}, this.value)" class="inp text-[11px] font-bold py-1 px-2.5 cursor-pointer">
              <option value="pending"   ${order.status === 'pending'   ? 'selected' : ''}>⏳ รอตรวจสอบ</option>
              <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>✅ ยืนยันแล้ว</option>
              <option value="shipped"   ${order.status === 'shipped'   ? 'selected' : ''}>🚚 จัดส่งแล้ว</option>
              <option value="done"      ${order.status === 'done'      ? 'selected' : ''}>🎉 เสร็จสิ้น</option>
              <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>❌ ยกเลิก</option>
            </select>
          </div>
        </td>

        <!-- Actions -->
        <td class="py-3.5 px-4 text-center">
          <div class="flex flex-col gap-1.5 items-center">
            <button onclick="openEditOrderModal(${order.id})" class="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold shadow-sm transition flex items-center justify-center gap-1">
              <i class="fas fa-pen-to-square"></i> แก้ไข
            </button>
            <button onclick="printShippingLabel(${order.id})" class="btn-primary px-3 py-1.5 text-[10px] font-bold shadow-sm flex items-center justify-center gap-1">
              <i class="fas fa-print"></i> พิมพ์ใบ
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

let activeEditOrder = null;

function openEditOrderModal(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || !supabaseClient) return;

  activeEditOrder = order;
  const numberEl = document.getElementById('edit-order-number');
  const trackingEl = document.getElementById('edit-order-tracking');
  const nameEl = document.getElementById('edit-order-name');
  const phoneEl = document.getElementById('edit-order-phone');
  const addressEl = document.getElementById('edit-order-address');
  const noteEl = document.getElementById('edit-order-note');
  const paymentEl = document.getElementById('edit-order-payment-method');
  const paymentStatusEl = document.getElementById('edit-order-payment-status');
  const shipByDateEl = document.getElementById('edit-order-ship-by-date');
  const shippingFeeEl = document.getElementById('edit-order-shipping-fee');
  const statusEl = document.getElementById('edit-order-status');

  if (numberEl) numberEl.value = order.order_number || '';
  if (trackingEl) trackingEl.value = order.tracking_number || '';
  if (nameEl) nameEl.value = order.customer_name || '';
  if (phoneEl) phoneEl.value = order.customer_phone || '';
  if (addressEl) addressEl.value = order.customer_address || '';
  if (noteEl) noteEl.value = order.note || '';
  if (paymentEl) paymentEl.value = order.payment_method === 'cod' ? 'cod' : 'line';
  if (paymentStatusEl) paymentStatusEl.value = order.payment_status || 'pending';
  if (shipByDateEl) shipByDateEl.value = order.ship_by_date ? String(order.ship_by_date).slice(0, 10) : '';
  if (shippingFeeEl) shippingFeeEl.value = Number(order.shipping_fee ?? 0);
  if (statusEl) statusEl.value = order.status || 'pending';

  document.getElementById('order-edit-modal')?.classList.remove('hidden');
}

function closeEditOrderModal() {
  activeEditOrder = null;
  document.getElementById('order-edit-modal')?.classList.add('hidden');
}

async function saveEditedOrder() {
  if (!activeEditOrder || !supabaseClient) return;

  const orderNumber = document.getElementById('edit-order-number')?.value.trim() || activeEditOrder.order_number || '';
  const trackingNumber = document.getElementById('edit-order-tracking')?.value.trim() || null;
  const customerName = document.getElementById('edit-order-name')?.value.trim() || '';
  const customerPhone = document.getElementById('edit-order-phone')?.value.trim() || '';
  const customerAddress = document.getElementById('edit-order-address')?.value.trim() || '';
  const note = document.getElementById('edit-order-note')?.value.trim() || '';
  const paymentMethod = document.getElementById('edit-order-payment-method')?.value || 'line';
  const paymentStatus = document.getElementById('edit-order-payment-status')?.value || 'pending';
  const shipByDate = document.getElementById('edit-order-ship-by-date')?.value || null;
  const shippingFeeValue = document.getElementById('edit-order-shipping-fee')?.value;
  const shippingFee = shippingFeeValue === '' || shippingFeeValue === null ? 0 : Number(shippingFeeValue);
  const status = document.getElementById('edit-order-status')?.value || 'pending';

  if (!customerName || !customerPhone || !customerAddress) {
    showToast('กรุณากรอก ชื่อ, เบอร์โทร และที่อยู่จัดส่ง ให้ครบก่อนบันทึก');
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('orders')
      .update({
        order_number: orderNumber,
        tracking_number: trackingNumber,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_address: customerAddress,
        note: note || null,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        ship_by_date: shipByDate,
        shipping_fee: Number.isFinite(shippingFee) ? shippingFee : 0,
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', activeEditOrder.id);

    if (error) throw error;

    Object.assign(activeEditOrder, {
      order_number: orderNumber,
      tracking_number: trackingNumber,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: customerAddress,
      note: note || null,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      ship_by_date: shipByDate,
      shipping_fee: Number.isFinite(shippingFee) ? shippingFee : 0,
      status
    });

    filterOrders();
    updateSummaryStats();
    closeEditOrderModal();
    const openModal = document.getElementById('order-detail-modal');
    if (openModal && !openModal.classList.contains('hidden') && activeDetailOrder && activeDetailOrder.id === activeEditOrder.id) {
      openOrderDetailModal(activeEditOrder.id);
    }
    showToast('บันทึกข้อมูลคำสั่งซื้อเรียบร้อยแล้ว');
  } catch (err) {
    console.error('Save order edit error:', err);
    showToast('บันทึกข้อมูลไม่สำเร็จ: ' + (err.message || 'เกิดข้อผิดพลาด'));
  }
}

async function deleteOrder(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const confirmText = `${order.order_number || `#${orderId}`}\n\nยืนยันการลบคำสั่งซื้อนี้หรือไม่? การลบจะทำให้ข้อมูลออเดอร์และรายการสินค้าในออเดอร์นี้ถูกลบไปเลย และไม่สามารถกู้คืนได้.`;
  const confirmed = window.confirm(confirmText);
  if (!confirmed) return;

  try {
    const { error: itemsErr } = await supabaseClient
      .from('order_items')
      .delete()
      .eq('order_id', orderId);

    if (itemsErr) throw itemsErr;

    const { error } = await supabaseClient
      .from('orders')
      .delete()
      .eq('id', orderId);

    if (error) throw error;

    allOrders = allOrders.filter(item => item.id !== orderId);
    filterOrders();
    updateSummaryStats();

    if (activeDetailOrder?.id === orderId) {
      closeOrderDetailModal();
    }
    closeEditOrderModal();
    showToast(`ลบคำสั่งซื้อ ${order.order_number || `#${orderId}`} แล้ว`);
  } catch (err) {
    console.error('Delete order error:', err);
    showToast('ลบคำสั่งซื้อไม่สำเร็จ: ' + (err.message || 'เกิดข้อผิดพลาด'));
  }
}

// ── Print Shipping Label ─────────────────────────────────────────

function printShippingLabel(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const items = (order._items || []).map(item =>
    `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;">${safeText(item.product_name)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">฿${parseFloat(item.subtotal || item.unit_price * item.quantity || 0).toLocaleString()}</td>
    </tr>`
  ).join('');

  const payMethod = { line: 'แอดมิน (Line)', promptpay: 'แอดมิน (Line)', cod: 'เก็บเงินปลายทาง', bank_transfer: 'โอนเงิน' };
  const dateStr = order.created_at ? new Date(order.created_at).toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' }) : '-';

  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>ใบส่งพัสดุ ${safeText(order.order_number)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%;
      min-height: 100vh;
      background: #f1f5f9;
      font-family: 'Sarabun', sans-serif;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 30px 15px;
    }
    .label {
      background: #fff;
      width: 125mm;
      max-width: 95%;
      min-height: 155mm;
      border: 2px solid #0f172a;
      border-radius: 14px;
      padding: 22px;
      box-shadow: 0 15px 35px rgba(15, 23, 42, 0.12);
      margin: auto;
    }
    .header { text-align: center; border-bottom: 2px dashed #cbd5e1; padding-bottom: 12px; margin-bottom: 14px; }
    .header .shop-name { font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: 0.5px; }
    .header .order-num { font-size: 12px; color: #64748b; margin-top: 3px; font-weight: 600; }
    .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px; margin-bottom: 6px; }
    .to-box { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-bottom: 14px; }
    .to-box .name { font-size: 17px; font-weight: 800; color: #0f172a; }
    .to-box .phone { font-size: 13px; color: #334155; margin-top: 4px; font-weight: 600; }
    .to-box .address { font-size: 12px; color: #334155; margin-top: 6px; line-height: 1.5; }
    .items-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 14px; }
    .items-table th { background: #0f172a; color: #fff; padding: 7px 10px; text-align: left; font-size: 11px; font-weight: 700; }
    .items-table td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }
    .items-table th:nth-child(2), .items-table td:nth-child(2) { text-align:center; }
    .items-table th:nth-child(3), .items-table td:nth-child(3) { text-align:right; }
    .total-row { display:flex; justify-content:space-between; align-items:center; border-top: 2px solid #0f172a; padding-top: 10px; margin-top: 6px; }
    .total-row .label-txt { font-size: 13px; font-weight: 800; color: #0f172a; }
    .total-row .amount { font-size: 22px; font-weight: 800; color: #dc2626; }
    .footer { margin-top: 14px; border-top: 2px dashed #cbd5e1; padding-top: 10px; display:flex; justify-content:space-between; font-size: 11px; color: #64748b; font-weight: 600; }
    .pay-badge { display:inline-block; background:#dcfce7; color:#15803d; border:1px solid #86efac; border-radius:6px; padding: 3px 10px; font-size:11px; font-weight:800; }

    @media print {
      @page {
        size: auto;
        margin: 10mm;
      }
      html, body {
        background: #fff !important;
        padding: 0 !important;
        margin: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        min-height: 100vh !important;
      }
      .label {
        box-shadow: none !important;
        border: 2px solid #000 !important;
        margin: auto !important;
        width: 125mm !important;
        max-width: 100% !important;
      }
    }
  </style>
</head>
<body>
  <div class="label">
    <div class="header">
      <div class="shop-name">📦 ร้านหนังสือรัตน์</div>
      <div class="order-num">${safeText(order.order_number)} &nbsp;&middot;&nbsp; ${dateStr}</div>
    </div>

    <div class="section-title">ผู้รับ (TO)</div>
    <div class="to-box">
      <div class="name">${safeText(order.customer_name)}</div>
      <div class="phone">📞 ${safeText(order.customer_phone)}</div>
      <div class="address" style="margin-top:6px;line-height:1.4;">${formatAddressMultiLine(order.customer_address || order.shipping_address || order.address || '')}</div>
    </div>

    <div class="section-title">รายการสินค้า</div>
    <table class="items-table">
      <thead><tr><th>ชื่อหนังสือ</th><th>จำนวน</th><th>ราคา</th></tr></thead>
      <tbody>${items || '<tr><td colspan="3" style="padding:6px 8px;color:#999">-</td></tr>'}</tbody>
    </table>

    <div class="total-row">
      <div>
        <div class="label-txt">ยอดรวมทั้งหมด</div>
        <span class="pay-badge">${payMethod[order.payment_method] || order.payment_method || '-'}</span>
      </div>
      <div class="amount">฿${parseFloat(order.total_amount || 0).toLocaleString()}</div>
    </div>

    <div class="footer">
      <span>ขอบคุณที่อุดหนุนร้านของเรา 🙏</span>
      <span>${safeText(order.order_number)}</span>
    </div>
  </div>

  <script>
    window.onload = () => window.print();
  <\/script>
</body>
</html>`;

  const w = 900;
  const h = 850;
  const left = (screen.width/2)-(w/2);
  const top = (screen.height/2)-(h/2);
  const win = window.open('', '_blank', `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=yes`);
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ── Quick Approve / Reject Slip ───────────────────────────────────

async function quickApproveSlip(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || !supabaseClient) return;

  try {
    const { error } = await supabaseClient
      .from('orders')
      .update({
        payment_status: 'paid',
        status: 'confirmed',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) throw error;

    order.payment_status = 'paid';
    order.status = 'confirmed';

    filterOrders();
    updateSummaryStats();
    showToast(`อนุมัติสลิปคำสั่งซื้อ ${order.order_number || `#${orderId}`} เรียบร้อยแล้ว`);
  } catch (err) {
    console.error('Quick approve slip error:', err);
    showToast('อนุมัติสลิปไม่สำเร็จ: ' + err.message);
  }
}

async function quickRejectSlip(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || !supabaseClient) return;

  try {
    const { error } = await supabaseClient
      .from('orders')
      .update({
        payment_status: 'failed',
        status: 'pending',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) throw error;

    order.payment_status = 'failed';
    order.status = 'pending';

    filterOrders();
    updateSummaryStats();
    showToast(`ปฏิเสธสลิปคำสั่งซื้อ ${order.order_number || `#${orderId}`} แล้ว`);
  } catch (err) {
    console.error('Quick reject slip error:', err);
    showToast('ปฏิเสธสลิปไม่สำเร็จ: ' + err.message);
  }
}

// ── Quick Update Order Status ─────────────────────────────────────

async function quickUpdateOrderStatus(orderId, newStatus) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || !supabaseClient) return;

  const oldStatus = order.status;
  order.status = newStatus;
  updateSummaryStats();

  try {
    const { error } = await supabaseClient
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    if (error) throw error;
    showToast(`อัปเดตสถานะคำสั่งซื้อ ${order.order_number || `#${orderId}`} สำเร็จ`);
  } catch (err) {
    console.error('Update status error:', err);
    order.status = oldStatus;
    updateSummaryStats();
    showToast('อัปเดตสถานะไม่สำเร็จ: ' + err.message);
  }
}

// ── Slip Approval Logic ──────────────────────────────────────────

function getPaymentStatusBadge(payStatus) {
  switch (payStatus) {
    case 'paid':
      return `<span class="px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                <i class="fas fa-check-circle mr-1"></i>ชำระเงินแล้ว
              </span>`;
    case 'failed':
      return `<span class="px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                <i class="fas fa-circle-xmark mr-1"></i>สลิปไม่ถูกต้อง / ปฏิเสธ
              </span>`;
    default:
      return `<span class="px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                <i class="fas fa-clock mr-1"></i>รอตรวจสอบสลิป
              </span>`;
  }
}

async function approveSlip() {
  if (!activeDetailOrder || !supabaseClient) return;
  const orderId = activeDetailOrder.id;

  try {
    const { error } = await supabaseClient
      .from('orders')
      .update({
        payment_status: 'paid',
        status: 'confirmed',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) throw error;

    activeDetailOrder.payment_status = 'paid';
    activeDetailOrder.status = 'confirmed';

    document.getElementById('detail-payment-status-badge').innerHTML = getPaymentStatusBadge('paid');
    document.getElementById('detail-status-select').value = 'confirmed';

    filterOrders();
    updateSummaryStats();
    showToast(`อนุมัติสลิปคำสั่งซื้อ ${activeDetailOrder.order_number || `#${orderId}`} เรียบร้อยแล้ว`);
  } catch (err) {
    console.error('Approve slip error:', err);
    showToast('อนุมัติสลิปไม่สำเร็จ: ' + err.message);
  }
}

async function rejectSlip() {
  if (!activeDetailOrder || !supabaseClient) return;
  const orderId = activeDetailOrder.id;

  try {
    const { error } = await supabaseClient
      .from('orders')
      .update({
        payment_status: 'failed',
        status: 'pending',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) throw error;

    activeDetailOrder.payment_status = 'failed';
    activeDetailOrder.status = 'pending';

    document.getElementById('detail-payment-status-badge').innerHTML = getPaymentStatusBadge('failed');
    document.getElementById('detail-status-select').value = 'pending';

    filterOrders();
    updateSummaryStats();
    showToast(`ปฏิเสธสลิปคำสั่งซื้อ ${activeDetailOrder.order_number || `#${orderId}`} แล้ว`);
  } catch (err) {
    console.error('Reject slip error:', err);
    showToast('ปฏิเสธสลิปไม่สำเร็จ: ' + err.message);
  }
}

// ── Order Detail Modal ────────────────────────────────────────────

async function openOrderDetailModal(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || !supabaseClient) return;
  activeDetailOrder = order;

  document.getElementById('detail-order-number').textContent = order.order_number || `#${order.id}`;
  document.getElementById('detail-order-date').textContent = 'สั่งเมื่อ: ' + formatDate(order.created_at);
  document.getElementById('detail-status-select').value = order.status || 'pending';

  const payBadgeEl = document.getElementById('detail-payment-status-badge');
  if (payBadgeEl) {
    payBadgeEl.innerHTML = getPaymentStatusBadge(order.payment_status || 'pending');
  }

  document.getElementById('detail-customer-name').textContent = safeText(order.customer_name, 'ลูกค้าไม่ทราบชื่อ');
  document.getElementById('detail-customer-phone').textContent = 'โทร: ' + safeText(order.customer_phone, '-');
  document.getElementById('detail-customer-address').innerHTML = formatAddressMultiLine(order.customer_address);

  const noteCon = document.getElementById('detail-note-container');
  const noteEl = document.getElementById('detail-note');
  if (order.note) {
    noteCon?.classList.remove('hidden');
    if (noteEl) noteEl.textContent = order.note;
  } else {
    noteCon?.classList.add('hidden');
    if (noteEl) noteEl.textContent = '';
  }

  const payMethodBadge = document.getElementById('detail-pay-method-badge');
  if (payMethodBadge) {
    payMethodBadge.textContent = order.payment_method === 'line' || order.payment_method === 'promptpay' ? 'แอดมิน (Line)' : 'COD';
  }

  const totalAmountEl = document.getElementById('detail-total-amount');
  if (totalAmountEl) {
    totalAmountEl.textContent = '฿' + parseFloat(order.total_amount || 0).toLocaleString();
  }

  const slipImg = document.getElementById('detail-slip-img');
  const slipName = document.getElementById('detail-slip-name');
  const slipActions = document.getElementById('detail-slip-actions');
  const shouldShowActions = (order.payment_method === 'line' || order.payment_method === 'promptpay') && order.payment_status !== 'paid' && order.payment_status !== 'failed';
  slipActions?.classList.toggle('hidden', !shouldShowActions);

  if (order.payment_slip_path || order.payment_slip_name) {
    let slipUrl = order.payment_slip_path || '';
    if (slipUrl && !slipUrl.startsWith('http') && !slipUrl.startsWith('data:')) {
      const { data } = supabaseClient.storage.from('payment-slips').getPublicUrl(slipUrl);
      slipUrl = data?.publicUrl || slipUrl;
    }

    if (slipImg) {
      if (slipUrl) {
        slipImg.src = slipUrl;
        slipImg.classList.remove('hidden');
      } else {
        slipImg.removeAttribute('src');
        slipImg.classList.add('hidden');
      }
    }
    if (slipName) slipName.textContent = order.payment_slip_name || 'สลิปการชำระ';
  } else {
    if (slipImg) {
      slipImg.removeAttribute('src');
      slipImg.classList.add('hidden');
    }
    if (slipName) {
      slipName.textContent = order.payment_method === 'line' || order.payment_method === 'promptpay' ? 'ยังไม่มีการแนบสลิป' : 'คำสั่งซื้อเก็บเงินปลายทาง';
    }
  }

  const itemsContainer = document.getElementById('detail-items-list');
  itemsContainer.innerHTML = '<div class="py-6 text-center text-xs text-stone-400"><i class="fas fa-spinner fa-spin mr-1"></i> กำลังโหลดรายการสินค้า...</div>';

  try {
    const { data: items, error } = await supabaseClient
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    if (error) throw error;

    if (!items || items.length === 0) {
      itemsContainer.innerHTML = '<p class="text-xs text-stone-400 text-center py-4">ไม่พบรายการสินค้าในคำสั่งซื้อนี้</p>';
    } else {
      itemsContainer.innerHTML = items.map(item => {
        const itemPrice = parseFloat(item.unit_price || 0).toLocaleString();
        const itemSub = parseFloat(item.subtotal || (item.unit_price * item.quantity)).toLocaleString();
        return `
          <div class="flex items-center justify-between p-3 rounded-xl bg-stone-50 dark:bg-stone-900 border border-stone-100 dark:border-stone-800 text-xs">
            <div class="flex-1 min-w-0 pr-3">
              <p class="font-bold text-stone-900 dark:text-stone-100 truncate">${safeText(item.product_name)}</p>
              ${item.product_sku ? `<p class="text-[10px] font-mono text-stone-400">SKU: ${item.product_sku}</p>` : ''}
              <p class="text-stone-500 dark:text-stone-400 mt-0.5">฿${itemPrice} x ${item.quantity}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="font-black text-primary dark:text-amber-300 font-sans text-sm">฿${itemSub}</p>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Error fetching order items:', err);
    itemsContainer.innerHTML = `<p class="text-xs text-rose-500 text-center py-4">โหลดรายการสินค้าไม่สำเร็จ: ${err.message}</p>`;
  }

  document.getElementById('order-detail-modal')?.classList.remove('hidden');
}

function closeOrderDetailModal() {
  activeDetailOrder = null;
  document.getElementById('order-detail-modal')?.classList.add('hidden');
}

function updateOrderStatusFromModal(e) {
  if (!activeDetailOrder) return;
  const newStatus = typeof e === 'string' ? e : e?.target?.value;
  if (!newStatus) return;
  quickUpdateOrderStatus(activeDetailOrder.id, newStatus);
}


// ── Slip Lightbox Modal ───────────────────────────────────────────

let slipModalOrderId = null; // เก็บ orderId ปัจจุบันที่เปิดสลิปดู

function openSlipModalWithUrl(url, orderId = null) {
  const modalImg = document.getElementById('slip-modal-img');
  const modal    = document.getElementById('slip-modal');
  if (modalImg && modal && url) {
    modalImg.src = url;
    slipModalOrderId = orderId;
    modal.classList.remove('hidden');

    // ซ่อน/แสดงปุ่มอนุมัติ ขึ้นอยู่กับสถานะปัจจุบัน
    const actionsEl = document.getElementById('slip-modal-actions');
    if (actionsEl && orderId) {
      const order = allOrders.find(o => o.id === orderId);
      const alreadyDecided = order && (order.payment_status === 'paid' || order.payment_status === 'failed');
      actionsEl.classList.toggle('hidden', !!alreadyDecided);
    }
  }
}

function openSlipModal() {
  const mainSlipImg = document.getElementById('detail-slip-img');
  const orderId = activeDetailOrder?.id || null;
  if (mainSlipImg && mainSlipImg.src) {
    openSlipModalWithUrl(mainSlipImg.src, orderId);
  }
}

async function approveSlipFromActive() {
  const orderId = slipModalOrderId ?? activeDetailOrder?.id;
  if (!orderId) return;
  closeSlipModal();
  await quickApproveSlip(orderId);
  // อัปเดต badge ใน detail modal (ถ้าเปิดอยู่)
  const badgeEl = document.getElementById('detail-payment-status-badge');
  if (badgeEl) badgeEl.innerHTML = getPaymentStatusBadge('paid');
  const statusSel = document.getElementById('detail-status-select');
  if (statusSel) statusSel.value = 'confirmed';
}

async function rejectSlipFromActive() {
  const orderId = slipModalOrderId ?? activeDetailOrder?.id;
  if (!orderId) return;
  closeSlipModal();
  await quickRejectSlip(orderId);
  // อัปเดต badge ใน detail modal (ถ้าเปิดอยู่)
  const badgeEl = document.getElementById('detail-payment-status-badge');
  if (badgeEl) badgeEl.innerHTML = getPaymentStatusBadge('failed');
  const statusSel = document.getElementById('detail-status-select');
  if (statusSel) statusSel.value = 'pending';
}

function closeSlipModal() {
  slipModalOrderId = null;
  document.getElementById('slip-modal')?.classList.add('hidden');
}

// Override with marketplace-oriented table/export/import behavior
function getPaymentMethodLabel(method) {
  if (method === 'line' || method === 'promptpay') return 'แอดมิน (Line)';
  if (method === 'cod') return 'COD';
  return safeText(method, '-');
}

function getSlipStatusLabel(status) {
  if (status === 'paid') return 'อนุมัติแล้ว';
  if (status === 'failed') return 'ไม่อนุมัติ';
  return 'รอตรวจสอบ';
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `฿${amount.toLocaleString()}`;
}

function filterOrders() {
  const search = document.getElementById('order-search')?.value.toLowerCase().trim() || '';
  const status = document.getElementById('order-status-filter')?.value || 'all';
  const pay = document.getElementById('order-payment-filter')?.value || 'all';
  const slip = document.getElementById('order-slip-filter')?.value || 'all';
  const startDate = document.getElementById('order-date-start')?.value || '';
  const endDate = document.getElementById('order-date-end')?.value || '';

  const sourceRows = normalizeOrderRows(allOrders);
  const filtered = sourceRows.filter((row) => {
    const haystack = [
      row.orderNumber,
      row.sku,
      row.productName,
      row.buyer,
      row.phone,
      row.address,
      row.note,
      row.trackingNumber,
    ].join(' ').toLowerCase();

    if (search && !haystack.includes(search)) return false;
    if (status !== 'all' && row.status !== status) return false;
    if (pay !== 'all' && row.paymentMethod !== pay) return false;
    if (slip !== 'all' && row.paymentStatus !== slip) return false;

    if (row.orderDate) {
      const orderDate = new Date(row.orderDate).toISOString().split('T')[0];
      if (startDate && orderDate < startDate) return false;
      if (endDate && orderDate > endDate) return false;
    }

    return true;
  });

  const statusPriority = { pending: 0, confirmed: 1, shipped: 2, done: 3, cancelled: 4 };
  const payPriority = { pending: 0, paid: 1, failed: 2 };
  filtered.sort((a, b) => {
    const sa = statusPriority[a.status] ?? 5;
    const sb = statusPriority[b.status] ?? 5;
    if (sa !== sb) return sa - sb;

    const pa = payPriority[a.paymentStatus] ?? 0;
    const pb = payPriority[b.paymentStatus] ?? 0;
    if (pa !== pb) return pa - pb;

    return (b.orderId ?? 0) - (a.orderId ?? 0);
  });

  lastFilteredOrders = allOrders.filter((order) => filtered.some((row) => row.orderId === order.id));
  lastFilteredOrderRows = filtered;
  renderOrdersTable(filtered);
}

function exportOrdersToMarketplace(platform) {
  const config = MARKETPLACE_CONFIG[platform];
  const sourceRows = lastFilteredOrderRows.length ? lastFilteredOrderRows : normalizeOrderRows(allOrders);
  setOrdersTab(platform);

  if (!config) {
    showToast('ไม่พบรูปแบบไฟล์ที่ต้องการส่งออก');
    return;
  }

  if (!sourceRows.length) {
    showToast('ไม่มีรายการคำสั่งซื้อให้ส่งออก');
    return;
  }

  if (!window.XLSX) {
    showToast('ไม่พบเครื่องมือสำหรับสร้างไฟล์ Excel');
    return;
  }

  const exportRows = sourceRows.map((row) => {
    const mapped = {};
    config.columns.forEach((column) => {
      mapped[column.header] = getMarketplaceCellValue(row, column.key);
    });
    return mapped;
  });

  const worksheet = window.XLSX.utils.json_to_sheet(exportRows);
  worksheet['!cols'] = config.columns.map((column) => ({
    wch: Math.max(16, Math.min(42, String(column.header).length + 8)),
  }));

  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, config.label);

  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  window.XLSX.writeFile(workbook, `${config.exportFilePrefix}-${stamp}.xlsx`);
  showToast(`ส่งออก ${config.label} ${exportRows.length} รายการเป็นไฟล์ Excel แล้ว`);
}

function triggerMarketplaceUpload(platform) {
  const input = document.getElementById(`${platform}-upload-input`);
  setOrdersTab(platform);
  if (!input) {
    showToast(`ไม่พบปุ่มอัปโหลด ${safeText(platform, '').toUpperCase()}`);
    return;
  }
  input.value = '';
  input.click();
}

function clearMarketplaceImport() {
  marketplaceImportState = null;
  const panel = document.getElementById('marketplace-import-panel');
  const meta = document.getElementById('marketplace-import-meta');
  const head = document.getElementById('marketplace-import-head');
  const body = document.getElementById('marketplace-import-body');
  panel?.classList.add('hidden');
  if (meta) meta.textContent = 'ยังไม่มีไฟล์ที่อัปโหลด';
  if (head) head.innerHTML = '';
  if (body) body.innerHTML = '';
  updateOrdersTabUi();
}

function renderMarketplaceImportPreview() {
  const panel = document.getElementById('marketplace-import-panel');
  const meta = document.getElementById('marketplace-import-meta');
  const head = document.getElementById('marketplace-import-head');
  const body = document.getElementById('marketplace-import-body');

  if (!panel || !meta || !head || !body || !marketplaceImportState) return;

  const config = MARKETPLACE_CONFIG[marketplaceImportState.platform];
  const columns = getMarketplaceColumns(marketplaceImportState.platform);

  panel.classList.remove('hidden');
  meta.textContent = `${config.label}: ${marketplaceImportState.fileName} · ${marketplaceImportState.rows.length} แถว`;
  head.innerHTML = columns.map((column) => `<th class="py-3 px-3">${column.header}</th>`).join('');

  body.innerHTML = marketplaceImportState.rows.length
    ? marketplaceImportState.rows.slice(0, 30).map((row) => `
        <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition">
          ${columns.map((column) => `<td class="py-3 px-3 align-top">${safeText(getMarketplaceCellValue(row, column.key), '-')}</td>`).join('')}
        </tr>
      `).join('')
    : `<tr><td colspan="${columns.length}" class="py-8 px-3 text-center text-stone-400">ไม่พบข้อมูลที่อ่านได้จากไฟล์นี้</td></tr>`;
}

async function handleMarketplaceUpload(platform, event) {
  const file = event?.target?.files?.[0];
  const config = MARKETPLACE_CONFIG[platform];
  if (!file || !config) return;
  setOrdersTab(platform);

  if (!window.XLSX) {
    showToast('ไม่พบเครื่องมือสำหรับอ่านไฟล์ Excel');
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const normalizedRows = rawRows.map((row) => {
      const normalized = {
        orderNumber: '',
        sku: '',
        productName: '',
        quantity: '',
        orderDate: '',
        shipByDate: '',
        trackingNumber: '',
        paidTime: '',
        price: '',
        shippingFee: '',
        buyer: '',
      };

      config.columns.forEach((column) => {
        normalized[column.key] = findImportedValue(row, column.aliases);
      });

      return normalized;
    }).filter((row) => Object.values(row).some((value) => String(value || '').trim() !== ''));

    const persistedBatchId = await saveMarketplaceImportToSupabase({
      platform,
      file,
      sheetName,
      normalizedRows,
      rawRows,
    });

    marketplaceImportState = {
      platform,
      fileName: file.name,
      rows: normalizedRows,
      batchId: persistedBatchId,
    };
    marketplaceImports[platform] = null;

    renderMarketplaceImportPreview();
    showToast(`อัปโหลดไฟล์ ${config.label} สำเร็จ ${normalizedRows.length} แถว`);
  } catch (error) {
    console.error(`Upload ${platform} file error:`, error);
    showToast(`อัปโหลดไฟล์ ${config.label} ไม่สำเร็จ: ${error.message}`);
  }
}

function renderOrdersTable(list) {
  const wrapper = document.getElementById('orders-table-wrapper');
  const empty = document.getElementById('orders-empty');
  const tbody = document.getElementById('orders-rows');

  if (!wrapper || !empty || !tbody) return;

  if (!list.length) {
    wrapper.classList.add('hidden');
    empty.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  wrapper.classList.remove('hidden');

  tbody.innerHTML = list.map((row) => `
    <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
      <td class="py-3.5 px-4 min-w-[170px] align-top">
        <button onclick="openOrderDetailModal(${row.orderId})" class="text-left">
          <p class="font-extrabold text-stone-900 dark:text-stone-100 font-sans text-xs hover:text-primary transition">${row.orderNumber}</p>
          <p class="text-[10px] text-stone-400 mt-0.5">${getStatusBadge(row.status)}</p>
        </button>
      </td>
      <td class="py-3.5 px-4 min-w-[120px] align-top">
        <p class="font-mono text-[11px] font-bold text-stone-700 dark:text-stone-200">${safeText(row.sku, '-')}</p>
      </td>
      <td class="py-3.5 px-4 min-w-[220px] align-top">
        <p class="font-semibold text-stone-900 dark:text-stone-100">${safeText(row.productName, '-')}</p>
        <div class="mt-1 flex flex-wrap gap-1.5 text-[10px]">
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getPaymentMethodLabel(row.paymentMethod)}</span>
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getSlipStatusLabel(row.paymentStatus)}</span>
        </div>
      </td>
      <td class="py-3.5 px-4 text-center align-top">
        <span class="inline-flex min-w-[44px] items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800 px-3 py-1 text-xs font-bold text-stone-800 dark:text-stone-100">${row.quantity}</span>
      </td>
      <td class="py-3.5 px-4 min-w-[120px] align-top">${formatCompactDate(row.orderDate)}</td>
      <td class="py-3.5 px-4 min-w-[120px] align-top">${formatCompactDate(row.shipByDate)}</td>
      <td class="py-3.5 px-4 min-w-[140px] align-top font-mono text-[11px]">${safeText(row.trackingNumber, '-')}</td>
      <td class="py-3.5 px-4 min-w-[120px] align-top">${row.paidTime ? formatCompactDate(row.paidTime) : '-'}</td>
      <td class="py-3.5 px-4 text-right align-top font-black text-primary dark:text-amber-300 font-sans">${formatMoney(row.price)}</td>
      <td class="py-3.5 px-4 text-right align-top font-semibold text-stone-700 dark:text-stone-200">${formatMoney(row.shippingFee)}</td>
      <td class="py-3.5 px-4 min-w-[220px] align-top">
        <p class="font-bold text-stone-900 dark:text-stone-100">${safeText(row.buyer, '-')}</p>
        <p class="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">${safeText(row.phone, '-')}</p>
        ${formatAddressMultiLine(row.address)}
      </td>
      <td class="py-3.5 px-4 text-center align-top min-w-[170px]">
        <div class="flex flex-col gap-2">
          <button onclick="openOrderDetailModal(${row.orderId})" class="border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2 text-[11px] font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition">
            <i class="fas fa-eye mr-1"></i> ดู
          </button>
          <div class="flex gap-2">
            <button onclick="openEditOrderModal(${row.orderId})" class="bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-xl text-[11px] font-bold shadow-sm transition flex items-center justify-center gap-1">
              <i class="fas fa-pen-to-square"></i> แก้ไข
            </button>
          </div>
          <button onclick="printShippingLabel(${row.orderId})" class="btn-primary px-3 py-2 text-[11px] font-bold shadow-sm">
            <i class="fas fa-print mr-1"></i> พิมพ์
          </button>
          <select onchange="quickUpdateOrderStatus(${row.orderId}, this.value)" class="inp text-[11px] font-bold py-2 px-2.5 cursor-pointer">
            <option value="pending" ${row.status === 'pending' ? 'selected' : ''}>รอตรวจสอบ</option>
            <option value="confirmed" ${row.status === 'confirmed' ? 'selected' : ''}>ยืนยันแล้ว</option>
            <option value="shipped" ${row.status === 'shipped' ? 'selected' : ''}>จัดส่งแล้ว</option>
            <option value="done" ${row.status === 'done' ? 'selected' : ''}>เสร็จสิ้น</option>
            <option value="cancelled" ${row.status === 'cancelled' ? 'selected' : ''}>ยกเลิก</option>
          </select>
        </div>
      </td>
    </tr>
  `).join('');
}

function updateOrdersTabUi() {
  const tabs = ['website', 'shopee', 'tiktok'];
  const dataPanel = document.getElementById('orders-data-panel');
  const importPanel = document.getElementById('marketplace-import-panel');
  const websitePanel = document.getElementById('orders-tab-panel-website');

  tabs.forEach((tab) => {
    const btn = document.getElementById(`orders-tab-${tab}`);
    const panel = document.getElementById(`orders-tab-panel-${tab}`);
    const active = currentOrdersTab === tab;

    if (btn) {
      btn.className = `orders-tab-btn inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-bold transition ${
        active
          ? 'border-amber-300 bg-amber-500 text-white shadow-md shadow-amber-600/20'
          : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
      }`;
    }

    panel?.classList.toggle('hidden', !active);
  });

  dataPanel?.classList.toggle('hidden', currentOrdersTab !== 'website');

  const shouldShowImportPanel = Boolean(
    currentOrdersTab !== 'website' &&
    marketplaceImportState &&
    marketplaceImportState.platform === currentOrdersTab
  );
  importPanel?.classList.toggle('hidden', !shouldShowImportPanel);

  if (websitePanel) {
    websitePanel
      .querySelectorAll('button[onclick*="exportOrdersToMarketplace"], button[onclick*="triggerMarketplaceUpload"]')
      .forEach((button) => button.classList.add('hidden'));
  }
}

function setOrdersTab(tab) {
  currentOrdersTab = ['website', 'shopee', 'tiktok'].includes(tab) ? tab : 'website';
  updateOrdersTabUi();
  if (currentOrdersTab !== 'website') {
    loadMarketplaceImportData(currentOrdersTab);
  }
}

function renderMarketplaceImportData(platform) {
  const label = platform === 'shopee' ? 'Shopee' : 'TikTok';
  const summary = document.getElementById(`${platform}-import-summary`);
  const count = document.getElementById(`${platform}-import-count`);
  const tbody = document.getElementById(`${platform}-import-rows`);
  if (!summary || !count || !tbody) return;

  const state = marketplaceImports[platform];
  const batch = state?.batch;
  const rows = state?.rows || [];

  if (!batch) {
    summary.innerHTML = `ยังไม่มีข้อมูลอัปโหลด ${label}`;
    count.textContent = '0 แถว';
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 px-3 text-center text-stone-400">ยังไม่มีข้อมูลอัปโหลด ${label}</td></tr>`;
    return;
  }

  summary.innerHTML = `
    <div class="space-y-2">
      <div><span class="text-stone-400">ไฟล์:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${safeText(batch.file_name, '-')}</span></div>
      <div><span class="text-stone-400">อัปโหลดโดย:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${safeText(batch.uploaded_email || '-', '-')}</span></div>
      <div><span class="text-stone-400">วันเวลา:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${formatDate(batch.created_at)}</span></div>
      <div><span class="text-stone-400">จำนวน:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${Number(batch.row_count || 0).toLocaleString()} แถว</span></div>
    </div>
  `;

  count.textContent = `${rows.length.toLocaleString()} แถว`;
  tbody.innerHTML = rows.length
    ? rows.map((row) => `
        <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition">
          <td class="py-3 px-3 align-top font-semibold text-stone-700 dark:text-stone-200">${safeText(row.order_number, '-')}</td>
          <td class="py-3 px-3 align-top font-mono text-stone-500 dark:text-stone-300">${safeText(row.sku, '-')}</td>
          <td class="py-3 px-3 align-top text-stone-700 dark:text-stone-200">${safeText(row.product_name, '-')}</td>
          <td class="py-3 px-3 align-top font-mono text-stone-500 dark:text-stone-300">${safeText(row.tracking_number, '-')}</td>
          <td class="py-3 px-3 align-top text-center text-stone-700 dark:text-stone-200">${safeText(row.quantity, '-')}</td>
          <td class="py-3 px-3 align-top text-stone-700 dark:text-stone-200">${safeText(row.buyer, '-')}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="6" class="py-8 px-3 text-center text-stone-400">ไม่พบข้อมูลรายการจากไฟล์ล่าสุด</td></tr>`;
}

function renderMarketplaceImportData(platform) {
  const label = platform === 'shopee' ? 'Shopee' : 'TikTok';
  const summary = document.getElementById(`${platform}-import-summary`);
  const head = document.getElementById(`${platform}-import-head`);
  const count = document.getElementById(`${platform}-import-count`);
  const tbody = document.getElementById(`${platform}-import-rows`);
  if (!summary || !head || !count || !tbody) return;

  const state = marketplaceImports[platform];
  const batch = state?.batch;
  const rows = state?.rows || [];

  if (!batch) {
    summary.innerHTML = `ยังไม่มีข้อมูลอัปโหลด ${label}`;
    head.innerHTML = '';
    count.textContent = '0 แถว';
    tbody.innerHTML = `<tr><td colspan="1" class="py-8 px-3 text-center text-stone-400">ยังไม่มีข้อมูลอัปโหลด ${label}</td></tr>`;
    return;
  }

  summary.innerHTML = `
    <div class="space-y-2">
      <div><span class="text-stone-400">ไฟล์:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${safeText(batch.file_name, '-')}</span></div>
      <div><span class="text-stone-400">อัปโหลดโดย:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${safeText(batch.uploaded_email || '-', '-')}</span></div>
      <div><span class="text-stone-400">วันเวลา:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${formatDate(batch.created_at)}</span></div>
      <div><span class="text-stone-400">จำนวน:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${Number(batch.row_count || 0).toLocaleString()} แถว</span></div>
    </div>
  `;

  const preferredColumns = [
    'row_index',
    'order_number',
    'sku',
    'product_name',
    'quantity',
    'tracking_number',
    'buyer',
    'order_date',
    'ship_by_date',
    'paid_time',
    'price',
    'shipping_fee',
    'platform',
    'batch_id',
    'id',
    'created_at',
    'raw_payload',
  ];
  const allKeys = Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));
  const columns = [
    ...preferredColumns.filter((key) => allKeys.includes(key)),
    ...allKeys.filter((key) => !preferredColumns.includes(key)),
  ];

  const labelMap = {
    row_index: 'ลำดับ',
    order_number: 'เลขคำสั่งซื้อ',
    sku: 'SKU',
    product_name: 'สินค้า',
    quantity: 'จำนวน',
    tracking_number: 'เลขที่พัสดุ',
    buyer: 'ผู้ซื้อ',
    order_date: 'วันที่สั่งซื้อ',
    ship_by_date: 'กำหนดส่ง',
    paid_time: 'เวลาชำระเงิน',
    price: 'ราคา',
    shipping_fee: 'ค่าส่ง',
    platform: 'แพลตฟอร์ม',
    batch_id: 'Batch ID',
    id: 'ID',
    created_at: 'สร้างเมื่อ',
    raw_payload: 'Raw Payload',
  };

  head.innerHTML = `
    <tr>
      ${columns.map((column) => `<th class="py-3 px-3 whitespace-nowrap">${labelMap[column] || column.replaceAll('_', ' ')}</th>`).join('')}
    </tr>
  `;

  count.textContent = `${rows.length.toLocaleString()} แถว`;
  tbody.innerHTML = rows.length
    ? rows.map((row) => `
        <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition">
          ${columns.map((column) => {
            const value = row?.[column];
            const rendered =
              column === 'raw_payload'
                ? safeText(JSON.stringify(value ?? {}, null, 2), '-')
                : column.includes('date') || column.includes('time') || column === 'created_at'
                  ? formatDate(value)
                  : safeText(value, '-');
            const extraClass = column === 'raw_payload'
              ? 'font-mono text-[11px] whitespace-pre-wrap break-all'
              : ['id', 'batch_id', 'sku', 'tracking_number'].includes(column)
                ? 'font-mono'
                : '';
            return `<td class="py-3 px-3 align-top text-stone-700 dark:text-stone-200 ${extraClass}">${rendered}</td>`;
          }).join('')}
        </tr>
      `).join('')
    : `<tr><td colspan="${Math.max(columns.length, 1)}" class="py-8 px-3 text-center text-stone-400">ไม่พบข้อมูลรายการจากไฟล์ล่าสุด</td></tr>`;
}

function renderMarketplaceImportData(platform) {
  const label = platform === 'shopee' ? 'Shopee' : 'TikTok';
  const summary = document.getElementById(`${platform}-import-summary`);
  const head = document.getElementById(`${platform}-import-head`);
  const count = document.getElementById(`${platform}-import-count`);
  const tbody = document.getElementById(`${platform}-import-rows`);
  if (!summary || !head || !count || !tbody) return;

  const state = marketplaceImports[platform];
  const batch = state?.batch;
  const rows = state?.rows || [];

  const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const findValueInPayload = (payload, candidates) => {
    if (!payload || typeof payload !== 'object') return '';
    const wanted = candidates.map(normalizeKey);
    const queue = [payload];
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') continue;
      for (const [key, value] of Object.entries(current)) {
        const normalizedKey = normalizeKey(key);
        if (
          wanted.includes(normalizedKey) ||
          wanted.some((candidate) => normalizedKey.includes(candidate) || candidate.includes(normalizedKey))
        ) {
          if (value != null && (typeof value === 'string' || typeof value === 'number')) {
            return String(value);
          }
        }
        if (value && typeof value === 'object') queue.push(value);
      }
    }
    return '';
  };

  const getBuyerAddress = (row) => {
    const payload = safeParseJson(row?.raw_payload, {});
    return safeText(
      row?.address ||
      row?.buyer_address ||
      row?.shipping_address ||
      findValueInPayload(payload, [
        'address',
        'shipping_address',
        'delivery_address',
        'recipient_address',
        'customer_address',
        'buyer_address',
        'full_address',
        'ที่อยู่',
      ]),
      '-'
    );
  };

  const renderOrderPaidTime = (row) => {
    const orderDate = row?.order_date ? formatDate(row.order_date) : '-';
    const paidTime = row?.paid_time ? formatDate(row.paid_time) : '-';
    return `
      <div class="space-y-1">
        <div><span class="text-stone-400">สั่งซื้อ:</span> <span class="font-medium text-stone-700 dark:text-stone-200">${orderDate}</span></div>
        <div><span class="text-stone-400">ชำระเงิน:</span> <span class="font-medium text-stone-700 dark:text-stone-200">${paidTime}</span></div>
      </div>
    `;
  };

  if (!batch) {
    summary.innerHTML = `ยังไม่มีข้อมูลอัปโหลด ${label}`;
    head.innerHTML = '';
    count.textContent = '0 แถว';
    tbody.innerHTML = `<tr><td colspan="11" class="py-8 px-3 text-center text-stone-400">ยังไม่มีข้อมูลอัปโหลด ${label}</td></tr>`;
    return;
  }

  summary.innerHTML = `
    <div class="space-y-2">
      <div><span class="text-stone-400">ไฟล์:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${safeText(batch.file_name, '-')}</span></div>
      <div><span class="text-stone-400">อัปโหลดโดย:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${safeText(batch.uploaded_email || '-', '-')}</span></div>
      <div><span class="text-stone-400">วันเวลา:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${formatDate(batch.created_at)}</span></div>
      <div><span class="text-stone-400">จำนวน:</span> <span class="font-semibold text-stone-700 dark:text-stone-200">${Number(batch.row_count || 0).toLocaleString()} แถว</span></div>
    </div>
  `;

  head.innerHTML = `
    <tr class="border-b border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/60 text-[11px] font-bold text-stone-400 uppercase tracking-wider">
      <th colspan="2" class="py-2.5 px-3 text-center">ข้อมูลออเดอร์ & ผู้ซื้อ</th>
      <th colspan="3" class="py-2.5 px-3 text-center">รายการสินค้า</th>
      <th colspan="2" class="py-2.5 px-3 text-center">ยอดเงิน</th>
      <th colspan="3" class="py-2.5 px-3 text-center">กำหนดเวลา & การจัดส่ง</th>
      <th class="py-2.5 px-3 text-center">การดำเนินการ</th>
    </tr>
    <tr class="border-b border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/60 text-[11px] font-bold text-stone-400 uppercase tracking-wider">
      <th class="py-3 px-3 whitespace-nowrap">เลขออเดอร์</th>
      <th class="py-3 px-3 whitespace-nowrap">ชื่อผู้ซื้อ / ที่อยู่</th>
      <th class="py-3 px-3 whitespace-nowrap">SKU</th>
      <th class="py-3 px-3 whitespace-nowrap">ชื่อสินค้า</th>
      <th class="py-3 px-3 whitespace-nowrap text-center">จำนวน</th>
      <th class="py-3 px-3 whitespace-nowrap text-right">ราคา</th>
      <th class="py-3 px-3 whitespace-nowrap text-right">ค่าจัดส่ง</th>
      <th class="py-3 px-3 whitespace-nowrap">วันที่สั่งซื้อ / เวลาชำระเงิน</th>
      <th class="py-3 px-3 whitespace-nowrap">วันที่ต้องจัดส่ง</th>
      <th class="py-3 px-3 whitespace-nowrap">เลขพัสดุ</th>
      <th class="py-3 px-3 whitespace-nowrap text-center">จัดการ</th>
    </tr>
  `;

  count.textContent = `${rows.length.toLocaleString()} แถว`;
  tbody.innerHTML = rows.length
    ? rows.map((row) => {
        const tracking = safeText(row.tracking_number, '');
        const buyerAddress = getBuyerAddress(row);
        const rawPayloadText = encodeURIComponent(JSON.stringify(safeParseJson(row.raw_payload, {}), null, 2));
        return `
          <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition">
            <td class="py-3 px-3 align-top min-w-[160px]">
              <p class="font-semibold text-stone-800 dark:text-stone-100">${safeText(row.order_number, '-')}</p>
            </td>
            <td class="py-3 px-3 align-top min-w-[220px]">
              <p class="font-semibold text-stone-800 dark:text-stone-100">${safeText(row.buyer, '-')}</p>
              <p class="text-[11px] text-stone-500 dark:text-stone-400 mt-1 whitespace-pre-wrap break-words">${safeText(buyerAddress, '-')}</p>
            </td>
            <td class="py-3 px-3 align-top min-w-[140px] font-mono text-stone-600 dark:text-stone-300">${safeText(row.sku, '-')}</td>
            <td class="py-3 px-3 align-top min-w-[260px] text-stone-700 dark:text-stone-200">${safeText(row.product_name, '-')}</td>
            <td class="py-3 px-3 align-top text-center font-semibold text-stone-800 dark:text-stone-100">${safeText(row.quantity, '-')}</td>
            <td class="py-3 px-3 align-top text-right font-semibold text-stone-800 dark:text-stone-100">${safeText(row.price, '-')}</td>
            <td class="py-3 px-3 align-top text-right font-semibold text-stone-800 dark:text-stone-100">${safeText(row.shipping_fee, '-')}</td>
            <td class="py-3 px-3 align-top min-w-[180px]">${renderOrderPaidTime(row)}</td>
            <td class="py-3 px-3 align-top min-w-[140px] text-stone-700 dark:text-stone-200">${row.ship_by_date ? formatDate(row.ship_by_date) : '-'}</td>
            <td class="py-3 px-3 align-top min-w-[160px] font-mono text-stone-600 dark:text-stone-300">${safeText(tracking, '-')}</td>
            <td class="py-3 px-3 align-top min-w-[160px]">
              <div class="flex flex-col gap-2">
                <button type="button" class="px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700 text-xs font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition disabled:opacity-50" data-value="${tracking}" onclick="copyMarketplaceField(this.dataset.value)" ${tracking ? '' : 'disabled'}>
                  คัดลอกเลขพัสดุ
                </button>
                <button type="button" class="px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition" data-raw="${rawPayloadText}" onclick="viewMarketplaceRaw(this.dataset.raw)">
                  ดูข้อมูลดิบ
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('')
    : `<tr><td colspan="11" class="py-8 px-3 text-center text-stone-400">ไม่พบข้อมูลรายการจากไฟล์ล่าสุด</td></tr>`;
}

function applyMarketplacePanelTheme(platform) {
  const summary = document.getElementById(`${platform}-import-summary`);
  const count = document.getElementById(`${platform}-import-count`);
  const head = document.getElementById(`${platform}-import-head`);
  if (!summary || !count || !head) return;

  const summaryCard = summary.closest('.panel');
  const tableCard = head.closest('.panel');
  const summaryTitle = summaryCard?.querySelector('h4');
  const tableTitle = tableCard?.querySelector('h4');

  if (summaryCard) {
    summaryCard.className = 'panel p-4 md:p-5 border border-stone-800/80 bg-[linear-gradient(135deg,rgba(24,24,27,0.96),rgba(39,39,42,0.92))] shadow-[0_20px_60px_rgba(15,23,42,0.35)]';
  }
  if (tableCard) {
    tableCard.className = 'panel p-4 md:p-5 overflow-x-auto border border-stone-800/80 bg-[linear-gradient(180deg,rgba(17,24,39,0.96),rgba(24,24,27,0.94))] shadow-[0_24px_70px_rgba(15,23,42,0.38)]';
  }
  if (summaryTitle) {
    summaryTitle.className = 'text-sm font-black tracking-tight text-stone-100 mb-3';
    summaryTitle.textContent = 'อัปโหลดล่าสุด';
  }
  if (tableTitle) {
    tableTitle.className = 'text-sm font-black tracking-tight text-stone-100';
    tableTitle.textContent = 'รายการจากไฟล์ล่าสุด';
  }

  count.className = 'rounded-full border border-stone-700/80 bg-stone-900/80 px-3 py-1 text-[11px] font-bold text-stone-300';
}

function renderMarketplaceImportData(platform) {
  applyMarketplacePanelTheme(platform);

  const label = platform === 'shopee' ? 'Shopee' : 'TikTok';
  const summary = document.getElementById(`${platform}-import-summary`);
  const count = document.getElementById(`${platform}-import-count`);
  const head = document.getElementById(`${platform}-import-head`);
  const tbody = document.getElementById(`${platform}-import-rows`);
  const batch = importedOrderBatches[platform];
  const rows = importedOrders[platform] || [];

  if (!summary || !count || !head || !tbody) return;

  const normalizeKey = (key) => String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const findValueInPayload = (payload, candidates = []) => {
    if (!payload || typeof payload !== 'object') return '';
    const normalizedCandidates = candidates.map(normalizeKey);
    for (const [key, value] of Object.entries(payload)) {
      if (normalizedCandidates.includes(normalizeKey(key)) && value != null && value !== '') {
        return value;
      }
    }
    return '';
  };

  const getBuyerAddress = (row) => {
    const payload = safeParseJson(row.raw_payload, {});
    const addressFields = [
      safeText(payload['ผู้รับสินค้า'], ''),
      safeText(payload['ชื่อที่อยู่จัดส่ง'], ''),
      safeText(payload['ที่อยู่จัดส่ง'], ''),
      safeText(payload['Shipping Address'], ''),
      safeText(payload['Address'], ''),
      safeText(payload['จังหวัด'], ''),
      safeText(payload['รหัสไปรษณีย์'], ''),
    ].filter(Boolean);

    if (addressFields.length) return addressFields.join('\n');

    return safeText(findValueInPayload(payload, [
      'shipping_address',
      'address',
      'delivery_address',
      'receiver_address',
      'customer_address'
    ]), '');
  };

  const renderOrderPaidTime = (row) => {
    const orderDate = row.order_date ? formatDate(row.order_date) : '-';
    const paidTime = row.paid_time ? formatDate(row.paid_time) : '-';
    return `
      <div class="space-y-1 min-w-[180px]">
        <div class="text-xs font-semibold text-stone-200">สั่งซื้อ: <span class="text-stone-400 font-medium">${orderDate}</span></div>
        <div class="text-xs font-semibold text-stone-200">ชำระเงิน: <span class="text-stone-400 font-medium">${paidTime}</span></div>
      </div>
    `;
  };

  if (!batch) {
    summary.innerHTML = `<div class="rounded-2xl border border-dashed border-stone-700/80 bg-stone-950/40 px-4 py-5 text-sm text-stone-400">ยังไม่มีข้อมูลอัปโหลด ${label}</div>`;
    head.innerHTML = '';
    count.textContent = '0 แถว';
    tbody.innerHTML = `<tr><td colspan="11" class="py-10 px-3 text-center text-stone-400">ยังไม่มีข้อมูลอัปโหลด ${label}</td></tr>`;
    return;
  }

  summary.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <div class="rounded-2xl border border-stone-700/70 bg-stone-950/70 px-4 py-3">
        <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500">ไฟล์</p>
        <p class="mt-2 text-sm font-bold text-stone-100 break-all">${safeText(batch.file_name, '-')}</p>
      </div>
      <div class="rounded-2xl border border-stone-700/70 bg-stone-950/70 px-4 py-3">
        <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500">อัปโหลดโดย</p>
        <p class="mt-2 text-sm font-bold text-stone-100 break-all">${safeText(batch.uploaded_email || '-', '-')}</p>
      </div>
      <div class="rounded-2xl border border-stone-700/70 bg-stone-950/70 px-4 py-3">
        <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500">วันเวลา</p>
        <p class="mt-2 text-sm font-bold text-stone-100">${formatDate(batch.created_at)}</p>
      </div>
      <div class="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-200">จำนวนรายการ</p>
        <p class="mt-2 text-sm font-black text-amber-100">${Number(batch.row_count || 0).toLocaleString()} แถว</p>
      </div>
    </div>
  `;

  head.innerHTML = `
    <tr class="border-b border-stone-800/80 bg-stone-950/90 text-[10px] font-bold uppercase tracking-[0.18em] text-stone-500">
      <th colspan="2" class="py-3 px-3 text-center">ข้อมูลออเดอร์ & ผู้ซื้อ</th>
      <th colspan="3" class="py-3 px-3 text-center">รายการสินค้า</th>
      <th colspan="2" class="py-3 px-3 text-center">ยอดเงิน</th>
      <th colspan="3" class="py-3 px-3 text-center">กำหนดเวลา & การจัดส่ง</th>
      <th class="py-3 px-3 text-center">การดำเนินการ</th>
    </tr>
    <tr class="border-b border-stone-800/80 bg-stone-900/85 text-[11px] font-bold text-stone-200">
      <th class="py-3 px-3 whitespace-nowrap">เลขออเดอร์</th>
      <th class="py-3 px-3 whitespace-nowrap">ชื่อผู้ซื้อ / ที่อยู่</th>
      <th class="py-3 px-3 whitespace-nowrap">SKU</th>
      <th class="py-3 px-3 whitespace-nowrap">ชื่อสินค้า</th>
      <th class="py-3 px-3 whitespace-nowrap text-center">จำนวน</th>
      <th class="py-3 px-3 whitespace-nowrap text-right">ราคา</th>
      <th class="py-3 px-3 whitespace-nowrap text-right">ค่าจัดส่ง</th>
      <th class="py-3 px-3 whitespace-nowrap">วันที่สั่งซื้อ / เวลาชำระเงิน</th>
      <th class="py-3 px-3 whitespace-nowrap">วันที่ต้องจัดส่ง</th>
      <th class="py-3 px-3 whitespace-nowrap">เลขพัสดุ</th>
      <th class="py-3 px-3 whitespace-nowrap text-center">จัดการ</th>
    </tr>
  `;

  count.textContent = `${rows.length.toLocaleString()} แถว`;
  tbody.className = '';
  tbody.innerHTML = rows.length
    ? rows.map((row) => {
        const tracking = safeText(row.tracking_number, '').trim();
        const buyerAddress = getBuyerAddress(row);
        const rawPayloadText = encodeURIComponent(JSON.stringify(safeParseJson(row.raw_payload, {}), null, 2));

        return `
          <tr class="border-b border-stone-800/70 text-sm text-stone-200 hover:bg-stone-900/55 transition">
            <td class="py-4 px-3 align-top min-w-[170px]">
              <div class="space-y-1">
                <p class="font-black text-stone-50">${safeText(row.order_number, '-')}</p>
                <p class="text-[11px] uppercase tracking-[0.16em] text-stone-500">${label}</p>
              </div>
            </td>
            <td class="py-4 px-3 align-top min-w-[250px]">
              <p class="font-bold text-stone-100">${safeText(row.buyer, '-')}</p>
              <p class="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-stone-400">${safeText(buyerAddress, '-')}</p>
            </td>
            <td class="py-4 px-3 align-top min-w-[140px] font-mono text-xs text-cyan-300">${safeText(row.sku, '-')}</td>
            <td class="py-4 px-3 align-top min-w-[280px] leading-6 text-stone-200">${safeText(row.product_name, '-')}</td>
            <td class="py-4 px-3 align-top text-center font-black text-stone-50">${safeText(row.quantity, '-')}</td>
            <td class="py-4 px-3 align-top text-right font-black text-emerald-300">${safeText(row.price, '-')}</td>
            <td class="py-4 px-3 align-top text-right font-bold text-stone-200">${safeText(row.shipping_fee, '-')}</td>
            <td class="py-4 px-3 align-top min-w-[190px]">${renderOrderPaidTime(row)}</td>
            <td class="py-4 px-3 align-top min-w-[150px] text-stone-300">${row.ship_by_date ? formatDate(row.ship_by_date) : '-'}</td>
            <td class="py-4 px-3 align-top min-w-[170px]">
              <span class="inline-flex rounded-xl border border-stone-700/70 bg-stone-950/70 px-3 py-2 font-mono text-xs text-stone-200">${tracking || '-'}</span>
            </td>
            <td class="py-4 px-3 align-top min-w-[180px]">
              <div class="flex flex-col gap-2">
                <button type="button" class="rounded-xl border border-stone-700 bg-stone-900/70 px-3 py-2 text-xs font-bold text-stone-100 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40" data-value="${tracking}" onclick="copyMarketplaceField(this.dataset.value)" ${tracking ? '' : 'disabled'}>
                  คัดลอกเลขพัสดุ
                </button>
                <button type="button" class="rounded-xl border border-amber-600/50 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300 transition hover:bg-amber-500/20" data-raw="${rawPayloadText}" onclick="viewMarketplaceRaw(this.dataset.raw)">
                  ดูข้อมูลดิบ
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('')
    : `<tr><td colspan="11" class="py-10 px-3 text-center text-stone-400">ไม่พบข้อมูลรายการจากไฟล์ล่าสุด</td></tr>`;
}

async function quickUpdateOrderStatus(orderId, newStatus) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || !supabaseClient) return;

  const oldStatus = order.status;
  const oldTrackingNumber = order.tracking_number || '';
  let nextTrackingNumber = oldTrackingNumber;

  if (newStatus === 'confirmed') {
    const promptLabel = order.order_number || `#${orderId}`;
    const trackingInput = window.prompt(`กรอกเลขพัสดุสำหรับคำสั่งซื้อ ${promptLabel}`, oldTrackingNumber);

    if (trackingInput === null) {
      filterOrders();
      updateSummaryStats();
      if (activeDetailOrder?.id === orderId) {
        const detailStatusSelect = document.getElementById('detail-status-select');
        if (detailStatusSelect) detailStatusSelect.value = oldStatus || 'pending';
      }
      showToast('ยกเลิกการอัปเดตสถานะ');
      return;
    }

    nextTrackingNumber = trackingInput.trim();
    if (!nextTrackingNumber) {
      filterOrders();
      updateSummaryStats();
      if (activeDetailOrder?.id === orderId) {
        const detailStatusSelect = document.getElementById('detail-status-select');
        if (detailStatusSelect) detailStatusSelect.value = oldStatus || 'pending';
      }
      showToast('กรุณากรอกเลขพัสดุก่อนยืนยันคำสั่งซื้อ');
      return;
    }
  }

  order.status = newStatus;
  order.tracking_number = nextTrackingNumber;
  if (activeDetailOrder?.id === orderId) {
    activeDetailOrder.status = newStatus;
    activeDetailOrder.tracking_number = nextTrackingNumber;
  }
  updateSummaryStats();

  try {
    const { error } = await supabaseClient
      .from('orders')
      .update({
        status: newStatus,
        tracking_number: nextTrackingNumber,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) throw error;
    showToast(`อัปเดตสถานะคำสั่งซื้อ ${order.order_number || `#${orderId}`} สำเร็จ`);
  } catch (err) {
    console.error('Update status error:', err);
    order.status = oldStatus;
    order.tracking_number = oldTrackingNumber;

    if (activeDetailOrder?.id === orderId) {
      activeDetailOrder.status = oldStatus;
      activeDetailOrder.tracking_number = oldTrackingNumber;
      const detailStatusSelect = document.getElementById('detail-status-select');
      if (detailStatusSelect) detailStatusSelect.value = oldStatus || 'pending';
    }

    filterOrders();
    updateSummaryStats();
    showToast('อัปเดตสถานะไม่สำเร็จ: ' + err.message);
  }
}

window.copyMarketplaceField = async function copyMarketplaceField(value) {
  const text = safeText(value, '').trim();
  if (!text) {
    showToast('ไม่มีข้อมูลให้คัดลอก');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('คัดลอกข้อมูลเรียบร้อยแล้ว');
  } catch (error) {
    console.error('Copy marketplace field failed:', error);
    showToast('คัดลอกข้อมูลไม่สำเร็จ');
  }
};

window.viewMarketplaceRaw = function viewMarketplaceRaw(encodedRaw) {
  try {
    const rawText = decodeURIComponent(encodedRaw || '');
    alert(rawText || 'ไม่พบข้อมูลดิบ');
  } catch (error) {
    console.error('View marketplace raw failed:', error);
    alert('ไม่สามารถเปิดข้อมูลดิบได้');
  }
};

window.exportOrdersToMarketplace = exportOrdersToMarketplace;
window.exportOrdersToExcel = () => exportOrdersToMarketplace('shopee');
window.triggerMarketplaceUpload = triggerMarketplaceUpload;
window.handleMarketplaceUpload = handleMarketplaceUpload;
window.clearMarketplaceImport = clearMarketplaceImport;
window.setOrdersTab = setOrdersTab;

// ── Toast Helper ──────────────────────────────────────────────────

function showToast(msg) {
  let t = document.getElementById('toast-msg');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast-msg';
    t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-900 text-white text-xs font-semibold px-5 py-3 rounded-xl shadow-xl z-[100] transition-opacity duration-300';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

window.lockMarketplaceDevelopment = function lockMarketplaceDevelopment(platformLabel = 'Marketplace') {
  showToast(`${platformLabel} ยังไม่เปิดใช้งานในตอนนี้`);
};

window.setOrdersTab = function lockedAwareSetOrdersTab(tab) {
  if (tab === 'shopee' || tab === 'tiktok') {
    showToast(`${tab === 'shopee' ? 'Shopee' : 'TikTok'} ยังไม่เปิดใช้งานในตอนนี้`);
    if (typeof setOrdersTab === 'function') {
      return setOrdersTab('website');
    }
    return;
  }
  if (typeof setOrdersTab === 'function') {
    return setOrdersTab(tab);
  }
};

// ── Orders Authentication ───────────────────────────────────────────

async function setupOrdersAuth() {
  const authScreen = document.getElementById('orders-auth-screen');
  const appShell = document.getElementById('orders-app-shell');
  const authError = document.getElementById('orders-auth-error');
  const loginForm = document.getElementById('orders-login-form');
  const logoutBtn = document.getElementById('orders-logout-btn');

  if (!supabaseClient) {
    initSupabase();
  }

  function showAuthScreen(message = '') {
    appShell?.classList.add('hidden');
    authScreen?.classList.remove('hidden');
    logoutBtn?.classList.add('hidden');
    if (authError) {
      authError.textContent = message;
      authError.classList.toggle('hidden', !message);
    }
  }

  function showApp() {
    authScreen?.classList.add('hidden');
    appShell?.classList.remove('hidden');
    logoutBtn?.classList.remove('hidden');
    if (authError) {
      authError.textContent = '';
      authError.classList.add('hidden');
    }
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = document.getElementById('orders-email')?.value.trim();
      const password = document.getElementById('orders-password')?.value;

      if (!email || !password) {
        showAuthScreen('กรุณากรอกอีเมลและรหัสผ่าน');
        return;
      }

      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;

        if (data?.session) {
          if (!isAllowedAdminSession(data.session)) {
            await supabaseClient.auth.signOut();
            throw new Error('บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานระบบออเดอร์');
          }

          showApp();
          loadOrders();
        }
      } catch (err) {
        console.error('Orders login failed:', err);
        showAuthScreen(err?.message || 'เข้าสู่ระบบไม่สำเร็จ');
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await supabaseClient.auth.signOut();
        showAuthScreen('ออกจากระบบแล้ว');
      } catch (err) {
        console.error('Orders logout failed:', err);
      }
    });
  }

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      if (!isAllowedAdminSession(session)) {
        await supabaseClient.auth.signOut();
        showAuthScreen('บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานระบบออเดอร์');
        return;
      }

      showApp();
      loadOrders();
    } else {
      showAuthScreen();
    }
  } catch (err) {
    console.error('Orders auth check failed:', err);
    showAuthScreen('ไม่สามารถตรวจสอบสิทธิ์แอดมินได้');
  }
}

// ── Boot ──────────────────────────────────────────────────────────

function syncDetailTrackingUi(status = '') {
  const block = document.getElementById('detail-tracking-block');
  const input = document.getElementById('detail-tracking-input');
  const badge = document.getElementById('detail-tracking-badge');
  const hint = document.getElementById('detail-tracking-hint');
  if (!block || !input || !badge || !hint) return;

  const requiresTracking = ['confirmed', 'shipped', 'done'].includes(status);
  const hasValue = !!input.value.trim();
  block.classList.toggle('ring-2', requiresTracking && !hasValue);
  block.classList.toggle('ring-amber-300', requiresTracking && !hasValue);
  badge.classList.toggle('hidden', !requiresTracking || hasValue);
  hint.textContent = requiresTracking
    ? 'สถานะนี้ควรมีเลขพัสดุเพื่อใช้ติดตามการจัดส่ง'
    : 'กรอกเลขพัสดุเมื่อยืนยันคำสั่งซื้อหรือจัดส่งแล้ว';
}

async function saveTrackingNumberFromModal() {
  if (!activeDetailOrder || !supabaseClient) return;
  const input = document.getElementById('detail-tracking-input');
  if (!input) return;

  const trackingNumber = input.value.trim();
  if (!trackingNumber) {
    syncDetailTrackingUi(activeDetailOrder.status || 'pending');
    showToast('กรุณากรอกเลขพัสดุก่อนบันทึก');
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('orders')
      .update({
        tracking_number: trackingNumber,
        updated_at: new Date().toISOString()
      })
      .eq('id', activeDetailOrder.id);

    if (error) throw error;

    activeDetailOrder.tracking_number = trackingNumber;
    const order = allOrders.find((item) => item.id === activeDetailOrder.id);
    if (order) order.tracking_number = trackingNumber;
    syncDetailTrackingUi(activeDetailOrder.status || 'pending');
    filterOrders();
    showToast('บันทึกเลขพัสดุเรียบร้อยแล้ว');
  } catch (error) {
    console.error('Save tracking number error:', error);
    showToast('บันทึกเลขพัสดุไม่สำเร็จ: ' + error.message);
  }
}

const __openOrderDetailModalOriginal = openOrderDetailModal;
openOrderDetailModal = async function(orderId) {
  await __openOrderDetailModalOriginal(orderId);
  const input = document.getElementById('detail-tracking-input');
  const statusSelect = document.getElementById('detail-status-select');
  if (input) {
    input.value = activeDetailOrder?.tracking_number || '';
    input.oninput = () => syncDetailTrackingUi(statusSelect?.value || activeDetailOrder?.status || 'pending');
  }
  syncDetailTrackingUi(statusSelect?.value || activeDetailOrder?.status || 'pending');
};

quickUpdateOrderStatus = async function(orderId, newStatus) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order || !supabaseClient) return;

  const oldStatus = order.status;
  const oldTrackingNumber = order.tracking_number || '';
  let nextTrackingNumber = oldTrackingNumber;

  const modalInput = activeDetailOrder?.id === orderId
    ? document.getElementById('detail-tracking-input')
    : null;

  if (newStatus === 'confirmed') {
    if (modalInput) {
      nextTrackingNumber = modalInput.value.trim();
      if (!nextTrackingNumber) {
        syncDetailTrackingUi(newStatus);
        const detailStatusSelect = document.getElementById('detail-status-select');
        if (detailStatusSelect) detailStatusSelect.value = oldStatus || 'pending';
        showToast('กรุณากรอกเลขพัสดุก่อนยืนยันคำสั่งซื้อ');
        return;
      }
    } else {
      const promptLabel = order.order_number || `#${orderId}`;
      const trackingInput = window.prompt(`กรอกเลขพัสดุสำหรับคำสั่งซื้อ ${promptLabel}`, oldTrackingNumber);
      if (trackingInput === null) {
        filterOrders();
        updateSummaryStats();
        showToast('ยกเลิกการอัปเดตสถานะ');
        return;
      }
      nextTrackingNumber = trackingInput.trim();
      if (!nextTrackingNumber) {
        filterOrders();
        updateSummaryStats();
        showToast('กรุณากรอกเลขพัสดุก่อนยืนยันคำสั่งซื้อ');
        return;
      }
    }
  } else if (modalInput && modalInput.value.trim()) {
    nextTrackingNumber = modalInput.value.trim();
  }

  order.status = newStatus;
  order.tracking_number = nextTrackingNumber;
  if (activeDetailOrder?.id === orderId) {
    activeDetailOrder.status = newStatus;
    activeDetailOrder.tracking_number = nextTrackingNumber;
  }
  updateSummaryStats();

  try {
    const { error } = await supabaseClient
      .from('orders')
      .update({
        status: newStatus,
        tracking_number: nextTrackingNumber,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) throw error;
    if (modalInput) modalInput.value = nextTrackingNumber;
    syncDetailTrackingUi(newStatus);
    filterOrders();
    showToast(`อัปเดตสถานะคำสั่งซื้อ ${order.order_number || `#${orderId}`} สำเร็จ`);
  } catch (err) {
    console.error('Update status error:', err);
    order.status = oldStatus;
    order.tracking_number = oldTrackingNumber;
    if (activeDetailOrder?.id === orderId) {
      activeDetailOrder.status = oldStatus;
      activeDetailOrder.tracking_number = oldTrackingNumber;
      const detailStatusSelect = document.getElementById('detail-status-select');
      if (detailStatusSelect) detailStatusSelect.value = oldStatus || 'pending';
      if (modalInput) modalInput.value = oldTrackingNumber;
    }
    syncDetailTrackingUi(oldStatus || 'pending');
    filterOrders();
    updateSummaryStats();
    showToast('อัปเดตสถานะไม่สำเร็จ: ' + err.message);
  }
};

updateOrderStatusFromModal = function(e) {
  if (!activeDetailOrder) return;
  const newStatus = typeof e === 'string' ? e : e?.target?.value;
  if (!newStatus) return;
  quickUpdateOrderStatus(activeDetailOrder.id, newStatus);
};

function isMissingTrackingNumberColumnError(error) {
  return error?.code === 'PGRST204'
    && String(error?.message || '').includes('tracking_number');
}

setupOrdersTableHeaders = function() {
  const headRow = document.querySelector('#orders-table-wrapper thead tr');
  if (!headRow) return;
  headRow.innerHTML = `
    <th class="py-3.5 px-4">วันที่สั่งซื้อ</th>
    <th class="py-3.5 px-4">เลขออเดอร์</th>
    <th class="py-3.5 px-4">ชื่อสินค้า</th>
    <th class="py-3.5 px-4 text-center">จำนวน</th>
    <th class="py-3.5 px-4">เวลาชำระเงิน</th>
    <th class="py-3.5 px-4 text-right">ราคา</th>
    <th class="py-3.5 px-4 text-right">ค่าจัดส่ง</th>
    <th class="py-3.5 px-4">ผู้ซื้อ</th>
    <th class="py-3.5 px-4 text-center">จัดการ</th>
  `;
};

renderOrdersTable = function(list) {
  const wrapper = document.getElementById('orders-table-wrapper');
  const empty = document.getElementById('orders-empty');
  const tbody = document.getElementById('orders-rows');

  if (!wrapper || !empty || !tbody) return;

  if (!list.length) {
    wrapper.classList.add('hidden');
    empty.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  wrapper.classList.remove('hidden');

  tbody.innerHTML = list.map((row) => `
    <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
      <td class="py-3.5 px-4 min-w-[150px] align-top">
        <div class="space-y-1">
          <p class="font-bold text-stone-900 dark:text-stone-100">${formatCompactDate(row.orderDate)}</p>
          <p class="text-[10px] text-stone-500 dark:text-stone-400">ส่งภายใน: ${formatCompactDate(row.shipByDate)}</p>
        </div>
      </td>
      <td class="py-3.5 px-4 min-w-[210px] align-top">
        <button onclick="openOrderDetailModal(${row.orderId})" class="text-left">
          <p class="font-extrabold text-stone-900 dark:text-stone-100 font-sans text-xs hover:text-primary transition">${row.orderNumber}</p>
          <p class="mt-1 font-mono text-[11px] text-stone-500 dark:text-stone-300">${safeText(row.trackingNumber, '-')}</p>
          <p class="text-[10px] text-stone-400 mt-1">${getStatusBadge(row.status)}</p>
        </button>
      </td>
      <td class="py-3.5 px-4 min-w-[220px] align-top">
        <p class="font-mono text-[11px] font-bold text-stone-600 dark:text-stone-300 mb-1">${safeText(row.sku, '-')}</p>
        <p class="font-semibold text-stone-900 dark:text-stone-100">${safeText(row.productName, '-')}</p>
        <div class="mt-1 flex flex-wrap gap-1.5 text-[10px]">
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getPaymentMethodLabel(row.paymentMethod)}</span>
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getSlipStatusLabel(row.paymentStatus)}</span>
        </div>
      </td>
      <td class="py-3.5 px-4 text-center align-top">
        <span class="inline-flex min-w-[44px] items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800 px-3 py-1 text-xs font-bold text-stone-800 dark:text-stone-100">${row.quantity}</span>
      </td>
      <td class="py-3.5 px-4 min-w-[120px] align-top">${row.paidTime ? formatCompactDate(row.paidTime) : '-'}</td>
      <td class="py-3.5 px-4 text-right align-top font-black text-primary dark:text-amber-300 font-sans">${formatMoney(row.price)}</td>
      <td class="py-3.5 px-4 text-right align-top font-semibold text-stone-700 dark:text-stone-200">${formatMoney(row.shippingFee)}</td>
      <td class="py-3.5 px-4 min-w-[220px] align-top">
        <p class="font-bold text-stone-900 dark:text-stone-100">${safeText(row.buyer, '-')}</p>
        <p class="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">${safeText(row.phone, '-')}</p>
        ${formatAddressMultiLine(row.address)}
      </td>
      <td class="py-3.5 px-4 text-center align-top min-w-[170px]">
        <div class="flex flex-col gap-2">
          <button onclick="openOrderDetailModal(${row.orderId})" class="border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2 text-[11px] font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition">
            <i class="fas fa-eye mr-1"></i> ดู
          </button>
          <button onclick="printShippingLabel(${row.orderId})" class="btn-primary px-3 py-2 text-[11px] font-bold shadow-sm">
            <i class="fas fa-print mr-1"></i> พิมพ์
          </button>
        </div>
      </td>
    </tr>
  `).join('');
};

// Final website orders table layout override:
// move quantity, price, and shipping below product name.
setupOrdersTableHeaders = function() {
  const headRow = document.querySelector('#orders-table-wrapper thead tr');
  if (!headRow) return;
  headRow.innerHTML = `
    <th class="py-3.5 px-4">วันที่สั่งซื้อ</th>
    <th class="py-3.5 px-4">เลขออเดอร์</th>
    <th class="py-3.5 px-4">ชื่อสินค้า</th>
    <th class="py-3.5 px-4">ผู้ซื้อ</th>
    <th class="py-3.5 px-4 text-center">จัดการ</th>
  `;
};

renderOrdersTable = function(list) {
  const wrapper = document.getElementById('orders-table-wrapper');
  const empty = document.getElementById('orders-empty');
  const tbody = document.getElementById('orders-rows');

  if (!wrapper || !empty || !tbody) return;

  if (!list.length) {
    wrapper.classList.add('hidden');
    empty.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  wrapper.classList.remove('hidden');

  tbody.innerHTML = list.map((row) => `
    <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
      <td class="py-3.5 px-4 min-w-[170px] align-top">
        <div class="space-y-1">
          <p class="font-bold text-stone-900 dark:text-stone-100">${formatCompactDate(row.orderDate)}</p>
          <p class="text-[10px] text-stone-500 dark:text-stone-400">ส่งภายใน: ${formatCompactDate(row.shipByDate)}</p>
          <p class="text-[10px] text-stone-500 dark:text-stone-400">ชำระเงิน: ${row.paidTime ? formatCompactDate(row.paidTime) : '-'}</p>
        </div>
      </td>
      <td class="py-3.5 px-4 min-w-[210px] align-top">
        <button onclick="openOrderDetailModal(${row.orderId})" class="text-left">
          <p class="font-extrabold text-stone-900 dark:text-stone-100 font-sans text-xs hover:text-primary transition">${row.orderNumber}</p>
          <p class="mt-1 font-mono text-[11px] text-stone-500 dark:text-stone-300">${safeText(row.trackingNumber, '-')}</p>
          <p class="text-[10px] text-stone-400 mt-1">${getStatusBadge(row.status)}</p>
        </button>
      </td>
      <td class="py-3.5 px-4 min-w-[340px] align-top">
        <p class="font-mono text-[11px] font-bold text-stone-600 dark:text-stone-300 mb-1">${safeText(row.sku, '-')}</p>
        <p class="font-semibold text-stone-900 dark:text-stone-100">${safeText(row.productName, '-')}</p>
        <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div class="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/70 px-3 py-2">
            <p class="text-[10px] font-bold text-stone-400 dark:text-stone-500">จำนวน</p>
            <p class="mt-1 text-xs font-extrabold text-stone-900 dark:text-stone-100">${row.quantity}</p>
          </div>
          <div class="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/70 px-3 py-2">
            <p class="text-[10px] font-bold text-stone-400 dark:text-stone-500">ราคา</p>
            <p class="mt-1 text-xs font-black text-primary dark:text-amber-300 font-sans">${formatMoney(row.price)}</p>
          </div>
          <div class="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/70 px-3 py-2">
            <p class="text-[10px] font-bold text-stone-400 dark:text-stone-500">ค่าจัดส่ง</p>
            <p class="mt-1 text-xs font-bold text-stone-700 dark:text-stone-200">${formatMoney(row.shippingFee)}</p>
          </div>
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getPaymentMethodLabel(row.paymentMethod)}</span>
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getSlipStatusLabel(row.paymentStatus)}</span>
        </div>
      </td>
      <td class="py-3.5 px-4 min-w-[220px] align-top">
        <p class="font-bold text-stone-900 dark:text-stone-100">${safeText(row.buyer, '-')}</p>
        <p class="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">${safeText(row.phone, '-')}</p>
        ${formatAddressMultiLine(row.address)}
      </td>
      <td class="py-3.5 px-4 text-center align-top min-w-[170px]">
        <div class="flex flex-col gap-2">
          <button onclick="openOrderDetailModal(${row.orderId})" class="border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2 text-[11px] font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition">
            <i class="fas fa-eye mr-1"></i> ดู
          </button>
          <button onclick="printShippingLabel(${row.orderId})" class="btn-primary px-3 py-2 text-[11px] font-bold shadow-sm">
            <i class="fas fa-print mr-1"></i> พิมพ์
          </button>
        </div>
      </td>
    </tr>
  `).join('');
};

setupOrdersTableHeaders = function() {
  const headRow = document.querySelector('#orders-table-wrapper thead tr');
  if (!headRow) return;
  headRow.innerHTML = `
    <th class="py-3.5 px-4">วันที่สั่งซื้อ</th>
    <th class="py-3.5 px-4">เลขออเดอร์</th>
    <th class="py-3.5 px-4">ชื่อสินค้า</th>
    <th class="py-3.5 px-4">ผู้ซื้อ</th>
    <th class="py-3.5 px-4 text-center">จัดการ</th>
  `;
};

renderOrdersTable = function(list) {
  const wrapper = document.getElementById('orders-table-wrapper');
  const empty = document.getElementById('orders-empty');
  const tbody = document.getElementById('orders-rows');

  if (!wrapper || !empty || !tbody) return;

  if (!list.length) {
    wrapper.classList.add('hidden');
    empty.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  wrapper.classList.remove('hidden');

  tbody.innerHTML = list.map((row) => `
    <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
      <td class="py-3.5 px-4 min-w-[170px] align-top">
        <div class="space-y-1">
          <p class="font-bold text-stone-900 dark:text-stone-100">${formatCompactDate(row.orderDate)}</p>
          <p class="text-[10px] text-stone-500 dark:text-stone-400">ส่งภายใน: ${formatCompactDate(row.shipByDate)}</p>
          <p class="text-[10px] text-stone-500 dark:text-stone-400">ชำระเงิน: ${row.paidTime ? formatCompactDate(row.paidTime) : '-'}</p>
        </div>
      </td>
      <td class="py-3.5 px-4 min-w-[210px] align-top">
        <button onclick="openOrderDetailModal(${row.orderId})" class="text-left">
          <p class="font-extrabold text-stone-900 dark:text-stone-100 font-sans text-xs hover:text-primary transition">${row.orderNumber}</p>
          <p class="mt-1 font-mono text-[11px] text-stone-500 dark:text-stone-300">${safeText(row.trackingNumber, '-')}</p>
          <p class="text-[10px] text-stone-400 mt-1">${getStatusBadge(row.status)}</p>
        </button>
      </td>
      <td class="py-3.5 px-4 min-w-[340px] align-top">
        <p class="font-mono text-[11px] font-bold text-stone-600 dark:text-stone-300 mb-1">${safeText(row.sku, '-')}</p>
        <p class="font-semibold text-stone-900 dark:text-stone-100">${safeText(row.productName, '-')}</p>
        <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div class="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/70 px-3 py-2">
            <p class="text-[10px] font-bold text-stone-400 dark:text-stone-500">จำนวน</p>
            <p class="mt-1 text-xs font-extrabold text-stone-900 dark:text-stone-100">${row.quantity}</p>
          </div>
          <div class="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/70 px-3 py-2">
            <p class="text-[10px] font-bold text-stone-400 dark:text-stone-500">ราคา</p>
            <p class="mt-1 text-xs font-black text-primary dark:text-amber-300 font-sans">${formatMoney(row.price)}</p>
          </div>
          <div class="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/70 px-3 py-2">
            <p class="text-[10px] font-bold text-stone-400 dark:text-stone-500">ค่าจัดส่ง</p>
            <p class="mt-1 text-xs font-bold text-stone-700 dark:text-stone-200">${formatMoney(row.shippingFee)}</p>
          </div>
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getPaymentMethodLabel(row.paymentMethod)}</span>
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getSlipStatusLabel(row.paymentStatus)}</span>
        </div>
      </td>
      <td class="py-3.5 px-4 min-w-[220px] align-top">
        <p class="font-bold text-stone-900 dark:text-stone-100">${safeText(row.buyer, '-')}</p>
        <p class="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">${safeText(row.phone, '-')}</p>
        ${formatAddressMultiLine(row.address)}
      </td>
      <td class="py-3.5 px-4 text-center align-top min-w-[170px]">
        <div class="flex flex-col gap-2">
          <button onclick="openOrderDetailModal(${row.orderId})" class="border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2 text-[11px] font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition">
            <i class="fas fa-eye mr-1"></i> ดู
          </button>
          <button onclick="printShippingLabel(${row.orderId})" class="btn-primary px-3 py-2 text-[11px] font-bold shadow-sm">
            <i class="fas fa-print mr-1"></i> พิมพ์
          </button>
        </div>
      </td>
    </tr>
  `).join('');
};

setupOrdersTableHeaders = function() {
  const headRow = document.querySelector('#orders-table-wrapper thead tr');
  if (!headRow) return;
  headRow.innerHTML = `
    <th class="py-3.5 px-4">วันที่สั่งซื้อ</th>
    <th class="py-3.5 px-4">เลขออเดอร์</th>
    <th class="py-3.5 px-4">ชื่อสินค้า</th>
    <th class="py-3.5 px-4">ผู้ซื้อ</th>
    <th class="py-3.5 px-4 text-center">จัดการ</th>
  `;
};

renderOrdersTable = function(list) {
  const wrapper = document.getElementById('orders-table-wrapper');
  const empty = document.getElementById('orders-empty');
  const tbody = document.getElementById('orders-rows');

  if (!wrapper || !empty || !tbody) return;

  if (!list.length) {
    wrapper.classList.add('hidden');
    empty.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  wrapper.classList.remove('hidden');

  tbody.innerHTML = list.map((row) => `
    <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
      <td class="py-3.5 px-4 min-w-[170px] align-top">
        <div class="space-y-1">
          <p class="font-bold text-stone-900 dark:text-stone-100">${formatCompactDate(row.orderDate)}</p>
          <p class="text-[10px] text-stone-500 dark:text-stone-400">ส่งภายใน: ${formatCompactDate(row.shipByDate)}</p>
          <p class="text-[10px] text-stone-500 dark:text-stone-400">ชำระเงิน: ${row.paidTime ? formatCompactDate(row.paidTime) : '-'}</p>
        </div>
      </td>
      <td class="py-3.5 px-4 min-w-[210px] align-top">
        <button onclick="openOrderDetailModal(${row.orderId})" class="text-left">
          <p class="font-extrabold text-stone-900 dark:text-stone-100 font-sans text-xs hover:text-primary transition">${row.orderNumber}</p>
          <p class="mt-1 font-mono text-[11px] text-stone-500 dark:text-stone-300">${safeText(row.trackingNumber, '-')}</p>
          <p class="text-[10px] text-stone-400 mt-1">${getStatusBadge(row.status)}</p>
        </button>
      </td>
      <td class="py-3.5 px-4 min-w-[320px] align-top">
        <p class="font-mono text-[11px] font-bold text-stone-600 dark:text-stone-300 mb-1">${safeText(row.sku, '-')}</p>
        <p class="font-semibold text-stone-900 dark:text-stone-100">${safeText(row.productName, '-')}</p>
        <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div class="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/70 px-3 py-2">
            <p class="text-[10px] font-bold text-stone-400 dark:text-stone-500">จำนวน</p>
            <p class="mt-1 text-xs font-extrabold text-stone-900 dark:text-stone-100">${row.quantity}</p>
          </div>
          <div class="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/70 px-3 py-2">
            <p class="text-[10px] font-bold text-stone-400 dark:text-stone-500">ราคา</p>
            <p class="mt-1 text-xs font-black text-primary dark:text-amber-300 font-sans">${formatMoney(row.price)}</p>
          </div>
          <div class="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800/70 px-3 py-2">
            <p class="text-[10px] font-bold text-stone-400 dark:text-stone-500">ค่าจัดส่ง</p>
            <p class="mt-1 text-xs font-bold text-stone-700 dark:text-stone-200">${formatMoney(row.shippingFee)}</p>
          </div>
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getPaymentMethodLabel(row.paymentMethod)}</span>
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getSlipStatusLabel(row.paymentStatus)}</span>
        </div>
      </td>
      <td class="py-3.5 px-4 min-w-[220px] align-top">
        <p class="font-bold text-stone-900 dark:text-stone-100">${safeText(row.buyer, '-')}</p>
        <p class="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">${safeText(row.phone, '-')}</p>
        ${formatAddressMultiLine(row.address)}
      </td>
      <td class="py-3.5 px-4 text-center align-top min-w-[170px]">
        <div class="flex flex-col gap-2">
          <button onclick="openOrderDetailModal(${row.orderId})" class="border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2 text-[11px] font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition">
            <i class="fas fa-eye mr-1"></i> ดู
          </button>
          <button onclick="printShippingLabel(${row.orderId})" class="btn-primary px-3 py-2 text-[11px] font-bold shadow-sm">
            <i class="fas fa-print mr-1"></i> พิมพ์
          </button>
        </div>
      </td>
    </tr>
  `).join('');
};

setOrdersTab = function(tab) {
  currentOrdersTab = ['website', 'shopee', 'tiktok'].includes(tab) ? tab : 'website';
  updateOrdersTabUi();
  if (currentOrdersTab !== 'website') {
    loadMarketplaceImportData(currentOrdersTab);
  }
};

window.setOrdersTab = setOrdersTab;

window.setOrdersTab = setOrdersTab;

const marketplaceViewState = {
  shopee: { search: '', tracking: 'all', quantity: 'all', startDate: '', endDate: '' },
  tiktok: { search: '', tracking: 'all', quantity: 'all', startDate: '', endDate: '' },
};

function getMarketplaceUploadMeta(platform, batch, totalRows) {
  const platformLabel = platform === 'shopee' ? 'Shopee' : 'TikTok';
  if (!batch) {
    return `${platformLabel}: ยังไม่มีไฟล์อัปโหลด`;
  }
  return `${platformLabel}: ${safeText(batch.file_name, '-')} • ${Number(totalRows || 0).toLocaleString()} รายการ • ${formatDate(batch.created_at)}`;
}

function filterMarketplaceDisplayRows(platform, rows) {
  const state = marketplaceViewState[platform] || {};
  const keyword = String(state.search || '').trim().toLowerCase();
  const trackingFilter = state.tracking || 'all';
  const quantityFilter = state.quantity || 'all';
  const startDate = state.startDate || '';
  const endDate = state.endDate || '';

  return (rows || []).filter((row) => {
    const haystack = [
      row?.order_number,
      row?.buyer,
      row?.sku,
      row?.product_name,
      row?.tracking_number,
      row?.ship_by_date,
      row?.order_date,
    ].map((value) => String(value || '').toLowerCase()).join(' ');

    if (keyword && !haystack.includes(keyword)) return false;

    const hasTracking = !!String(row?.tracking_number || '').trim();
    if (trackingFilter === 'with_tracking' && !hasTracking) return false;
    if (trackingFilter === 'without_tracking' && hasTracking) return false;

    const quantity = Number(row?.quantity || 0);
    if (quantityFilter === 'single' && quantity !== 1) return false;
    if (quantityFilter === 'multiple' && quantity <= 1) return false;

    const orderDateRaw = String(row?.order_date || '').trim();
    const normalizedDate = orderDateRaw ? orderDateRaw.slice(0, 10) : '';
    if (startDate && normalizedDate && normalizedDate < startDate) return false;
    if (endDate && normalizedDate && normalizedDate > endDate) return false;

    return true;
  });
}

window.updateMarketplaceSearch = function updateMarketplaceSearch(platform, value) {
  if (!marketplaceViewState[platform]) marketplaceViewState[platform] = { search: '', tracking: 'all', quantity: 'all', startDate: '', endDate: '' };
  marketplaceViewState[platform].search = value || '';
  renderMarketplaceImportData(platform);
};

window.updateMarketplaceFilter = function updateMarketplaceFilter(platform, key, value) {
  if (!marketplaceViewState[platform]) marketplaceViewState[platform] = { search: '', tracking: 'all', quantity: 'all', startDate: '', endDate: '' };
  marketplaceViewState[platform][key] = value || '';
  renderMarketplaceImportData(platform);
};

window.clearMarketplaceDateFilter = function clearMarketplaceDateFilter(platform) {
  if (!marketplaceViewState[platform]) marketplaceViewState[platform] = { search: '', tracking: 'all', quantity: 'all', startDate: '', endDate: '' };
  marketplaceViewState[platform].startDate = '';
  marketplaceViewState[platform].endDate = '';
  renderMarketplaceImportData(platform);
};

window.refreshMarketplaceTab = function refreshMarketplaceTab(platform) {
  loadMarketplaceImportData(platform);
};

renderMarketplaceImportData = function(platform) {
  const panel = document.getElementById(`orders-tab-panel-${platform}`);
  if (!panel) return;

  const platformLabel = platform === 'shopee' ? 'Shopee' : 'TikTok';
  const state = marketplaceImports[platform] || { batch: null, rows: [] };
  const batch = state.batch;
  const sourceRows = state.rows || [];
  const rows = filterMarketplaceDisplayRows(platform, sourceRows);
  const searchValue = marketplaceViewState[platform]?.search || '';
  const trackingValue = marketplaceViewState[platform]?.tracking || 'all';
  const quantityValue = marketplaceViewState[platform]?.quantity || 'all';
  const startDateValue = marketplaceViewState[platform]?.startDate || '';
  const endDateValue = marketplaceViewState[platform]?.endDate || '';

  const metaText = getMarketplaceUploadMeta(platform, batch, sourceRows.length);

  panel.className = 'orders-tab-panel panel p-4 md:p-5 space-y-4';
  panel.innerHTML = `
    <div class="flex flex-col xl:flex-row gap-3 items-stretch xl:items-center justify-between">
      <div class="relative flex-1">
        <input
          type="text"
          value="${safeText(searchValue, '')}"
          oninput="updateMarketplaceSearch('${platform}', this.value)"
          placeholder="ค้นหาเลขออเดอร์ / ชื่อผู้ซื้อ / SKU / เลขพัสดุ..."
          class="inp pl-10 text-xs py-2.5"
        >
        <i class="fas fa-search absolute left-3.5 top-3 text-stone-400 text-xs"></i>
      </div>

      <div class="flex flex-wrap gap-2">
        <button onclick="${platform === 'shopee' ? 'ordersShopee' : 'ordersTiktok'}.uploadFile()" class="flex items-center justify-center gap-1.5 border ${platform === 'shopee' ? 'border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40' : 'border-fuchsia-200 dark:border-fuchsia-800 text-fuchsia-700 dark:text-fuchsia-300 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-950/40'} rounded-xl px-4 py-2.5 text-xs font-bold transition whitespace-nowrap">
          <i class="fas fa-upload text-[11px]"></i> Upload ${platformLabel}
        </button>
        <button onclick="${platform === 'shopee' ? 'ordersShopee' : 'ordersTiktok'}.exportFile()" class="flex items-center justify-center gap-1.5 border ${platform === 'shopee' ? 'border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40' : 'border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40'} rounded-xl px-4 py-2.5 text-xs font-bold transition whitespace-nowrap">
          <i class="fas fa-file-excel text-[11px]"></i> Export ${platformLabel}
        </button>
        <button onclick="refreshMarketplaceTab('${platform}')" class="flex items-center justify-center gap-1.5 border border-stone-200 dark:border-stone-700 rounded-xl px-4 py-2.5 text-xs font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition">
          <i class="fas fa-rotate-right text-[10px]"></i> รีเฟรช
        </button>
      </div>
    </div>

    <div class="flex flex-wrap gap-2.5 items-center">
      <select onchange="updateMarketplaceFilter('${platform}', 'tracking', this.value)" class="inp text-xs py-2.5 flex-1 min-w-[180px] cursor-pointer">
        <option value="all" ${trackingValue === 'all' ? 'selected' : ''}>สถานะพัสดุทั้งหมด</option>
        <option value="with_tracking" ${trackingValue === 'with_tracking' ? 'selected' : ''}>มีเลขพัสดุแล้ว</option>
        <option value="without_tracking" ${trackingValue === 'without_tracking' ? 'selected' : ''}>ยังไม่มีเลขพัสดุ</option>
      </select>

      <select onchange="updateMarketplaceFilter('${platform}', 'quantity', this.value)" class="inp text-xs py-2.5 flex-1 min-w-[180px] cursor-pointer">
        <option value="all" ${quantityValue === 'all' ? 'selected' : ''}>จำนวนทั้งหมด</option>
        <option value="single" ${quantityValue === 'single' ? 'selected' : ''}>ออเดอร์ 1 ชิ้น</option>
        <option value="multiple" ${quantityValue === 'multiple' ? 'selected' : ''}>ออเดอร์มากกว่า 1 ชิ้น</option>
      </select>

      <div class="flex items-center gap-1.5 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-1.5 text-xs min-w-[290px]">
        <i class="fas fa-calendar-alt text-primary dark:text-amber-400 text-xs"></i>
        <input type="date" value="${safeText(startDateValue, '')}" onchange="updateMarketplaceFilter('${platform}', 'startDate', this.value)" class="bg-transparent text-stone-800 dark:text-stone-200 text-xs font-semibold focus:outline-none cursor-pointer" title="วันที่เริ่มต้น">
        <span class="text-stone-400 text-xs font-bold">-</span>
        <input type="date" value="${safeText(endDateValue, '')}" onchange="updateMarketplaceFilter('${platform}', 'endDate', this.value)" class="bg-transparent text-stone-800 dark:text-stone-200 text-xs font-semibold focus:outline-none cursor-pointer" title="วันที่สิ้นสุด">
        <button type="button" onclick="clearMarketplaceDateFilter('${platform}')" title="ล้างวันที่" class="text-stone-400 hover:text-rose-500 text-xs ml-1 transition">
          <i class="fas fa-times-circle"></i>
        </button>
      </div>
    </div>

    <div class="rounded-2xl border border-stone-200/70 dark:border-stone-800/70 bg-stone-50/70 dark:bg-stone-900/50 px-4 py-3">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div>
          <p class="text-xs font-bold text-stone-900 dark:text-stone-100">ไฟล์ล่าสุดของ ${platformLabel}</p>
          <p class="text-[11px] text-stone-500 dark:text-stone-400">${safeText(metaText, '-')}</p>
        </div>
        <span class="inline-flex items-center justify-center rounded-full bg-white dark:bg-stone-950 border border-stone-200 dark:border-stone-800 px-3 py-1 text-[11px] font-bold text-stone-600 dark:text-stone-300">
          ${rows.length.toLocaleString()} / ${sourceRows.length.toLocaleString()} รายการ
        </span>
      </div>
    </div>

    <div class="panel overflow-hidden">
      ${!batch ? `
        <div class="py-16 text-center space-y-3">
          <i class="fas fa-file-import text-4xl text-stone-300 dark:text-stone-700"></i>
          <p class="text-sm font-bold text-stone-600 dark:text-stone-400">ยังไม่มีข้อมูลจากไฟล์ ${platformLabel}</p>
          <button onclick="${platform === 'shopee' ? 'ordersShopee' : 'ordersTiktok'}.uploadFile()" class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm">
            <i class="fas fa-upload text-[11px]"></i> อัปโหลดไฟล์ ${platformLabel}
          </button>
        </div>
      ` : `
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/60 text-[11px] font-bold text-stone-400 uppercase tracking-wider">
                <th class="py-3.5 px-4">วันที่สั่งซื้อ</th>
                <th class="py-3.5 px-4">เลขออเดอร์</th>
                <th class="py-3.5 px-4">ชื่อสินค้า</th>
                <th class="py-3.5 px-4 text-center">จำนวน</th>
                <th class="py-3.5 px-4 text-right">ราคา</th>
                <th class="py-3.5 px-4 text-right">ค่าจัดส่ง</th>
                <th class="py-3.5 px-4">ผู้ซื้อ</th>
                <th class="py-3.5 px-4 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-stone-100 dark:divide-stone-800/60 text-xs">
              ${rows.length ? rows.map((row) => {
                const tracking = safeText(row.tracking_number, '-');
                const address = (() => {
                  const payload = safeParseJson(row.raw_payload, {});
                  return safeText(
                    row.address ||
                    row.buyer_address ||
                    row.shipping_address ||
                    payload['Shipping Address'] ||
                    payload['Address'] ||
                    '',
                    '-'
                  );
                })();
                const rawPayloadText = encodeURIComponent(JSON.stringify(safeParseJson(row.raw_payload, {}), null, 2));
                return `
                  <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
                    <td class="py-3.5 px-4 min-w-[170px] align-top">
                      <div class="space-y-1">
                        <p class="font-bold text-stone-900 dark:text-stone-100">${row.order_date ? formatCompactDate(row.order_date) : '-'}</p>
                        <p class="text-[10px] text-stone-500 dark:text-stone-400">ส่งภายใน: ${row.ship_by_date ? formatCompactDate(row.ship_by_date) : '-'}</p>
                        <p class="text-[10px] text-stone-500 dark:text-stone-400">ชำระเงิน: ${row.paid_time ? formatCompactDate(row.paid_time) : '-'}</p>
                      </div>
                    </td>
                    <td class="py-3.5 px-4 min-w-[210px] align-top">
                      <div class="text-left">
                        <p class="font-extrabold text-stone-900 dark:text-stone-100 font-sans text-xs">${safeText(row.order_number, '-')}</p>
                        <p class="mt-1 font-mono text-[11px] text-stone-500 dark:text-stone-300">${tracking}</p>
                        <p class="text-[10px] text-stone-400 mt-1">${platformLabel}</p>
                      </div>
                    </td>
                    <td class="py-3.5 px-4 min-w-[220px] align-top">
                      <p class="font-mono text-[11px] font-bold text-stone-600 dark:text-stone-300 mb-1">${safeText(row.sku, '-')}</p>
                      <p class="font-semibold text-stone-900 dark:text-stone-100">${safeText(row.product_name, '-')}</p>
                    </td>
                    <td class="py-3.5 px-4 text-center align-top">
                      <span class="inline-flex min-w-[44px] items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800 px-3 py-1 text-xs font-bold text-stone-800 dark:text-stone-100">${safeText(row.quantity, '-')}</span>
                    </td>
                    <td class="py-3.5 px-4 text-right align-top font-black text-primary dark:text-amber-300 font-sans">${safeText(row.price, '-')}</td>
                    <td class="py-3.5 px-4 text-right align-top font-semibold text-stone-700 dark:text-stone-200">${safeText(row.shipping_fee, '-')}</td>
                    <td class="py-3.5 px-4 min-w-[220px] align-top">
                      <p class="font-bold text-stone-900 dark:text-stone-100">${safeText(row.buyer, '-')}</p>
                      <p class="text-[10px] text-stone-500 dark:text-stone-400 mt-1 whitespace-pre-wrap break-words">${address}</p>
                    </td>
                    <td class="py-3.5 px-4 text-center align-top min-w-[170px]">
                      <div class="flex flex-col gap-2">
                        <button type="button" class="border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2 text-[11px] font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition disabled:opacity-50" data-value="${tracking === '-' ? '' : tracking}" onclick="copyMarketplaceField(this.dataset.value)" ${tracking && tracking !== '-' ? '' : 'disabled'}>
                          <i class="fas fa-copy mr-1"></i> คัดลอก
                        </button>
                        <button type="button" class="btn-primary px-3 py-2 text-[11px] font-bold shadow-sm" data-raw="${rawPayloadText}" onclick="viewMarketplaceRaw(this.dataset.raw)">
                          <i class="fas fa-eye mr-1"></i> ดูข้อมูล
                        </button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('') : `
                <tr>
                  <td colspan="8" class="py-12 px-4 text-center text-stone-400">ไม่พบรายการที่ตรงกับการค้นหา</td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
};

const __saveTrackingNumberFromModalOriginal = saveTrackingNumberFromModal;
saveTrackingNumberFromModal = async function() {
  try {
    await __saveTrackingNumberFromModalOriginal();
  } catch (error) {
    console.error('Save tracking number error:', error);
    if (isMissingTrackingNumberColumnError(error)) {
      showToast('ฐานข้อมูล orders ยังไม่มีคอลัมน์ tracking_number กรุณารัน SQL เพิ่มคอลัมน์นี้ก่อน');
      return;
    }
    throw error;
  }
};

const __quickUpdateOrderStatusOriginal = quickUpdateOrderStatus;
quickUpdateOrderStatus = async function(orderId, newStatus) {
  try {
    await __quickUpdateOrderStatusOriginal(orderId, newStatus);
  } catch (error) {
    console.error('Update status error:', error);
    if (isMissingTrackingNumberColumnError(error)) {
      showToast('ฐานข้อมูล orders ยังไม่มีคอลัมน์ tracking_number กรุณารัน SQL เพิ่มคอลัมน์นี้ก่อน');
      return;
    }
    throw error;
  }
};

window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (window.ordersWebsite?.init) {
    window.ordersWebsite.init();
  } else {
    setupOrdersTableHeaders();
    setOrdersTab('website');
  }
  initSupabase();
  setupOrdersAuth();
});

setupOrdersTableHeaders = function() {
  const headRow = document.querySelector('#orders-table-wrapper thead tr');
  if (!headRow) return;
  headRow.innerHTML = `
    <th class="py-3.5 px-4">วันที่สั่งซื้อ</th>
    <th class="py-3.5 px-4">เลขออเดอร์</th>
    <th class="py-3.5 px-4">ชื่อสินค้า</th>
    <th class="py-3.5 px-4 text-center">จำนวน</th>
    <th class="py-3.5 px-4 text-right">ราคา</th>
    <th class="py-3.5 px-4 text-right">ค่าจัดส่ง</th>
    <th class="py-3.5 px-4">ผู้ซื้อ</th>
    <th class="py-3.5 px-4 text-center">จัดการ</th>
  `;
};

renderOrdersTable = function(list) {
  const wrapper = document.getElementById('orders-table-wrapper');
  const empty = document.getElementById('orders-empty');
  const tbody = document.getElementById('orders-rows');

  if (!wrapper || !empty || !tbody) return;

  if (!list.length) {
    wrapper.classList.add('hidden');
    empty.classList.remove('hidden');
    tbody.innerHTML = '';
    return;
  }

  empty.classList.add('hidden');
  wrapper.classList.remove('hidden');

  tbody.innerHTML = list.map((row) => `
    <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
      <td class="py-3.5 px-4 min-w-[170px] align-top">
        <div class="space-y-1">
          <p class="font-bold text-stone-900 dark:text-stone-100">${formatCompactDate(row.orderDate)}</p>
          <p class="text-[10px] text-stone-500 dark:text-stone-400">ส่งภายใน: ${formatCompactDate(row.shipByDate)}</p>
          <p class="text-[10px] text-stone-500 dark:text-stone-400">ชำระเงิน: ${row.paidTime ? formatCompactDate(row.paidTime) : '-'}</p>
        </div>
      </td>
      <td class="py-3.5 px-4 min-w-[210px] align-top">
        <button onclick="openOrderDetailModal(${row.orderId})" class="text-left">
          <p class="font-extrabold text-stone-900 dark:text-stone-100 font-sans text-xs hover:text-primary transition">${row.orderNumber}</p>
          <p class="mt-1 font-mono text-[11px] text-stone-500 dark:text-stone-300">${safeText(row.trackingNumber, '-')}</p>
          <p class="text-[10px] text-stone-400 mt-1">${getStatusBadge(row.status)}</p>
        </button>
      </td>
      <td class="py-3.5 px-4 min-w-[220px] align-top">
        <p class="font-mono text-[11px] font-bold text-stone-600 dark:text-stone-300 mb-1">${safeText(row.sku, '-')}</p>
        <p class="font-semibold text-stone-900 dark:text-stone-100">${safeText(row.productName, '-')}</p>
        <div class="mt-1 flex flex-wrap gap-1.5 text-[10px]">
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getPaymentMethodLabel(row.paymentMethod)}</span>
          <span class="inline-flex items-center gap-1 rounded-md border border-stone-200 dark:border-stone-700 px-2 py-1 text-stone-500 dark:text-stone-300">${getSlipStatusLabel(row.paymentStatus)}</span>
        </div>
      </td>
      <td class="py-3.5 px-4 text-center align-top">
        <span class="inline-flex min-w-[44px] items-center justify-center rounded-xl bg-stone-100 dark:bg-stone-800 px-3 py-1 text-xs font-bold text-stone-800 dark:text-stone-100">${row.quantity}</span>
      </td>
      <td class="py-3.5 px-4 text-right align-top font-black text-primary dark:text-amber-300 font-sans">${formatMoney(row.price)}</td>
      <td class="py-3.5 px-4 text-right align-top font-semibold text-stone-700 dark:text-stone-200">${formatMoney(row.shippingFee)}</td>
      <td class="py-3.5 px-4 min-w-[220px] align-top">
        <p class="font-bold text-stone-900 dark:text-stone-100">${safeText(row.buyer, '-')}</p>
        <p class="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">${safeText(row.phone, '-')}</p>
        ${formatAddressMultiLine(row.address)}
      </td>
      <td class="py-3.5 px-4 text-center align-top min-w-[170px]">
        <div class="flex flex-col gap-2">
          <button onclick="openOrderDetailModal(${row.orderId})" class="border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2 text-[11px] font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition">
            <i class="fas fa-eye mr-1"></i> ดู
          </button>
          <button onclick="printShippingLabel(${row.orderId})" class="btn-primary px-3 py-2 text-[11px] font-bold shadow-sm">
            <i class="fas fa-print mr-1"></i> พิมพ์
          </button>
        </div>
      </td>
    </tr>
  `).join('');
};
