// ==========================================
//  ร้านหนังสือรัตน์ – Storefront app.js
//  เชื่อมต่อ Supabase โดยตรง (ไม่ต้องตั้งค่า)
// ==========================================

const SUPABASE_URL  = 'https://ueptjmsurtshpcldpxxp.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcHRqbXN1cnRzaHBjbGRweHhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NjQzNDIsImV4cCI6MjEwMjI0MDM0Mn0.lma8_ZDsRl35NHAFv7qWE7kF-wQeNGp_uYdHbfM1958';

let supabaseClient        = null;
let realtimeChannel       = null;
let realtimeReloadTimer   = null;
let localProducts         = [];
let localCategories       = [];
let activeCategory        = 'all';
let currentModalProductId = null;
let modalImages           = [];
let currentImgIndex       = 0;
let storefrontSyncChannel = null;

const THEME_STORAGE_KEY = 'theme';
const CART_STORAGE_KEY = 'shop_cart';
const STOREFRONT_SYNC_STORAGE_KEY = 'ratt_storefront_sync';
const STOREFRONT_SYNC_CHANNEL_NAME = 'ratt-bookstore-storefront';

// ── Utility helpers ──────────────────────────────────────────────

function safeText(value, fallback = '') {
  const text = typeof value === 'string' ? value : (value ?? fallback);
  return typeof text === 'string' ? decodeMojibake(text) : text;
}

function safeParseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function normalizeMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizePhoneNumber(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

function isMetaPixelReady() {
  return typeof window !== 'undefined' && typeof window.fbq === 'function';
}

function getMetaPurchaseStorageKey(orderId) {
  return `meta_purchase_tracked_${orderId}`;
}

function hasTrackedMetaPurchase(orderId) {
  if (!orderId) return false;
  try {
    return localStorage.getItem(getMetaPurchaseStorageKey(orderId)) === '1';
  } catch {
    return false;
  }
}

function markMetaPurchaseTracked(orderId) {
  if (!orderId) return;
  try {
    localStorage.setItem(getMetaPurchaseStorageKey(orderId), '1');
  } catch {}
}

function trackMetaPurchaseOnce({ orderId, totalAmount, currency = 'THB', items = [] }) {
  if (!orderId || hasTrackedMetaPurchase(orderId)) return false;
  if (!isMetaPixelReady()) {
    console.warn('Meta Pixel (fbq) ยังไม่พร้อมใช้งาน');
    return false;
  }

  const normalizedValue = normalizeMoney(totalAmount);
  const contentIds = items
    .map((item) => safeText(item.product_sku || item.product_id || ''))
    .filter(Boolean);
  const numItems = items.reduce((sum, item) => sum + Math.max(0, parseInt(item.quantity, 10) || 0), 0);

  window.fbq('track', 'Purchase', {
    value: normalizedValue,
    currency,
    content_type: 'product',
    content_ids: contentIds,
    num_items: numItems
  });

  markMetaPurchaseTracked(orderId);
  console.log('Meta Pixel Purchase tracked:', { orderId, value: normalizedValue, currency });
  return true;
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

function getProductImages(prod) {
  const imgs = safeParseJson(prod?.images, []);
  return Array.isArray(imgs) ? imgs : [];
}

function getProductCategories(prod) {
  const cats = safeParseJson(prod?.categories, []);
  return Array.isArray(cats) ? cats : [];
}

function getCategoryName(cat) {
  if (!cat) return '';
  if (typeof cat === 'string') return cat.trim();
  if (typeof cat !== 'object') return '';
  return safeText(cat.name ?? cat.slug ?? cat.label ?? cat.title ?? cat.category).trim();
}

function normalizeProductCategories(prod) {
  return getProductCategories(prod)
    .map(c => ({ ...c, name: getCategoryName(c) }))
    .filter(c => c.name);
}

function getProductStockLimit(prod) {
  if (!prod) return Infinity;
  if (prod.stock_status && prod.stock_status !== 'instock') return 0;
  if (prod.manage_stock) {
    const qty = Number(prod.usable_stock_quantity ?? prod.stock_quantity);
    return Number.isFinite(qty) ? Math.max(0, qty) : 0;
  }
  return Infinity;
}

function isProductPurchasable(prod) {
  return getProductStockLimit(prod) > 0;
}

function getAvailableStockQuantity(prod) {
  if (!prod) return 0;
  const qty = Number(prod.usable_stock_quantity ?? prod.stock_quantity ?? 0);
  return Number.isFinite(qty) ? Math.max(0, qty) : 0;
}

// ── Theme ────────────────────────────────────────────────────────

function initTheme() {
  const stored = localStorage.getItem('theme');
  const isDark = stored === 'dark' ||
    (stored === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', isDark);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
}

// ── Supabase ─────────────────────────────────────────────────────

function initSupabase() {
  if (!window.supabase) {
    console.error('Supabase SDK ยังไม่โหลด');
    return false;
  }
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    subscribeProductsRealtime();
    console.log('Supabase connected:', SUPABASE_URL);
    return true;
  } catch (err) {
    console.error('Supabase init error:', err);
    return false;
  }
}

function subscribeProductsRealtime() {
  if (!supabaseClient) return;
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel = supabaseClient
    .channel('storefront-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, payload => {
      console.log('Realtime change:', payload.eventType);
      scheduleProductsReload(250);
    })
    .subscribe(status => console.log('Realtime status:', status));
}

function scheduleProductsReload(delay = 250) {
  clearTimeout(realtimeReloadTimer);
  realtimeReloadTimer = setTimeout(() => loadProducts(), delay);
}

function readCartFromStorage() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return (Array.isArray(parsed) ? parsed : []).map((item) => ({
      ...item,
      price: normalizeMoney(item.price),
      qty: Math.max(1, parseInt(item.qty, 10) || 1)
    }));
  } catch {
    return [];
  }
}

function syncCartFromStorage() {
  cart = readCartFromStorage();
  updateCartBadge();
  renderCartItems();
  refreshCheckoutSummary();
}

function refreshCheckoutSummary() {
  const summaryEl = document.getElementById('co-summary-items');
  if (!summaryEl) return;

  if (cart.length === 0) {
    summaryEl.innerHTML = '<p class="py-4 text-center text-xs text-stone-400">ยังไม่มีหนังสือในตะกร้า</p>';
  } else {
    summaryEl.innerHTML = cart.map(i => {
      const prod = localProducts.find(p => p.id === i.productId);
      const cover = i.cover || getProductImages(prod)[0]?.src || 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400';
      return `
        <div class="flex items-center justify-between text-xs py-2.5 gap-2">
          <div class="flex items-center gap-2.5 min-w-0">
            <img src="${cover}" alt="${i.name}" class="w-9 h-11 object-cover rounded-lg shrink-0 border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-800 shadow-sm">
            <span class="text-stone-700 dark:text-stone-300 font-medium truncate">${i.name} <span class="text-stone-400 font-bold ml-1">x${i.qty}</span></span>
          </div>
          <span class="font-bold text-stone-900 dark:text-amber-300 shrink-0 font-sans">฿${(i.price * i.qty).toLocaleString()}</span>
        </div>
      `;
    }).join('');
  }

  const totalText = '฿' + cartTotal().toLocaleString();
  const totalDisplay = document.getElementById('co-total-display');
  const promptpayTotal = document.getElementById('co-promptpay-total');
  if (totalDisplay) totalDisplay.textContent = totalText;
  if (promptpayTotal) promptpayTotal.textContent = totalText;
  updatePromptPayQR(cartTotal());
}

function emitStorefrontSync(type, payload = {}) {
  const message = { type, payload, sentAt: Date.now() };
  try {
    if (!storefrontSyncChannel && typeof BroadcastChannel !== 'undefined') {
      storefrontSyncChannel = new BroadcastChannel(STOREFRONT_SYNC_CHANNEL_NAME);
    }
    storefrontSyncChannel?.postMessage(message);
  } catch {}

  try {
    localStorage.setItem(STOREFRONT_SYNC_STORAGE_KEY, JSON.stringify(message));
  } catch {}
}

function handleStorefrontSyncMessage(message) {
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'theme-changed':
      initTheme();
      break;
    case 'cart-changed':
      syncCartFromStorage();
      break;
    case 'products-changed':
    case 'order-created':
      scheduleProductsReload(50);
      break;
    default:
      break;
  }
}

function setupStorefrontSync() {
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      storefrontSyncChannel = new BroadcastChannel(STOREFRONT_SYNC_CHANNEL_NAME);
      storefrontSyncChannel.onmessage = (event) => handleStorefrontSyncMessage(event.data);
    } catch {}
  }

  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY) {
      initTheme();
      return;
    }

    if (event.key === CART_STORAGE_KEY) {
      syncCartFromStorage();
      return;
    }

    if (event.key === STOREFRONT_SYNC_STORAGE_KEY && event.newValue) {
      try {
        handleStorefrontSyncMessage(JSON.parse(event.newValue));
      } catch {}
    }
  });
}

// ── Product loading ───────────────────────────────────────────────

async function loadProducts() {
  const spinner  = document.getElementById('loading-spinner');
  const grid     = document.getElementById('products-grid');
  const empty    = document.getElementById('empty-state');
  const emptyDesc = document.getElementById('empty-state-desc');

  spinner?.classList.remove('hidden');
  grid?.classList.add('hidden');
  empty?.classList.add('hidden');

  if (!supabaseClient) {
    spinner?.classList.add('hidden');
    empty?.classList.remove('hidden');
    if (emptyDesc) emptyDesc.textContent = 'ไม่สามารถเชื่อมต่อ Supabase ได้ กรุณาตรวจสอบ console';
    return;
  }

  try {
    const [{ data, error }, cats] = await Promise.all([
      supabaseClient.from('products').select('*').order('id', { ascending: false }),
      loadCategories()
    ]);

    if (error) throw error;

    localProducts   = data || [];
    localCategories = cats;
    spinner?.classList.add('hidden');

    if (localProducts.length === 0) {
      empty?.classList.remove('hidden');
      if (emptyDesc) emptyDesc.textContent = 'ยังไม่พบหนังสือในระบบ';
    } else {
      grid?.classList.remove('hidden');
      renderCategories();
      filterProducts();
    }
  } catch (err) {
    console.error('โหลดสินค้าผิดพลาด:', err);
    spinner?.classList.add('hidden');
    empty?.classList.remove('hidden');
    if (emptyDesc) emptyDesc.textContent = 'โหลดข้อมูลไม่สำเร็จ: ' + err.message;
  }
}

async function loadCategories() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient
      .from('products').select('categories').not('categories', 'is', null);
    if (error) throw error;

    const map = {};
    (data || []).forEach(row => {
      normalizeProductCategories(row).forEach(cat => {
        map[cat.name] = (map[cat.name] || 0) + 1;
      });
    });
    return Object.keys(map)
      .sort((a, b) => a.localeCompare(b, 'th'))
      .map(name => ({ name, count: map[name] }));
  } catch (err) {
    console.error('โหลดหมวดหมู่ผิดพลาด:', err);
    return [];
  }
}

// ── Category filter ───────────────────────────────────────────────

function renderCategories() {
  const el = document.getElementById('category-filter-list');
  if (!el) return;

  const baseBtn = 'text-left py-2.5 px-3 text-xs font-bold rounded-xl w-full transition duration-200 flex items-center justify-between border';
  const activeStyle = 'bg-gradient-to-r from-primary/10 to-orange-100 border-primary/20 text-primary';
  const inactiveStyle = 'hover:bg-stone-100 dark:hover:bg-stone-800 border-transparent text-stone-600 dark:text-stone-300';

  const allActive = activeCategory === 'all';
  el.innerHTML = `
    <button onclick="selectCategory('all')" id="cat-btn-all" class="${baseBtn} ${allActive ? activeStyle : inactiveStyle}">
      <span class="flex items-center gap-2"><i class="fas fa-border-all text-[11px] opacity-70"></i> ทั้งหมด</span>
      <span class="text-[10px] bg-stone-100 dark:bg-stone-800 font-bold px-2 py-0.5 rounded-lg text-stone-500" id="cat-count-all">${localProducts.length}</span>
    </button>
  `;

  localCategories.forEach(({ name, count }) => {
    const isActive = activeCategory === name;
    el.innerHTML += `
      <button onclick="selectCategory('${name}')" id="cat-btn-${name}" class="${baseBtn} ${isActive ? activeStyle : inactiveStyle}">
        <span class="truncate pr-2">${name}</span>
        <span class="text-[10px] bg-stone-100 dark:bg-stone-800 font-bold px-2 py-0.5 rounded-lg text-stone-500">${count}</span>
      </button>
    `;
  });
}

function selectCategory(category) {
  activeCategory = category;
  renderCategories();
  filterProducts();
}

// ── Search & filter ───────────────────────────────────────────────

function filterProducts() {
  const search       = document.getElementById('search-input')?.value.toLowerCase().trim() || '';
  const showInStock  = document.getElementById('filter-instock')?.checked ?? true;
  const showOut      = document.getElementById('filter-outofstock')?.checked ?? true;
  const minVal       = document.getElementById('filter-min-price')?.value;
  const maxVal       = document.getElementById('filter-max-price')?.value;
  const minPrice     = minVal === '' || minVal == null ? 0 : Number(minVal);
  const maxPrice     = maxVal === '' || maxVal == null ? Infinity : Number(maxVal);

  const filtered = localProducts.filter(prod => {
    const name = safeText(prod.name).toLowerCase();
    const sku  = safeText(prod.sku).toLowerCase();
    if (search && !name.includes(search) && !sku.includes(search)) return false;

    if (activeCategory !== 'all') {
      const cats = normalizeProductCategories(prod);
      if (!cats.some(c => c.name === activeCategory)) return false;
    }

    const instock = prod.stock_status === 'instock';
    if (instock && !showInStock) return false;
    if (!instock && !showOut) return false;

    const price = normalizeMoney(prod.price ?? prod.regular_price ?? prod.sale_price);
    if (price < minPrice || price > maxPrice) return false;

    return true;
  });

  renderProducts(filtered);
}

// ── Product rendering ─────────────────────────────────────────────

function renderProducts(list) {
  const grid    = document.getElementById('products-grid');
  const empty   = document.getElementById('empty-state');
  const counter = document.getElementById('product-count-display');
  if (!grid || !empty) return;

  if (counter) counter.textContent = list.length;

  if (list.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    const d = document.getElementById('empty-state-desc');
    if (d) d.textContent = 'ไม่พบหนังสือที่ตรงกับเงื่อนไข';
    return;
  }

  empty.classList.add('hidden');
  grid.classList.remove('hidden');
  grid.innerHTML = '';

  list.forEach(prod => {
    const instock   = isProductPurchasable(prod);
    const rawPrice  = prod.price ?? prod.regular_price ?? prod.sale_price;
    const price     = rawPrice != null && rawPrice !== ''
      ? parseFloat(rawPrice).toLocaleString() : 'ติดต่อผู้ขาย';
    const imgs      = getProductImages(prod);
    const cover     = imgs[0]?.src || 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400';
    const name      = safeText(prod.name, 'ไม่มีชื่อ');
    const sku       = safeText(prod.sku);
    const summary   = safeText(prod.short_description || prod.description, 'ยังไม่มีคำโปรยสำหรับหนังสือเล่มนี้');

    const badge = instock
      ? `<span class="badge-ok"><i class="fas fa-circle-check text-[9px]"></i> พร้อมส่ง ${prod.stock_quantity ?? 0}</span>`
      : `<span class="badge-no"><i class="fas fa-circle-xmark text-[9px]"></i> หมดชั่วคราว</span>`;

    grid.innerHTML += `
      <div onclick="openProductModal(${prod.id})" class="book-card group">
        <div class="card-img">
          <img src="${cover}" alt="${name}" loading="lazy">
          ${sku ? `<span class="absolute top-2 left-2 text-[9px] bg-black/60 text-white font-bold px-2 py-1 rounded-lg backdrop-blur-sm">${sku}</span>` : ''}
        </div>
        <div class="p-4 flex flex-col flex-1">
          <div class="flex items-start justify-between gap-2 mb-1">
            <h4 class="font-bold text-stone-900 dark:text-white line-clamp-2 text-sm leading-snug group-hover:text-primary transition">${name}</h4>
            ${badge}
          </div>
          <p class="text-xs text-stone-400 line-clamp-2 mt-1 flex-1">${summary}</p>
          <div class="flex items-center justify-between mt-4 pt-3 border-t border-stone-100 dark:border-stone-700">
            <div class="flex items-baseline gap-1">
              <span class="text-xs text-stone-400">ราคา</span>
              <span class="text-lg font-black text-primary dark:text-amber-400">${price}</span>
            </div>
            <button onclick="event.stopPropagation(); addToCart(${prod.id}, 1)" class="btn-add" ${!instock ? 'disabled' : ''}>
              <i class="fas fa-cart-plus text-[10px]"></i> หยิบใส่
            </button>
          </div>
        </div>
      </div>
    `;
  });
}

// ── Product modal ─────────────────────────────────────────────────

function openProductModal(productId) {
  const prod = localProducts.find(p => p.id === productId);
  if (!prod) return;
  currentModalProductId = productId;

  const modal     = document.getElementById('product-detail-modal');
  const rawPrice  = prod.price ?? prod.regular_price ?? prod.sale_price;
  const instock   = isProductPurchasable(prod);
  const stockLimit = getProductStockLimit(prod);

  document.getElementById('modal-title').textContent    = safeText(prod.name, 'ไม่มีชื่อ');
  document.getElementById('modal-sku').textContent      = safeText(prod.sku, 'N/A');
  document.getElementById('modal-price').textContent    = rawPrice != null && rawPrice !== ''
    ? parseFloat(rawPrice).toLocaleString() : 'สอบถามราคา';
  document.getElementById('modal-desc').innerHTML       = safeText(prod.description).replace(/\n/g, '<br>') || 'ยังไม่มีรายละเอียด';
  document.getElementById('modal-stock-qty').textContent = prod.stock_quantity != null
    ? `${prod.stock_quantity} เล่ม` : 'ไม่ได้ระบุ';

  const manageEl = document.getElementById('modal-manage-stock');
  // ── Carousel state ──────────────────────────────────
  const imgs    = getProductImages(prod);
  const mainImg = document.getElementById('modal-img-main');
  const thumbs  = document.getElementById('modal-img-thumbs');
  const dotsEl  = document.getElementById('modal-img-dots');

  // เก็บ images ไว้ใน global เพื่อให้ nav ใช้ได้
  modalImages     = imgs.length > 0 ? imgs : [{ src: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400', alt: '' }];
  currentImgIndex = 0;
  mainImg.src     = modalImages[0].src;

  // Thumbnails
  const FALLBACK_IMG = 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&q=80';
  thumbs.innerHTML = '';
  modalImages.forEach((img, i) => {
    const sel = i === 0 ? 'border-2 border-primary opacity-100' : 'border border-stone-200 dark:border-stone-700 opacity-60 hover:opacity-100';
    const div = document.createElement('div');
    const sizeClass = modalImages.length <= 4 ? 'flex-1 aspect-square min-w-0' : 'w-12 h-12 shrink-0';
    div.className = `${sizeClass} rounded-xl overflow-hidden cursor-pointer transition bg-stone-50 dark:bg-zinc-900 ${sel}`;
    div.innerHTML = `<img src="${img.src || FALLBACK_IMG}" class="w-full h-full object-cover" onerror="this.src='${FALLBACK_IMG}'">`;
    div.addEventListener('click', () => modalSetIndex(i));
    thumbs.appendChild(div);
  });

  // Dots
  dotsEl.innerHTML = '';
  if (modalImages.length > 1) {
    modalImages.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = `w-1.5 h-1.5 rounded-full transition-all duration-200 ${i === 0 ? 'bg-white scale-125' : 'bg-white/50'}`;
      dot.addEventListener('click', () => modalSetIndex(i));
      dotsEl.appendChild(dot);
    });
  }

  // ซ่อน/แสดงปุ่มลูกศร (ทั้งรูปใหญ่และรูปย่อ)
  const prevBtn = document.getElementById('modal-img-prev');
  const nextBtn = document.getElementById('modal-img-next');
  const thumbPrevBtn = document.getElementById('modal-thumb-prev');
  const thumbNextBtn = document.getElementById('modal-thumb-next');
  const hasMany = modalImages.length > 1;

  if (prevBtn) prevBtn.classList.toggle('!hidden', !hasMany);
  if (nextBtn) nextBtn.classList.toggle('!hidden', !hasMany);
  if (thumbPrevBtn) thumbPrevBtn.classList.toggle('!hidden', !hasMany);
  if (thumbNextBtn) thumbNextBtn.classList.toggle('!hidden', !hasMany);
  if (prod.manage_stock) {
    manageEl.textContent = 'ซิงก์สต็อกอัตโนมัติ';
    manageEl.className   = 'text-xs font-bold text-emerald-500';
  } else {
    manageEl.textContent = 'ไม่ได้เปิดคุมสต็อก';
    manageEl.className   = 'text-xs font-bold text-stone-400';
  }

  const badge = document.getElementById('modal-stock-badge');
  if (instock) {
    badge.textContent = 'พร้อมจัดส่ง (IN STOCK)';
    badge.className   = 'px-2.5 py-0.5 text-[9px] font-bold rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400';
  } else {
    badge.textContent = 'หมดชั่วคราว (OUT OF STOCK)';
    badge.className   = 'px-2.5 py-0.5 text-[9px] font-bold rounded-lg bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400';
  }

  const hasLen = prod.length != null && prod.length !== '';
  const hasWid = prod.width  != null && prod.width  !== '';
  const hasHei = prod.height != null && prod.height !== '';
  const dimCon = document.getElementById('modal-dimensions-container');
  if (hasLen || hasWid || hasHei) {
    dimCon?.classList.remove('hidden');
    document.getElementById('modal-len').textContent   = hasLen ? `${prod.length} ซม.` : '-';
    document.getElementById('modal-width').textContent = hasWid ? `${prod.width} ซม.` : '-';
    document.getElementById('modal-height').textContent= hasHei ? `${prod.height} ซม.` : '-';
  } else {
    dimCon?.classList.add('hidden');
  }

  const qtyInput     = document.getElementById('modal-qty');
  const addBtn       = document.getElementById('modal-add-to-cart');
  const incBtn       = document.getElementById('modal-qty-increase');
  const decBtn       = document.getElementById('modal-qty-decrease');
  const outOfStock   = stockLimit <= 0;

  qtyInput.value    = outOfStock ? 0 : 1;
  qtyInput.min      = outOfStock ? 0 : 1;
  qtyInput.max      = Number.isFinite(stockLimit) ? String(stockLimit) : '';
  qtyInput.readOnly = outOfStock;
  addBtn.disabled   = outOfStock;
  addBtn.classList.toggle('opacity-50', outOfStock);
  addBtn.classList.toggle('cursor-not-allowed', outOfStock);
  incBtn.disabled   = outOfStock;
  decBtn.disabled   = outOfStock;
  incBtn.classList.toggle('opacity-40', outOfStock);
  decBtn.classList.toggle('opacity-40', outOfStock);

  modal?.classList.remove('hidden');
}

function modalSetIndex(idx) {
  if (!modalImages.length) return;
  currentImgIndex = (idx + modalImages.length) % modalImages.length;
  const mainImg = document.getElementById('modal-img-main');
  const FALLBACK_IMG = 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&q=80';
  mainImg.style.opacity = '0';
  setTimeout(() => {
    mainImg.src = modalImages[currentImgIndex].src || FALLBACK_IMG;
    mainImg.onerror = () => { mainImg.src = FALLBACK_IMG; };
    mainImg.style.opacity = '1';
  }, 120);

  // อัปเดต thumbnails & scroll active thumbnail into view
  const thumbs = document.getElementById('modal-img-thumbs');
  const sizeClass = modalImages.length <= 4 ? 'flex-1 aspect-square min-w-0' : 'w-12 h-12 shrink-0';
  Array.from(thumbs.children).forEach((div, i) => {
    const isActive = i === currentImgIndex;
    div.className = `${sizeClass} rounded-xl overflow-hidden cursor-pointer transition bg-stone-50 dark:bg-zinc-900 ${
      isActive ? 'border-2 border-primary opacity-100' : 'border border-stone-200 dark:border-stone-700 opacity-60 hover:opacity-100'
    }`;
    if (isActive && modalImages.length > 4) {
      div.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  });

  // อัปเดต dots
  const dotsEl = document.getElementById('modal-img-dots');
  Array.from(dotsEl.children).forEach((dot, i) => {
    dot.className = `w-1.5 h-1.5 rounded-full transition-all duration-200 ${i === currentImgIndex ? 'bg-white scale-125' : 'bg-white/50'}`;
  });
}

function modalNavImg(direction) {
  modalSetIndex(currentImgIndex + direction);
}

// Touch swipe
let _touchStartX = 0;
function modalTouchStart(e) { _touchStartX = e.changedTouches[0].clientX; }
function modalTouchEnd(e) {
  const diff = _touchStartX - e.changedTouches[0].clientX;
  if (Math.abs(diff) > 40) modalNavImg(diff > 0 ? 1 : -1);
}

// ── Hover Zoom & Lightbox ─────────────────────────
function handleZoomMove(e) {
  const wrapper = e.currentTarget;
  const img = document.getElementById('modal-img-main');
  if (!img) return;
  const rect = wrapper.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  img.style.transformOrigin = `${x}% ${y}%`;
  img.style.transform = 'scale(2.2)';
}

function handleZoomLeave() {
  const img = document.getElementById('modal-img-main');
  if (!img) return;
  img.style.transformOrigin = 'center center';
  img.style.transform = 'scale(1)';
}

function openZoomLightbox() {
  const mainImg = document.getElementById('modal-img-main');
  const lightbox = document.getElementById('zoom-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  if (mainImg && lightbox && lightboxImg) {
    lightboxImg.src = mainImg.src;
    lightbox.classList.remove('hidden');
  }
}

function closeZoomLightbox() {
  document.getElementById('zoom-lightbox')?.classList.add('hidden');
}

function closeProductModal() {
  document.getElementById('product-detail-modal')?.classList.add('hidden');
  closeZoomLightbox();
}

function changeModalQty(delta) {
  const input      = document.getElementById('modal-qty');
  const current    = parseInt(input.value, 10) || 1;
  const prod       = localProducts.find(p => p.id === currentModalProductId);
  const stockLimit = getProductStockLimit(prod);
  const next       = Math.max(1, current + delta);
  if (Number.isFinite(stockLimit)) {
    input.value = Math.min(stockLimit, next);
    if (delta > 0 && current >= stockLimit) showToast(`เลือกได้สูงสุด ${stockLimit} ชิ้น`);
  } else {
    input.value = next;
  }
}

function validateModalQty() {
  const input      = document.getElementById('modal-qty');
  const prod       = localProducts.find(p => p.id === currentModalProductId);
  const stockLimit = getProductStockLimit(prod);
  let val = Math.max(1, parseInt(input.value, 10) || 1);
  if (Number.isFinite(stockLimit)) val = Math.min(stockLimit || 1, val);
  input.value = val;
}

// ── Cart ──────────────────────────────────────────────────────────

let cart = readCartFromStorage();

function saveCart() {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  emitStorefrontSync('cart-changed', { items: cart.length });
}

function updateCartBadge() {
  const total = cart.reduce((s, i) => s + i.qty, 0);
  const badge = document.getElementById('cart-badge');
  if (!badge) return;
  badge.textContent = total;
  badge.classList.toggle('hidden', total === 0);
}

function cartTotal() {
  return cart.reduce((s, i) => s + normalizeMoney(i.price) * (parseInt(i.qty, 10) || 0), 0);
}

function addToCart(productId, qty) {
  const prod       = localProducts.find(p => p.id === productId);
  if (!prod) return;
  const stockLimit = getProductStockLimit(prod);
  if (stockLimit <= 0) { showToast(`"${prod.name}" หมดชั่วคราว`); return; }

  const reqQty  = Math.max(1, parseInt(qty, 10) || 1);
  const price   = normalizeMoney(prod.price ?? prod.regular_price ?? prod.sale_price);
  const existing= cart.find(i => i.productId === productId);
  const curQty  = existing ? existing.qty : 0;
  const nextQty = Math.min(stockLimit, curQty + reqQty);

  if (existing && curQty >= stockLimit) {
    showToast(`เพิ่ม "${prod.name}" ได้สูงสุด ${stockLimit} ชิ้น`);
    return;
  }
  const cover   = getProductImages(prod)[0]?.src || '';
  if (existing) {
    existing.qty = nextQty;
    existing.price = price;
    if (cover) existing.cover = cover;
  } else {
    cart.push({ productId, name: prod.name, sku: prod.sku || '', price, qty: nextQty, cover });
  }
  saveCart();
  updateCartBadge();
  showToast(nextQty < curQty + reqQty
    ? `เพิ่ม "${prod.name}" ได้สูงสุด ${stockLimit} ชิ้น`
    : `เพิ่ม "${prod.name}" ลงตะกร้าแล้ว`);
}

function addToCartFromModal() {
  const qty = parseInt(document.getElementById('modal-qty').value) || 1;
  if (currentModalProductId) addToCart(currentModalProductId, qty);
  closeProductModal();
}

function openCartDrawer() {
  renderCartItems();
  document.getElementById('cart-drawer').style.transform = 'translateX(0)';
  document.getElementById('cart-overlay')?.classList.remove('hidden');
}

function closeCartDrawer() {
  document.getElementById('cart-drawer').style.transform = 'translateX(100%)';
  document.getElementById('cart-overlay')?.classList.add('hidden');
}

function renderCartItems() {
  const list = document.getElementById('cart-items-list');
  if (!list) return;

  if (cart.length === 0) {
    list.innerHTML = `<div class="py-16 text-center text-stone-400">
      <i class="fas fa-shopping-bag text-4xl mb-3 block opacity-20"></i>
      <p class="text-sm">ยังไม่มีหนังสือในตะกร้า</p>
    </div>`;
  } else {
    list.innerHTML = cart.map((item, idx) => {
      const prod  = localProducts.find(p => p.id === item.productId);
      const cover = item.cover || getProductImages(prod)[0]?.src || 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&q=80&w=400';
      return `
        <div class="flex items-center gap-3 bg-stone-50 dark:bg-stone-800/50 rounded-2xl p-2.5 border border-stone-100 dark:border-stone-800/80">
          <img src="${cover}" alt="${item.name}" class="w-12 h-16 object-cover rounded-xl shrink-0 border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 shadow-sm">
          <div class="flex-1 min-w-0">
            <p class="font-bold text-sm text-stone-800 dark:text-white truncate">${item.name}</p>
            ${item.sku ? `<p class="text-[10px] text-stone-400">SKU: ${item.sku}</p>` : ''}
            <p class="text-primary dark:text-amber-400 font-bold text-sm mt-0.5">฿${(item.price * item.qty).toLocaleString()}</p>
          </div>
          <div class="flex items-center border border-stone-200 dark:border-stone-600 rounded-lg overflow-hidden shrink-0 bg-white dark:bg-stone-800">
            <button onclick="changeCartQty(${idx}, -1)" class="w-6 h-6 flex items-center justify-center text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700 font-bold transition">−</button>
            <span class="w-6 text-center text-xs font-bold text-stone-800 dark:text-white">${item.qty}</span>
            <button onclick="changeCartQty(${idx}, 1)"  class="w-6 h-6 flex items-center justify-center text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700 font-bold transition">+</button>
          </div>
          <button onclick="removeFromCart(${idx})" class="text-stone-400 hover:text-rose-500 transition text-sm p-1" title="ลบออก"><i class="fas fa-trash"></i></button>
        </div>
      `;
    }).join('');
  }
  const totalEl = document.getElementById('cart-total-display');
  if (totalEl) totalEl.textContent = '฿' + cartTotal().toLocaleString();
}

function changeCartQty(idx, delta) {
  const item       = cart[idx];
  if (!item) return;
  const prod       = localProducts.find(p => p.id === item.productId);
  const stockLimit = getProductStockLimit(prod);
  const nextQty    = Math.max(1, item.qty + delta);
  if (delta > 0 && Number.isFinite(stockLimit)) {
    if (item.qty >= stockLimit) { showToast(`เพิ่ม "${item.name}" ได้สูงสุด ${stockLimit} ชิ้น`); return; }
    item.qty = Math.min(stockLimit, nextQty);
  } else {
    item.qty = nextQty;
  }
  saveCart(); updateCartBadge(); renderCartItems();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  saveCart(); updateCartBadge(); renderCartItems();
}

// ── Checkout ──────────────────────────────────────────────────────

const SLIP_MAX  = 5 * 1024 * 1024;
const SLIP_TYPES= new Set(['image/jpeg', 'image/png', 'image/webp']);
let selectedSlip = null;

function clearPaymentSlip() {
  selectedSlip = null;
  const input   = document.getElementById('co-payment-slip');
  const preview = document.getElementById('co-payment-slip-preview');
  const image   = document.getElementById('co-payment-slip-image');
  if (input) input.value = '';
  if (image?.src?.startsWith('blob:')) URL.revokeObjectURL(image.src);
  if (image) image.removeAttribute('src');
  preview?.classList.add('hidden');
  preview?.classList.remove('flex');
}

function handlePaymentSlipChange(event) {
  const file  = event.target.files?.[0] || null;
  const errEl = document.getElementById('co-error');
  if (!file) { clearPaymentSlip(); return; }
  if (!SLIP_TYPES.has(file.type)) {
    clearPaymentSlip();
    errEl.textContent = 'กรุณาแนบสลิปชนิด JPG, PNG หรือ WebP เท่านั้น';
    errEl.classList.remove('hidden'); return;
  }
  if (file.size > SLIP_MAX) {
    clearPaymentSlip();
    errEl.textContent = 'ไฟล์สลิปต้องมีขนาดไม่เกิน 5 MB';
    errEl.classList.remove('hidden'); return;
  }
  selectedSlip = file;
  const image = document.getElementById('co-payment-slip-image');
  if (image?.src?.startsWith('blob:')) URL.revokeObjectURL(image.src);
  image.src = URL.createObjectURL(file);
  document.getElementById('co-payment-slip-name').textContent = file.name;
  document.getElementById('co-payment-slip-size').textContent = `${(file.size / 1024).toFixed(1)} KB`;
  const preview = document.getElementById('co-payment-slip-preview');
  preview.classList.remove('hidden');
  preview.classList.add('flex');
  errEl.classList.add('hidden');
}

function slipToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('อ่านไฟล์สลิปไม่ได้'));
    reader.readAsDataURL(file);
  });
}

function openCheckout() {
  if (cart.length === 0) return;
  closeCartDrawer();

  // Reset address fields
  ['co-address-house','co-address-subdistrict','co-address-district','co-address-province','co-address-postcode'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  refreshCheckoutSummary();
  updateCheckoutPaymentUI();
  document.getElementById('checkout-form-section').classList.remove('hidden');
  document.getElementById('checkout-success-section').classList.add('hidden');
  document.getElementById('co-error').classList.add('hidden');
  document.getElementById('checkout-modal').classList.remove('hidden');
}

function updatePromptPayQR(amount) {
  const qrImg      = document.getElementById('co-promptpay-qr');
  const amountLabel = document.getElementById('co-qr-amount-label');
  if (!qrImg) return;

  const safeAmount = parseFloat(amount) || 0;
  const lineQrData = `LINE://qr/${encodeURIComponent(String(safeAmount))}`;
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(lineQrData)}`;

  if (amountLabel) amountLabel.textContent = '฿' + safeAmount.toLocaleString();
}

function closeCheckout() {
  document.getElementById('checkout-modal')?.classList.add('hidden');
}

function getSelectedPaymentMethod() {
  return document.querySelector('input[name="co-payment-method"]:checked')?.value || 'cod';
}

function updateCheckoutPaymentUI() {
  const method     = getSelectedPaymentMethod();
  const box        = document.getElementById('co-promptpay-box');
  const submitBtn  = document.getElementById('co-submit-btn');
  const slipUpload = document.getElementById('co-slip-upload-section');
  box?.classList.toggle('hidden', method !== 'line');
  slipUpload?.classList.toggle('hidden', method !== 'line');

  const codLabel      = document.getElementById('pay-cod-label');
  const promptpayLabel = document.getElementById('pay-promptpay-label');
  const activeClass   = ['border-primary', 'bg-primary/5', 'dark:bg-amber-900/20'];
  const inactiveClass = ['border-stone-200', 'dark:border-stone-700'];

  if (method === 'line') {
    codLabel?.classList.remove(...activeClass);
    codLabel?.classList.add(...inactiveClass);
    promptpayLabel?.classList.add(...activeClass);
    promptpayLabel?.classList.remove(...inactiveClass);
    submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> ยืนยันและแจ้งชำระ';
  } else {
    promptpayLabel?.classList.remove(...activeClass);
    promptpayLabel?.classList.add(...inactiveClass);
    codLabel?.classList.add(...activeClass);
    codLabel?.classList.remove(...inactiveClass);
    clearPaymentSlip();
    submitBtn.innerHTML = '<i class="fas fa-check-circle"></i> ยืนยันการสั่งซื้อ';
  }
}

async function submitOrder() {
  const name = document.getElementById('co-name').value.trim();
  const phoneInput = document.getElementById('co-phone');
  const phone = normalizePhoneNumber(phoneInput?.value);
  const house = document.getElementById('co-address-house').value.trim();
  const subdistrict = document.getElementById('co-address-subdistrict').value.trim();
  const district = document.getElementById('co-address-district').value.trim();
  const province = document.getElementById('co-address-province').value.trim();
  const postcode = document.getElementById('co-address-postcode').value.trim();
  const note = document.getElementById('co-note').value.trim();
  const method = getSelectedPaymentMethod();
  const errEl = document.getElementById('co-error');
  const address = [house, subdistrict, district, province, postcode].filter(Boolean).join(' ');

  if (phoneInput) {
    phoneInput.value = phone;
  }

  if (!name || !phone || !house || !province) {
    errEl.textContent = 'กรุณากรอกข้อมูลให้ครบ (ชื่อ, เบอร์โทร, บ้านเลขที่, จังหวัด)';
    errEl.classList.remove('hidden');
    return;
  }
  if (!/^0\d{9}$/.test(phone)) {
    errEl.textContent = 'กรุณากรอกเบอร์โทรศัพท์ให้ครบ 10 หลัก';
    errEl.classList.remove('hidden');
    phoneInput?.focus();
    return;
  }
  if (!supabaseClient) {
    errEl.textContent = 'ยังไม่ได้เชื่อมต่อ Supabase';
    errEl.classList.remove('hidden');
    return;
  }
  const btn = document.getElementById('co-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> กำลังส่งคำสั่งซื้อ...';
  errEl.classList.add('hidden');

  try {
    const stockValidatedItems = cart.map((item) => {
      const match = localProducts.find((prod) => String(prod.id) === String(item.productId));
      if (!match) {
        throw new Error(`ไม่พบข้อมูลหนังสือในระบบสำหรับรายการ ${item.name || item.productId}`);
      }

      const quantity = Math.max(1, parseInt(item.qty, 10) || 1);
      const available = getAvailableStockQuantity(match);
      if (match.manage_stock && quantity > available) {
        throw new Error(`สต็อกหนังสือ "${safeText(match.name, 'หนังสือ')}" ไม่เพียงพอ เหลือ ${available} เล่ม`);
      }

      return {
        product_id: match.id,
        product_name: item.name || match.name || 'หนังสือ',
        product_sku: item.sku || match.sku || null,
        quantity,
        unit_price: normalizeMoney(item.price ?? match.price ?? match.regular_price ?? match.sale_price)
      };
    });

    let slipPath = null;
    let slipName = null;

    if ((method === 'line' || method === 'promptpay') && selectedSlip) {
      try {
        const ext = (selectedSlip.name.split('.').pop() || 'jpg').toLowerCase();
        const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;
        const filePath = `slips/${filename}`;

        const { error: uploadErr } = await supabaseClient.storage
          .from('payment-slips')
          .upload(filePath, selectedSlip, {
            cacheControl: '3600',
            upsert: true,
            contentType: selectedSlip.type || 'image/jpeg'
          });

        if (!uploadErr) {
          const { data: pubData } = supabaseClient.storage
            .from('payment-slips')
            .getPublicUrl(filePath);
          slipPath = pubData?.publicUrl || filePath;
          slipName = selectedSlip.name;
        }
      } catch (e) {
        console.warn('Slip upload warning:', e);
      }
    }

    const orderPayload = {
      customer_name: name,
      customer_phone: phone,
      customer_address: address,
      note: note || null,
      payment_method: method,
      payment_status: 'pending',
      payment_amount: cartTotal(),
      total_amount: cartTotal(),
      payment_slip_path: slipPath,
      payment_slip_name: slipName,
      payment_slip_uploaded_at: slipPath ? new Date().toISOString() : null
    };

    const { data: rpcResult, error: orderErr } = await supabaseClient.rpc('create_order_with_stock', {
      order_payload: orderPayload,
      item_payloads: stockValidatedItems
    });

    if (orderErr) throw orderErr;

    const order = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    if (!order?.order_id) {
      throw new Error('ระบบไม่สามารถสร้างคำสั่งซื้อได้');
    }

    if (method === 'cod') {
      trackMetaPurchaseOnce({
        orderId: order.order_id,
        totalAmount: order.total_amount ?? orderPayload.total_amount,
        currency: 'THB',
        items: stockValidatedItems
      });
    }

    cart = [];
    saveCart();
    updateCartBadge();
    emitStorefrontSync('order-created', { orderId: order.order_id });

    stockValidatedItems.forEach((item) => {
      const prod = localProducts.find((row) => String(row.id) === String(item.product_id));
      if (!prod || !prod.manage_stock) return;
      const nextQty = Math.max(0, getAvailableStockQuantity(prod) - item.quantity);
      prod.usable_stock_quantity = nextQty;
      prod.stock_quantity = nextQty;
      prod.stock_status = nextQty > 0 ? 'instock' : 'outofstock';
    });

    filterProducts();
    emitStorefrontSync('products-changed', { source: 'checkout' });

    document.getElementById('co-order-number').textContent = order.order_number || `#${order.order_id}`;
    document.getElementById('co-success-payment-note').textContent =
      method === 'line' || method === 'promptpay' ? 'ชำระผ่านแอดมิน Line QR แล้ว สถานะ: รอตรวจสอบ' : 'ชำระเงินปลายทางเมื่อได้รับหนังสือ';

    clearPaymentSlip();
    document.getElementById('checkout-form-section').classList.add('hidden');
    document.getElementById('checkout-success-section').classList.remove('hidden');
  } catch (err) {
    console.error('Order error:', err);
    let msg = err.message || 'ไม่สามารถทำรายการได้';
    const rawMsg = String(msg).toLowerCase();

    if (rawMsg.includes('order_items_pkey') || (rawMsg.includes('duplicate key') && rawMsg.includes('order_items'))) {
      msg = 'ลำดับรหัสสินค้าในฐานข้อมูล (order_items sequence) ไม่ตรงกับข้อมูลที่มีอยู่ กรุณารีเซ็ต sequence ใน Supabase SQL Editor';
    } else if (rawMsg.includes('orders_pkey') || (rawMsg.includes('duplicate key') && rawMsg.includes('orders'))) {
      msg = 'ลำดับรหัสออเดอร์ในฐานข้อมูล (orders sequence) ไม่ตรงกับข้อมูลที่มีอยู่ กรุณารีเซ็ต sequence ใน Supabase SQL Editor';
    } else if (rawMsg.includes('duplicate key')) {
      msg = 'ข้อมูลที่บันทึกซ้ำกับในระบบ กรุณาลองใหม่อีกครั้ง';
    } else if (rawMsg.includes('stock') || rawMsg.includes('สต็อก')) {
      msg = err.message || 'สต็อกสินค้าไม่เพียงพอ';
    }

    errEl.textContent = 'เกิดข้อผิดพลาด: ' + msg;
    errEl.classList.remove('hidden');
    btn.disabled = false;
    updateCheckoutPaymentUI();
  }
}

function scrollToCatalog() {
  document.getElementById('catalog-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showToast(msg) {
  let t = document.getElementById('toast-msg');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast-msg';
    t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-900 text-white text-xs font-semibold px-5 py-3 rounded-xl shadow-xl z-[100] transition-opacity duration-300';
    document.body.appendChild(t);
  }
  t.textContent  = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

// ── Boot ──────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupStorefrontSync();
  initSupabase();
  loadProducts();
  updateCartBadge();

  const phoneInput = document.getElementById('co-phone');
  phoneInput?.addEventListener('input', () => {
    phoneInput.value = normalizePhoneNumber(phoneInput.value);
  });
});
