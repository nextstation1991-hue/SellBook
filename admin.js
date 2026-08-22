// ==========================================
//  ร้านหนังสือรัตน์ – Admin Portal admin.js
//  เชื่อมต่อ Supabase โดยตรง (จัดการสินค้า CRUD)
// ==========================================

const SUPABASE_URL  = 'https://ueptjmsurtshpcldpxxp.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcHRqbXN1cnRzaHBjbGRweHhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NjQzNDIsImV4cCI6MjEwMjI0MDM0Mn0.lma8_ZDsRl35NHAFv7qWE7kF-wQeNGp_uYdHbfM1958';
let supabaseClient      = null;
let realtimeChannel     = null;
let adminProducts       = [];
let lastFilteredAdminProducts = [];
let adminCategories     = [];
let deletingBookId      = null;
let customLowStockThreshold = null;
let showAlertLevelOnly = false;
let showNearOutOnly = false;
let adminCurrentPage = 1;
let adminPageSize = 10;

// ── Helpers ──────────────────────────────────────────────────────

function safeText(val, fallback = '') {
  const text = typeof val === 'string' ? val : (val ?? fallback);
  return typeof text === 'string' ? decodeMojibake(text) : text;
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

function safeParseJson(val, fallback) {
  if (!val) return fallback;
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return fallback; }
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
  return safeText(cat.name ?? cat.slug ?? cat.label ?? cat.title).trim();
}

function getCategoryString(prod) {
  const cats = getProductCategories(prod);
  return cats.map(getCategoryName).filter(Boolean).join(', ') || 'ทั่วไป';
}

// ── Theme ────────────────────────────────────────────────────────

function getUsableStockQuantity(prod) {
  return Math.max(0, Number(prod?.usable_stock_quantity ?? prod?.stock_quantity ?? 0));
}

function getDamagedStockQuantity(prod) {
  return Math.max(0, Number(prod?.damaged_stock_quantity ?? 0));
}

function getTotalStockQuantity(prod) {
  return getUsableStockQuantity(prod) + getDamagedStockQuantity(prod);
}

function getLowStockThreshold(prod) {
  return Math.max(0, Number(prod?.low_stock_threshold ?? 0));
}

function getNearOutStockThreshold(prod) {
  const lowThreshold = getLowStockThreshold(prod);
  const savedValue = Number(prod?.near_out_stock_threshold ?? 0);
  if (savedValue > 0) return Math.max(lowThreshold + 1, savedValue);
  return Math.max(lowThreshold + 1, lowThreshold * 2);
}

function isLowStock(prod) {
  const threshold = getLowStockThreshold(prod);
  return threshold > 0 && getUsableStockQuantity(prod) <= threshold;
}

function syncStockSummaryInputs() {
  const totalEl = document.getElementById('input-stock-qty');
  const usableEl = document.getElementById('input-usable-stock-qty');
  const damagedEl = document.getElementById('input-damaged-stock-qty');
  if (!totalEl || !usableEl || !damagedEl) return;

  const usableQty = Math.max(0, parseInt(usableEl.value, 10) || 0);
  const damagedQty = Math.max(0, parseInt(damagedEl.value, 10) || 0);
  totalEl.value = String(usableQty + damagedQty);
}

function ensureLowStockUi() {
  const statsGrid = document.querySelector('main .grid');
  const lowStockCardMarkup = `
      <div class="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center text-xl shrink-0">
        <i class="fas fa-bell"></i>
      </div>
      <div>
        <p class="text-[11px] font-bold text-stone-400 uppercase tracking-wider">สต็อกต่ำ</p>
        <p id="stat-low-stock" class="text-2xl font-black text-amber-600 dark:text-amber-300 font-sans mt-0.5">0</p>
      </div>
    `;
  if (statsGrid && !document.getElementById('stat-low-stock')) {
    const lowStockCard = document.createElement('div');
    lowStockCard.className = 'panel p-4 flex items-center gap-4';
    lowStockCard.innerHTML = lowStockCardMarkup;
    statsGrid.insertBefore(lowStockCard, statsGrid.children[4] || null);
  }
  const existingLowStockCard = document.getElementById('stat-low-stock')?.closest('.panel');
  if (existingLowStockCard) existingLowStockCard.innerHTML = lowStockCardMarkup;
  if (statsGrid) statsGrid.className = 'grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4';

  const stockFilter = document.getElementById('admin-stock-filter');
  if (stockFilter && !stockFilter.querySelector('option[value="lowstock"]')) {
    const lowStockOption = document.createElement('option');
    lowStockOption.value = 'lowstock';
    lowStockOption.textContent = 'สต็อกต่ำกว่าที่กำหนด';
    stockFilter.insertBefore(lowStockOption, stockFilter.querySelector('option[value="outofstock"]') || null);
  }

  if (!document.getElementById('input-low-stock-threshold')) {
    const stockStatusWrapper = document.getElementById('input-stock-status')?.parentElement;
    if (stockStatusWrapper?.parentElement) {
      const lowStockWrapper = document.createElement('div');
      lowStockWrapper.innerHTML = `
        <label class="block mb-1.5" for="input-low-stock-threshold">แจ้งเตือนเมื่อใช้ได้ต่ำกว่า/เท่ากับ</label>
        <input type="number" id="input-low-stock-threshold" min="0" value="3" placeholder="0" class="inp">
      `;
      stockStatusWrapper.parentElement.insertBefore(lowStockWrapper, stockStatusWrapper);
    }
  }

  const controlsRow = document.querySelector('.panel.p-4.md\\:p-5 .flex.flex-col.md\\:flex-row');
  if (controlsRow && !document.getElementById('custom-low-stock-filter-wrap')) {
    const customFilterWrap = document.createElement('div');
    customFilterWrap.id = 'custom-low-stock-filter-wrap';
    customFilterWrap.className = 'flex items-center gap-2 w-full md:w-auto';
    customFilterWrap.innerHTML = `
      <input type="number" id="custom-low-stock-threshold" min="0" value="3" placeholder="เช่น 5" class="inp text-xs py-2.5 w-28">
      <button type="button" onclick="applyCustomLowStockFilter()" class="flex items-center justify-center gap-1.5 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-2.5 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition whitespace-nowrap">
        <i class="fas fa-bell text-[11px]"></i> ดูใกล้หมด
      </button>
      <button type="button" onclick="clearCustomLowStockFilter()" id="custom-low-stock-clear-btn" class="hidden flex items-center justify-center gap-1.5 border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2.5 text-xs font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition whitespace-nowrap">
        ล้าง
      </button>
    `;
    controlsRow.appendChild(customFilterWrap);
  }
}

function updateCustomLowStockUi() {
  const clearBtn = document.getElementById('custom-low-stock-clear-btn');
  const input = document.getElementById('custom-low-stock-threshold');
  if (input && customLowStockThreshold != null) {
    input.value = String(customLowStockThreshold);
  }
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', customLowStockThreshold == null);
  }
}

function applyCustomLowStockFilter() {
  const input = document.getElementById('custom-low-stock-threshold');
  const threshold = Math.max(0, parseInt(input?.value, 10) || 0);
  customLowStockThreshold = threshold;
  updateCustomLowStockUi();
  filterAdminProducts();
  showToast(`แสดงสินค้าที่สต็อกใช้ได้เหลือน้อยกว่าหรือเท่ากับ ${threshold}`);
}

function clearCustomLowStockFilter() {
  customLowStockThreshold = null;
  updateCustomLowStockUi();
  filterAdminProducts();
  showToast('ล้างตัวกรองสินค้าใกล้หมดแล้ว');
}

function ensureLowStockUi() {
  const statsGrid = document.querySelector('main .grid');
  const lowStockCardMarkup = `
      <div class="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center text-xl shrink-0">
        <i class="fas fa-bell"></i>
      </div>
      <div>
        <p class="text-[11px] font-bold text-stone-400 uppercase tracking-wider">สต็อกต่ำ</p>
        <p id="stat-low-stock" class="text-2xl font-black text-amber-600 dark:text-amber-300 font-sans mt-0.5">0</p>
      </div>
    `;
  if (statsGrid && !document.getElementById('stat-low-stock')) {
    const lowStockCard = document.createElement('div');
    lowStockCard.className = 'panel p-4 flex items-center gap-4';
    lowStockCard.innerHTML = lowStockCardMarkup;
    statsGrid.insertBefore(lowStockCard, statsGrid.children[4] || null);
  }
  const existingLowStockCard = document.getElementById('stat-low-stock')?.closest('.panel');
  if (existingLowStockCard) existingLowStockCard.innerHTML = lowStockCardMarkup;
  if (statsGrid) statsGrid.className = 'grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4';

  const stockFilter = document.getElementById('admin-stock-filter');
  if (stockFilter && !stockFilter.querySelector('option[value="lowstock"]')) {
    const lowStockOption = document.createElement('option');
    lowStockOption.value = 'lowstock';
    lowStockOption.textContent = 'สต็อกต่ำกว่าที่กำหนด';
    stockFilter.insertBefore(lowStockOption, stockFilter.querySelector('option[value="outofstock"]') || null);
  }

  if (!document.getElementById('input-low-stock-threshold')) {
    const stockStatusWrapper = document.getElementById('input-stock-status')?.parentElement;
    if (stockStatusWrapper?.parentElement) {
      const lowStockWrapper = document.createElement('div');
      lowStockWrapper.innerHTML = `
        <label class="block mb-1.5" for="input-low-stock-threshold">แจ้งเตือนเมื่อใช้ได้ต่ำกว่า/เท่ากับ</label>
        <input type="number" id="input-low-stock-threshold" min="0" value="3" placeholder="0" class="inp">
      `;
      stockStatusWrapper.parentElement.insertBefore(lowStockWrapper, stockStatusWrapper);
    }
  }

  const controlsRow = document.querySelector('.panel.p-4.md\\:p-5 .flex.flex-col.md\\:flex-row');
  if (controlsRow && !document.getElementById('custom-low-stock-filter-wrap')) {
    const customFilterWrap = document.createElement('div');
    customFilterWrap.id = 'custom-low-stock-filter-wrap';
    customFilterWrap.className = 'flex flex-wrap items-center gap-2 w-full md:w-auto md:ml-auto';
    customFilterWrap.innerHTML = `
      <div class="flex items-center gap-2 rounded-2xl border border-stone-200/80 dark:border-stone-700 bg-white/70 dark:bg-stone-900/70 px-3 py-2">
        <i class="fas fa-gauge-high text-[11px] text-stone-400"></i>
        <input type="number" id="custom-low-stock-threshold" min="0" value="3" placeholder="เช่น 5" class="bg-transparent outline-none text-xs font-bold w-20 text-stone-700 dark:text-stone-200">
        <span class="text-[11px] font-bold text-stone-400">ชิ้น</span>
      </div>
      <button type="button" onclick="applyCustomLowStockFilter()" id="custom-low-stock-apply-btn" class="flex items-center justify-center gap-1.5 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-2.5 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition whitespace-nowrap">
        <i class="fas fa-circle-dot text-[10px]"></i> แสดงสินค้าใกล้หมด
      </button>
      <label id="alert-level-toggle" class="flex items-center gap-2 rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50/75 dark:bg-rose-950/20 px-4 py-2.5 text-xs font-bold text-rose-700 dark:text-rose-300 cursor-pointer select-none whitespace-nowrap">
        <input type="checkbox" id="alert-level-checkbox" onchange="toggleAlertLevelFilter(this.checked)" class="accent-rose-500 w-4 h-4">
        <span><i class="fas fa-triangle-exclamation mr-1"></i>แสดงเฉพาะสินค้าต่ำกว่าระดับเตือน</span>
      </label>
      <label id="near-out-toggle" class="flex items-center gap-2 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/75 dark:bg-amber-950/20 px-4 py-2.5 text-xs font-bold text-amber-700 dark:text-amber-300 cursor-pointer select-none whitespace-nowrap">
        <input type="checkbox" id="near-out-checkbox" onchange="toggleNearOutFilter(this.checked)" class="accent-amber-500 w-4 h-4">
        <span><i class="fas fa-bell mr-1"></i>แสดงเฉพาะสินค้าใกล้หมด</span>
      </label>
      <button type="button" onclick="clearCustomLowStockFilter()" id="custom-low-stock-clear-btn" class="hidden flex items-center justify-center gap-1.5 border border-stone-200 dark:border-stone-700 rounded-2xl px-3.5 py-2.5 text-xs font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition whitespace-nowrap">
        <i class="fas fa-xmark text-[10px]"></i> ล้าง
      </button>
    `;
    controlsRow.appendChild(customFilterWrap);
  }
}

function updateCustomLowStockUi() {
  const clearBtn = document.getElementById('custom-low-stock-clear-btn');
  const input = document.getElementById('custom-low-stock-threshold');
  const alertCheckbox = document.getElementById('alert-level-checkbox');
  const nearOutCheckbox = document.getElementById('near-out-checkbox');
  const alertToggle = document.getElementById('alert-level-toggle');
  const nearOutToggle = document.getElementById('near-out-toggle');
  const applyBtn = document.getElementById('custom-low-stock-apply-btn');
  if (input && customLowStockThreshold != null) input.value = String(customLowStockThreshold);
  if (alertCheckbox) alertCheckbox.checked = showAlertLevelOnly;
  if (nearOutCheckbox) nearOutCheckbox.checked = showNearOutOnly;
  if (alertToggle) {
    alertToggle.className = `flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-bold cursor-pointer select-none whitespace-nowrap transition ${
      showAlertLevelOnly
        ? 'border-rose-300 dark:border-rose-700 bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
        : 'border-rose-200 dark:border-rose-900 bg-rose-50/75 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300'
    }`;
  }
  if (nearOutToggle) {
    nearOutToggle.className = `flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-bold cursor-pointer select-none whitespace-nowrap transition ${
      showNearOutOnly
        ? 'border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200'
        : 'border-amber-200 dark:border-amber-800 bg-amber-50/75 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300'
    }`;
  }
  if (applyBtn) {
    applyBtn.className = `flex items-center justify-center gap-1.5 rounded-2xl border px-4 py-2.5 text-xs font-bold transition whitespace-nowrap ${
      showNearOutOnly
        ? 'border-amber-300 dark:border-amber-700 bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200'
        : 'border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/50'
    }`;
  }
  if (clearBtn) clearBtn.classList.toggle('hidden', customLowStockThreshold == null && !showAlertLevelOnly);
}

function applyCustomLowStockFilter() {
  const input = document.getElementById('custom-low-stock-threshold');
  const threshold = Math.max(0, parseInt(input?.value, 10) || 0);
  customLowStockThreshold = threshold;
  showNearOutOnly = true;
  updateCustomLowStockUi();
  filterAdminProducts();
  showToast(`แสดงเฉพาะสินค้าที่เหลือไม่เกิน ${threshold} ชิ้น`);
}

function toggleAlertLevelFilter(checked) {
  showAlertLevelOnly = Boolean(checked);
  updateCustomLowStockUi();
  filterAdminProducts();
}

function toggleNearOutFilter(checked) {
  showNearOutOnly = Boolean(checked);
  if (showNearOutOnly && customLowStockThreshold == null) {
    const input = document.getElementById('custom-low-stock-threshold');
    customLowStockThreshold = Math.max(0, parseInt(input?.value, 10) || 0);
  }
  updateCustomLowStockUi();
  filterAdminProducts();
}

function clearCustomLowStockFilter() {
  customLowStockThreshold = null;
  showAlertLevelOnly = false;
  showNearOutOnly = false;
  updateCustomLowStockUi();
  filterAdminProducts();
  showToast('ล้างตัวกรองสินค้าใกล้หมดแล้ว');
}

function refreshAdminStaticCopy() {
  const totalStat = document.getElementById('stat-total');
  const inStockStat = document.getElementById('stat-instock');
  const usableStat = document.getElementById('stat-usable-stock');
  const damagedStat = document.getElementById('stat-damaged-stock');
  const lowStockStat = document.getElementById('stat-low-stock');
  const outStat = document.getElementById('stat-out');
  const categoriesStat = document.getElementById('stat-categories');

  if (totalStat?.previousElementSibling) totalStat.previousElementSibling.textContent = 'หนังสือทั้งหมด';
  if (inStockStat?.previousElementSibling) inStockStat.previousElementSibling.textContent = 'พร้อมส่ง (In Stock)';
  if (usableStat?.previousElementSibling) usableStat.previousElementSibling.textContent = 'สต็อกที่ใช้ได้';
  if (damagedStat?.previousElementSibling) damagedStat.previousElementSibling.textContent = 'สต็อกชำรุด';
  if (categoriesStat?.previousElementSibling) categoriesStat.previousElementSibling.textContent = 'หมวดหมู่ทั้งหมด';

  if (lowStockStat) {
    const lowStockCard = lowStockStat.closest('.panel');
    if (lowStockCard) {
      lowStockCard.classList.add('admin-stat-card');
      lowStockCard.innerHTML = `
        <div class="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center text-xl shrink-0">
          <i class="fas fa-bell"></i>
        </div>
        <div>
          <p class="text-[11px] font-bold text-stone-400 uppercase tracking-wider">สต็อกต่ำ</p>
          <p id="stat-low-stock" class="text-2xl font-black text-amber-600 dark:text-amber-300 font-sans mt-0.5">${lowStockStat.textContent || '0'}</p>
        </div>
      `;
    }
  }

  if (outStat) {
    const outCard = outStat.closest('.panel');
    if (outCard) {
      outCard.classList.add('admin-stat-card');
      outCard.innerHTML = `
        <div class="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 flex items-center justify-center text-xl shrink-0">
          <i class="fas fa-triangle-exclamation"></i>
        </div>
        <div>
          <p class="text-[11px] font-bold text-stone-400 uppercase tracking-wider">สินค้าหมด (Out)</p>
          <p id="stat-out" class="text-2xl font-black text-rose-600 dark:text-rose-400 font-sans mt-0.5">${outStat.textContent || '0'}</p>
        </div>
      `;
    }
  }

  const loadingText = document.querySelector('#admin-loading p');
  if (loadingText) loadingText.textContent = 'กำลังโหลดข้อมูลหนังสือ...';

  const emptyTitle = document.querySelector('#admin-empty p');
  if (emptyTitle) emptyTitle.textContent = 'ยังไม่พบรายการหนังสือ';

  const emptyButton = document.querySelector('#admin-empty button');
  if (emptyButton) emptyButton.innerHTML = '<i class="fas fa-plus mr-1"></i> เพิ่มหนังสือเล่มแรก';

  const searchInput = document.getElementById('admin-search');
  if (searchInput) {
    searchInput.placeholder = 'ค้นหาชื่อหนังสือ / SKU / หมวดหมู่...';
    searchInput.className = 'inp pl-10 text-sm py-3';
  }

  const categoryFilter = document.getElementById('admin-cat-filter');
  if (categoryFilter) {
    categoryFilter.className = 'inp text-sm py-3 cursor-pointer';
    if (categoryFilter.options[0]) categoryFilter.options[0].text = 'หมวดหมู่ทั้งหมด';
  }

  const stockFilter = document.getElementById('admin-stock-filter');
  if (stockFilter) {
    stockFilter.className = 'inp text-sm py-3 cursor-pointer';
    if (stockFilter.options[0]) stockFilter.options[0].text = 'สถานะสต็อกทั้งหมด';
    if (stockFilter.querySelector('option[value="instock"]')) stockFilter.querySelector('option[value="instock"]').textContent = 'พร้อมส่ง (In Stock)';
    if (stockFilter.querySelector('option[value="outofstock"]')) stockFilter.querySelector('option[value="outofstock"]').textContent = 'สินค้าหมด (Out of Stock)';
    if (stockFilter.querySelector('option[value="lowstock"]')) stockFilter.querySelector('option[value="lowstock"]').textContent = 'ต่ำกว่าระดับเตือน';
  }

  const toolbarButtons = document.querySelectorAll('button[onclick="openAddModal()"], button[onclick="loadAdminProducts()"]');
  toolbarButtons.forEach((button) => {
    if (button.getAttribute('onclick') === 'openAddModal()' && button.closest('.panel.p-4.md\\:p-5, .admin-toolbar')) {
      button.className = 'btn-primary px-4 py-3 text-sm font-bold shadow-md whitespace-nowrap';
      button.innerHTML = '<i class="fas fa-plus"></i> เพิ่มหนังสือใหม่';
    }
    if (button.getAttribute('onclick') === 'loadAdminProducts()') {
      button.className = 'flex items-center justify-center gap-1.5 border border-stone-200 dark:border-stone-700 rounded-2xl px-4 py-3 text-sm font-bold hover:bg-stone-100 dark:hover:bg-stone-800 transition whitespace-nowrap';
      button.innerHTML = '<i class="fas fa-rotate-right text-[10px]"></i> รีเฟรช';
    }
  });

  const exportBtn = document.querySelector('button[onclick="exportAdminProductsToExcel()"]');
  if (exportBtn) {
    exportBtn.className = 'flex items-center justify-center gap-1.5 border border-emerald-200 dark:border-emerald-800 rounded-2xl px-4 py-3 text-sm font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition whitespace-nowrap';
  }

  const tableHeaders = document.querySelectorAll('#admin-table-wrapper thead th');
  const headerLabels = ['รูป', 'ชื่อหนังสือ / SKU', 'หมวดหมู่', 'ราคา (บาท)', 'จำนวนสต็อก', 'สถานะ', 'จัดการ'];
  tableHeaders.forEach((th, index) => {
    if (headerLabels[index]) th.textContent = headerLabels[index];
  });

  const statsGrid = document.querySelector('main .grid');
  if (statsGrid) {
    statsGrid.className = 'grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4';
    Array.from(statsGrid.children).forEach((card) => card.classList.add('admin-stat-card'));
  }
}

function ensureLowStockUi() {
  refreshAdminStaticCopy();

  const stockFilter = document.getElementById('admin-stock-filter');
  if (stockFilter && !stockFilter.querySelector('option[value="lowstock"]')) {
    const lowStockOption = document.createElement('option');
    lowStockOption.value = 'lowstock';
    lowStockOption.textContent = 'ต่ำกว่าระดับเตือน';
    stockFilter.insertBefore(lowStockOption, stockFilter.querySelector('option[value="outofstock"]') || null);
  }

  if (!document.getElementById('input-low-stock-threshold')) {
    const stockStatusWrapper = document.getElementById('input-stock-status')?.parentElement;
    if (stockStatusWrapper?.parentElement) {
      const lowStockWrapper = document.createElement('div');
      lowStockWrapper.innerHTML = `
        <label class="block mb-1.5" for="input-low-stock-threshold">แจ้งเตือนเมื่อสต็อกใช้ได้เหลือน้อยกว่าหรือเท่ากับ</label>
        <input type="number" id="input-low-stock-threshold" min="0" value="3" placeholder="0" class="inp">
      `;
      stockStatusWrapper.parentElement.insertBefore(lowStockWrapper, stockStatusWrapper);
    }
  }

  if (!document.getElementById('input-near-out-stock-threshold')) {
    const stockStatusWrapper = document.getElementById('input-stock-status')?.parentElement;
    const lowStockWrapper = document.getElementById('input-low-stock-threshold')?.parentElement;
    if (stockStatusWrapper?.parentElement && lowStockWrapper) {
      const nearOutWrapper = document.createElement('div');
      nearOutWrapper.innerHTML = `
        <label class="block mb-1.5" for="input-near-out-stock-threshold">ช่วงสินค้าใกล้หมดสิ้นสุดที่</label>
        <input type="number" id="input-near-out-stock-threshold" min="1" value="6" placeholder="0" class="inp">
      `;
      stockStatusWrapper.parentElement.insertBefore(nearOutWrapper, stockStatusWrapper);
    }
  }

  const controlsPanel = document.querySelector('main .panel.p-4.md\\:p-5.space-y-4');
  const controlsRow = controlsPanel?.querySelector('.flex.flex-col.md\\:flex-row.gap-3.items-stretch.md\\:items-center.justify-between');
  if (controlsPanel && controlsRow && !controlsPanel.dataset.enhancedToolbar) {
    controlsPanel.dataset.enhancedToolbar = 'true';
    controlsPanel.classList.add('admin-toolbar');

    const searchWrap = document.getElementById('admin-search')?.parentElement;
    const addBtn = controlsRow.querySelector('button[onclick="openAddModal()"]');
    const exportBtn = controlsRow.querySelector('button[onclick="exportAdminProductsToExcel()"]');
    const refreshBtn = controlsRow.querySelector('button[onclick="loadAdminProducts()"]');
    const catFilter = document.getElementById('admin-cat-filter');
    const stockFilterEl = document.getElementById('admin-stock-filter');

    controlsRow.className = 'admin-toolbar-main flex flex-col xl:flex-row gap-3 xl:items-center';
    if (searchWrap) {
      searchWrap.className = 'relative admin-search-grow';
      const icon = searchWrap.querySelector('i');
      if (icon) icon.className = 'fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 text-xs';
    }

    const actions = document.createElement('div');
    actions.className = 'admin-toolbar-actions flex flex-wrap items-center gap-2';
    [addBtn, exportBtn, refreshBtn].filter(Boolean).forEach((button) => actions.appendChild(button));

    controlsRow.innerHTML = '';
    if (searchWrap) controlsRow.appendChild(searchWrap);
    controlsRow.appendChild(actions);

    const filterRow = document.createElement('div');
    filterRow.className = 'admin-toolbar-filters grid grid-cols-1 md:grid-cols-2 gap-3';
    if (catFilter) filterRow.appendChild(catFilter);
    if (stockFilterEl) filterRow.appendChild(stockFilterEl);

    controlsPanel.appendChild(filterRow);

    const smartSlot = document.createElement('div');
    smartSlot.id = 'admin-smart-filters-slot';
    controlsPanel.appendChild(smartSlot);
  }

  const smartFilterSlot = document.getElementById('admin-smart-filters-slot') || controlsPanel;
  if (smartFilterSlot && !document.getElementById('custom-low-stock-filter-wrap')) {
    const customFilterWrap = document.createElement('div');
    customFilterWrap.id = 'custom-low-stock-filter-wrap';
    customFilterWrap.className = 'admin-smart-filters';
    customFilterWrap.innerHTML = `
      <div class="admin-chip-row">
        <label id="alert-level-toggle" class="admin-filter-chip admin-filter-chip-danger">
          <input type="checkbox" id="alert-level-checkbox" onchange="toggleAlertLevelFilter(this.checked)" class="accent-rose-500 w-4 h-4">
          <span><i class="fas fa-triangle-exclamation mr-1"></i>เฉพาะต่ำกว่าระดับเตือน</span>
        </label>
        <button type="button" onclick="clearCustomLowStockFilter()" id="custom-low-stock-clear-btn" class="admin-filter-chip admin-filter-chip-muted hidden">
          <i class="fas fa-xmark text-[10px]"></i> ล้างตัวกรอง
        </button>
      </div>
    `;
    smartFilterSlot.appendChild(customFilterWrap);
  }
}

function updateCustomLowStockUi() {
  const clearBtn = document.getElementById('custom-low-stock-clear-btn');
  const input = document.getElementById('custom-low-stock-threshold');
  const alertCheckbox = document.getElementById('alert-level-checkbox');
  const nearOutCheckbox = document.getElementById('near-out-checkbox');
  const alertToggle = document.getElementById('alert-level-toggle');
  const nearOutToggle = document.getElementById('near-out-toggle');

  if (input && customLowStockThreshold != null) input.value = String(customLowStockThreshold);
  if (alertCheckbox) alertCheckbox.checked = showAlertLevelOnly;
  if (nearOutCheckbox) nearOutCheckbox.checked = showNearOutOnly;

  if (alertToggle) alertToggle.className = `admin-filter-chip ${showAlertLevelOnly ? 'admin-filter-chip-danger active' : 'admin-filter-chip-danger'}`;
  if (nearOutToggle) nearOutToggle.className = `admin-filter-chip ${showNearOutOnly ? 'admin-filter-chip-warning active' : 'admin-filter-chip-warning'}`;
  if (clearBtn) clearBtn.classList.toggle('hidden', customLowStockThreshold == null && !showAlertLevelOnly && !showNearOutOnly);
}

function applyCustomLowStockFilter() {
  const threshold = Math.max(0, customLowStockThreshold ?? 3);
  customLowStockThreshold = threshold;
  showNearOutOnly = true;
  updateCustomLowStockUi();
  filterAdminProducts();
  showToast(`แสดงเฉพาะสินค้าที่เหลือไม่เกิน ${threshold} ชิ้น`);
}

function toggleAlertLevelFilter(checked) {
  showAlertLevelOnly = Boolean(checked);
  updateCustomLowStockUi();
  filterAdminProducts();
}

function toggleNearOutFilter(checked) {
  showNearOutOnly = Boolean(checked);
  if (showNearOutOnly && customLowStockThreshold == null) {
    const input = document.getElementById('custom-low-stock-threshold');
    customLowStockThreshold = Math.max(0, parseInt(input?.value, 10) || 0);
  }
  updateCustomLowStockUi();
  filterAdminProducts();
}

function clearCustomLowStockFilter() {
  customLowStockThreshold = null;
  showAlertLevelOnly = false;
  showNearOutOnly = false;
  updateCustomLowStockUi();
  filterAdminProducts();
  showToast('ล้างตัวกรองสินค้าใกล้หมดแล้ว');
}

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
    console.log('Admin Supabase connected:', SUPABASE_URL);
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
    .channel('admin-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, payload => {
      console.log('Realtime change:', payload.eventType);
      loadAdminProducts(true);
    })
    .subscribe();
}

// ── Load Products & Render ────────────────────────────────────────

async function loadAdminProducts(isSilent = false) {
  const spinner = document.getElementById('admin-loading');
  const wrapper = document.getElementById('admin-table-wrapper');
  const empty   = document.getElementById('admin-empty');

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
    const { data, error } = await supabaseClient
      .from('products')
      .select('*')
      .order('id', { ascending: false });

    if (error) throw error;

    adminProducts = data || [];
    if (!isSilent) spinner?.classList.add('hidden');

    updateSummaryStats();
    populateCategoryFilter();
    filterAdminProducts();
  } catch (err) {
    console.error('Error loading products:', err);
    if (!isSilent) spinner?.classList.add('hidden');
    showToast('โหลดข้อมูลผิดพลาด: ' + err.message);
  }
}

function updateSummaryStats() {
  const total    = adminProducts.length;
  const instock  = adminProducts.filter(p => p.stock_status === 'instock').length;
  const out      = total - instock;
  const usableTotal = adminProducts.reduce((sum, p) => sum + getUsableStockQuantity(p), 0);
  const damagedTotal = adminProducts.reduce((sum, p) => sum + getDamagedStockQuantity(p), 0);
  const activeLowStockCount = showNearOutOnly && customLowStockThreshold != null
    ? adminProducts.filter(p => getUsableStockQuantity(p) > 0 && getUsableStockQuantity(p) <= customLowStockThreshold).length
    : showAlertLevelOnly
      ? adminProducts.filter(p => isLowStock(p) && getUsableStockQuantity(p) > 0).length
      : adminProducts.filter(p => isLowStock(p) && getUsableStockQuantity(p) > 0).length;

  const catSet   = new Set();
  adminProducts.forEach(p => {
    getProductCategories(p).forEach(c => {
      const name = getCategoryName(c);
      if (name) catSet.add(name);
    });
  });

  document.getElementById('stat-total').textContent      = total;
  document.getElementById('stat-instock').textContent    = instock;
  document.getElementById('stat-out').textContent        = out;
  document.getElementById('stat-categories').textContent = catSet.size;
  const usableStatEl = document.getElementById('stat-usable-stock');
  const damagedStatEl = document.getElementById('stat-damaged-stock');
  const lowStockStatEl = document.getElementById('stat-low-stock');
  if (usableStatEl) usableStatEl.textContent = usableTotal;
  if (damagedStatEl) damagedStatEl.textContent = damagedTotal;
  if (lowStockStatEl) lowStockStatEl.textContent = activeLowStockCount;
}

function populateCategoryFilter() {
  const select = document.getElementById('admin-cat-filter');
  if (!select) return;
  const currentVal = select.value;

  const catSet = new Set();
  adminProducts.forEach(p => {
    getProductCategories(p).forEach(c => {
      const name = getCategoryName(c);
      if (name) catSet.add(name);
    });
  });

  select.innerHTML = '<option value="all">หมวดหมู่ทั้งหมด</option>';
  Array.from(catSet).sort().forEach(cat => {
    select.innerHTML += `<option value="${cat}">${cat}</option>`;
  });
  select.value = currentVal;
}

// ── Filter & Render Table ─────────────────────────────────────────

function filterAdminProducts() {
  ensureAdminPaginationUi();
  const search  = document.getElementById('admin-search')?.value.toLowerCase().trim() || '';
  const cat     = document.getElementById('admin-cat-filter')?.value || 'all';
  const stock   = document.getElementById('admin-stock-filter')?.value || 'all';

  const filtered = adminProducts.filter(p => {
    const name = safeText(p.name).toLowerCase();
    const sku  = safeText(p.sku).toLowerCase();
    const cStr = getCategoryString(p).toLowerCase();

    if (search && !name.includes(search) && !sku.includes(search) && !cStr.includes(search)) return false;

    if (cat !== 'all') {
      const cats = getProductCategories(p).map(getCategoryName);
      if (!cats.includes(cat)) return false;
    }

    const matchesAlertLevel = isLowStock(p) && getUsableStockQuantity(p) > 0;
    const matchesNearOut = customLowStockThreshold != null
      && getUsableStockQuantity(p) > 0
      && getUsableStockQuantity(p) <= customLowStockThreshold;

    if (showAlertLevelOnly || showNearOutOnly) {
      const toggleMatch = (showAlertLevelOnly && matchesAlertLevel) || (showNearOutOnly && matchesNearOut);
      if (!toggleMatch) return false;
    } else if (stock === 'lowstock') {
      if (!matchesAlertLevel) return false;
    } else if (stock !== 'all' && p.stock_status !== stock) {
      return false;
    }

    return true;
  });

  lastFilteredAdminProducts = filtered;
  renderTableRows(filtered);
}

function exportAdminProductsToExcel() {
  const exportRows = (lastFilteredAdminProducts.length ? lastFilteredAdminProducts : adminProducts).map((prod, index) => ({
    'ลำดับ': index + 1,
    'รหัสสินค้า (SKU)': safeText(prod.sku, '-'),
    'ชื่อหนังสือ': safeText(prod.name, 'ไม่มีชื่อ'),
    'หมวดหมู่': getCategoryString(prod),
    'ราคาขาย (บาท)': Number(prod.price ?? 0),
    'ราคาเต็ม (บาท)': Number(prod.regular_price ?? 0),
    'สต็อกที่ใช้ได้': getUsableStockQuantity(prod),
    'สต็อกชำรุด': getDamagedStockQuantity(prod),
    'สต็อกรวม': getTotalStockQuantity(prod),
    'จำนวนแจ้งเตือนขั้นต่ำ': getLowStockThreshold(prod),
    'แจ้งเตือนสต็อกต่ำ': isLowStock(prod) && getUsableStockQuantity(prod) > 0 ? 'ใช่' : 'ไม่ใช่',
    'สถานะสต็อก': prod.stock_status === 'instock' ? 'พร้อมส่ง' : 'หมดชั่วคราว',
    'คำโปรยสั้น': safeText(prod.short_description ?? '', ''),
    'รายละเอียด': safeText(prod.description ?? '', ''),
    'อัปเดตล่าสุด': prod.updated_at || prod.created_at || '',
  }));

  if (!exportRows.length) {
    showToast('ไม่มีข้อมูลสินค้าให้ส่งออก');
    return;
  }

  if (!window.XLSX) {
    showToast('ไม่พบเครื่องมือสำหรับสร้างไฟล์ Excel');
    return;
  }

  const worksheet = window.XLSX.utils.json_to_sheet(exportRows);
  const workbook = window.XLSX.utils.book_new();
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  worksheet['!cols'] = [
    { wch: 8 },
    { wch: 18 },
    { wch: 32 },
    { wch: 30 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
    { wch: 28 },
    { wch: 42 },
    { wch: 24 },
  ];

  window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');
  window.XLSX.writeFile(workbook, `admin-products-${stamp}.xlsx`);
  showToast(`ส่งออกสินค้า ${exportRows.length} รายการเป็นไฟล์ Excel แล้ว`);
}

function renderTableRows(list) {
  const wrapper = document.getElementById('admin-table-wrapper');
  const empty   = document.getElementById('admin-empty');
  const tbody   = document.getElementById('admin-product-rows');

  if (list.length === 0) {
    wrapper?.classList.add('hidden');
    empty?.classList.remove('hidden');
    document.getElementById('admin-pagination-bar')?.classList.add('hidden');
    return;
  }

  empty?.classList.add('hidden');
  wrapper?.classList.remove('hidden');

  tbody.innerHTML = list.map(prod => {
    const imgs       = getProductImages(prod);
    const cover      = imgs[0]?.src || 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=200&q=80';
    const name       = safeText(prod.name, 'ไม่ระบุชื่อ');
    const sku        = safeText(prod.sku, 'N/A');
    const catStr     = getCategoryString(prod);
    const price      = prod.price != null && prod.price !== '' ? parseFloat(prod.price).toLocaleString() : '0';
    const usableQty  = getUsableStockQuantity(prod);
    const damagedQty = getDamagedStockQuantity(prod);
    const instock    = prod.stock_status !== 'outofstock' && usableQty > 0;

    const statusBadge = instock
      ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
           <i class="fas fa-circle text-[6px]"></i> พร้อมส่ง
         </span>`
      : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
           <i class="fas fa-circle text-[6px]"></i> หมดชั่วคราว
         </span>`;

    return `
      <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
        <td class="py-3 px-4 text-center">
          <div class="w-10 h-13 aspect-[3/4] rounded-lg overflow-hidden border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 mx-auto">
            <img src="${cover}" alt="${name}" class="w-full h-full object-cover" onerror="this.src='https://images.unsplash.com/photo-1512820790803-83ca734da794?w=200&q=80'">
          </div>
        </td>

        <td class="py-3 px-4">
          <p class="font-bold text-stone-900 dark:text-stone-100 line-clamp-1 hover:text-primary transition">${name}</p>
          <p class="text-[10px] font-mono text-stone-400 mt-0.5">SKU: <span class="text-stone-600 dark:text-stone-300 font-bold">${sku}</span></p>
          <div class="sm:hidden mt-2 flex items-center gap-2">
            <button onclick="openEditModal(${prod.id})" class="px-2.5 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center gap-1 text-[10px] font-bold transition" title="แก้ไข">
              <i class="fas fa-pen-to-square text-[10px]"></i> แก้ไข
            </button>
            <button onclick="openDeleteModal(${prod.id})" class="px-2.5 py-1.5 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 flex items-center gap-1 text-[10px] font-bold transition" title="ลบ">
              <i class="fas fa-trash text-[10px]"></i> ลบ
            </button>
          </div>
        </td>

        <td class="py-3 px-4 text-stone-600 dark:text-stone-300 font-medium">
          <span class="inline-block px-2 py-0.5 rounded-md bg-stone-100 dark:bg-stone-800 text-[11px]">${catStr}</span>
        </td>

        <td class="py-3 px-4 text-right font-black text-primary dark:text-amber-300 font-sans text-sm">
          ฿${price}
        </td>

        <td class="py-3 px-4 text-center">
          <div class="inline-flex items-center border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden bg-white dark:bg-stone-900">
            <button onclick="quickAdjustStock(${prod.id}, -1)" class="w-6 h-6 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="ลดสต็อกใช้ได้">-</button>
            <span class="w-8 text-center text-xs font-bold text-stone-800 dark:text-white font-sans">${usableQty}</span>
            <button onclick="quickAdjustStock(${prod.id}, 1)" class="w-6 h-6 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="เพิ่มสต็อกใช้ได้">+</button>
          </div>
          <div class="mt-1.5 space-y-1 text-[10px] font-bold">
            <div class="text-emerald-600 dark:text-emerald-400">ใช้ได้ ${usableQty}</div>
            <div class="text-rose-500 dark:text-rose-400">ชำรุด ${damagedQty}</div>
          </div>
        </td>

        <td class="py-3 px-4 text-center">
          ${statusBadge}
        </td>

        <td class="hidden sm:table-cell py-3 px-4 text-center sticky-action-col">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openEditModal(${prod.id})" class="w-7 h-7 rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-amber-100 dark:hover:bg-amber-950 text-stone-600 dark:text-stone-300 hover:text-amber-700 dark:hover:text-amber-300 flex items-center justify-center transition" title="แก้ไข">
              <i class="fas fa-pen-to-square text-xs"></i>
            </button>
            <button onclick="openDeleteModal(${prod.id})" class="w-7 h-7 rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-rose-100 dark:hover:bg-rose-950 text-stone-600 dark:text-stone-300 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition" title="ลบ">
              <i class="fas fa-trash text-xs"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function quickAdjustStock(productId, delta) {
  const prod = adminProducts.find(p => String(p.id) === String(productId));
  if (!supabaseClient) {
    showToast('ยังไม่ได้เชื่อมต่อ Supabase');
    return;
  }
  if (!prod) {
    showToast('ไม่พบข้อมูลสินค้าที่ต้องการอัปเดต');
    return;
  }

  const currentQty = getUsableStockQuantity(prod);
  if (delta < 0 && currentQty <= 0) {
    showToast('สต็อกใช้ได้เป็น 0 อยู่แล้ว จึงลดต่อไม่ได้');
    return;
  }
  const newQty     = Math.max(0, currentQty + delta);
  const newStatus  = newQty > 0 ? 'instock' : 'outofstock';

  // Optimistic UI update
  prod.stock_quantity = newQty;
  prod.usable_stock_quantity = newQty;
  prod.stock_status   = newStatus;
  updateSummaryStats();
  filterAdminProducts();

  try {
    const { error } = await supabaseClient
      .from('products')
      .update({ stock_quantity: newQty, usable_stock_quantity: newQty, stock_status: newStatus })
      .eq('id', productId);

    if (error) throw error;
    showToast(`อัปเดตสต็อก "${prod.name}" เป็น ${newQty} เล่มแล้ว`);
  } catch (err) {
    console.error('Quick stock update failed:', err);
    showToast('อัปเดตสต็อกไม่สำเร็จ: ' + err.message);
    loadAdminProducts(true);
  }
}

// ── Add / Edit Book Modal ──────────────────────────────────────────

let formImages = [];

function renderFormImages() {
  const container = document.getElementById('image-preview-grid');
  const countText = document.getElementById('image-count-text');
  if (!container) return;

  if (countText) countText.textContent = formImages.length;

  if (formImages.length === 0) {
    container.innerHTML = `
      <div class="py-4 w-full text-center text-stone-400">
        <i class="fas fa-image text-2xl mb-1 block opacity-30"></i>
        <p class="text-[11px] font-medium">ยังไม่มีรูปภาพ ให้ใส่วาง URL ด้านล่าง หรือกดปุ่มอัปโหลดรูปภาพ</p>
      </div>
    `;
    return;
  }

  const FALLBACK = 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=200&q=80';

  container.innerHTML = formImages.map((img, i) => `
    <div class="relative group w-20 h-20 rounded-xl overflow-hidden border ${i === 0 ? 'border-2 border-primary shadow-md' : 'border-stone-200 dark:border-stone-700'} bg-stone-50 dark:bg-stone-850 shrink-0">
      <img src="${img.src || FALLBACK}" class="w-full h-full object-cover" onerror="this.src='${FALLBACK}'">
      
      <!-- Primary Cover Badge -->
      ${i === 0 ? `<span class="absolute top-1 left-1 bg-primary text-white text-[8px] font-bold px-1.5 py-0.5 rounded-md shadow">ปกหลัก</span>` : ''}

      <!-- Overlay actions -->
      <div class="absolute inset-0 bg-stone-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 p-1">
        ${i !== 0 ? `
          <button type="button" onclick="setCoverImage(${i})" class="w-6 h-6 rounded-lg bg-white/90 text-amber-700 hover:bg-white flex items-center justify-center text-[10px] shadow" title="ตั้งเป็นรูปปกหลัก">
            <i class="fas fa-star"></i>
          </button>
        ` : ''}
        <button type="button" onclick="removeFormImage(${i})" class="w-6 h-6 rounded-lg bg-rose-600/90 text-white hover:bg-rose-600 flex items-center justify-center text-[10px] shadow" title="ลบรูปนี้">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function addImageFromUrl() {
  const input = document.getElementById('input-add-image-url');
  const url = input?.value.trim();
  if (!url) return;

  formImages.push({ src: url, alt: '' });
  if (input) input.value = '';
  renderFormImages();
  showToast('เพิ่ม URL รูปภาพสำเร็จ');
}

async function removeFormImage(index) {
  const removedImg = formImages[index];
  formImages.splice(index, 1);
  renderFormImages();

  if (removedImg?.src && removedImg.src.includes('/product-images/')) {
    try {
      const parts = removedImg.src.split('/product-images/');
      if (parts[1]) {
        const filePath = decodeURIComponent(parts[1].split('?')[0]);
        await supabaseClient?.storage?.from('product-images')?.remove([filePath]);
      }
    } catch (e) {
      console.error('Storage delete error:', e);
    }
  }
}

function setCoverImage(index) {
  if (index <= 0 || index >= formImages.length) return;
  const target = formImages.splice(index, 1)[0];
  formImages.unshift(target);
  renderFormImages();
  showToast('ตั้งเป็นรูปปกหลักเรียบร้อย');
}

async function uploadFileToSupabaseStorage(file) {
  if (!supabaseClient) throw new Error('ยังไม่ได้เชื่อมต่อ Supabase');

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${ext}`;
  const filePath = `books/${filename}`;

  const { data, error } = await supabaseClient.storage
    .from('product-images')
    .upload(filePath, file, { 
      cacheControl: '3600', 
      upsert: true,
      contentType: file.type || 'image/jpeg'
    });

  if (error) {
    console.error('Supabase Storage upload error:', error);
    throw new Error(`อัปโหลดเข้า Storage ไม่สำเร็จ: ${error.message || 'โปรดตรวจสอบสิทธิ์ Bucket product-images'}`);
  }

  const { data: pubUrlData } = supabaseClient.storage
    .from('product-images')
    .getPublicUrl(filePath);

  if (!pubUrlData?.publicUrl) {
    throw new Error('ไม่สามารถดึง Public URL ของไฟล์จาก Storage ได้');
  }

  return pubUrlData.publicUrl;
}

async function handleImageFileUpload(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  showToast('กำลังอัปโหลดรูปภาพเข้า Supabase Storage...');

  let successCount = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const url = await uploadFileToSupabaseStorage(file);
      if (url) {
        formImages.push({ src: url, alt: file.name });
        successCount++;
      }
    } catch (e) {
      console.error('File upload error:', e);
      showToast(`อัปโหลดไม่สำเร็จ: ${e.message}`);
    }
  }

  renderFormImages();
  if (successCount > 0) {
    showToast(`อัปโหลดไฟล์เข้า Supabase Storage เรียบร้อย ${successCount} รูป`);
  }
  event.target.value = '';
}

function openAddModal() {
  document.getElementById('form-title').textContent    = 'เพิ่มหนังสือใหม่';
  document.getElementById('form-subtitle').textContent = 'กรอกข้อมูลหนังสือเพื่อบันทึกลงใน Supabase';
  document.getElementById('form-icon').className       = 'fas fa-plus';
  document.getElementById('form-book-id').value        = '';

  document.getElementById('book-form').reset();
  document.getElementById('input-stock-qty').value     = '10';
  document.getElementById('input-usable-stock-qty').value = '10';
  document.getElementById('input-damaged-stock-qty').value = '0';
  document.getElementById('input-low-stock-threshold').value = '3';
  document.getElementById('input-near-out-stock-threshold').value = '6';
  document.getElementById('input-stock-status').value  = 'instock';
  document.getElementById('input-manage-stock').checked = true;
  document.getElementById('form-error').classList.add('hidden');

  formImages = [];
  renderFormImages();
  syncStockSummaryInputs();

  document.getElementById('book-form-modal').classList.remove('hidden');
}

function openEditModal(productId) {
  const prod = adminProducts.find(p => p.id === productId);
  if (!prod) return;

  document.getElementById('form-title').textContent    = 'แก้ไขข้อมูลหนังสือ';
  document.getElementById('form-subtitle').textContent = `แก้ไขข้อมูลหนังสือ SKU: ${prod.sku || 'N/A'}`;
  document.getElementById('form-icon').className       = 'fas fa-pen-to-square';
  document.getElementById('form-book-id').value        = prod.id;

  document.getElementById('input-name').value          = safeText(prod.name);
  document.getElementById('input-sku').value           = safeText(prod.sku);
  document.getElementById('input-category').value      = getCategoryString(prod);
  document.getElementById('input-price').value         = prod.price ?? '';
  document.getElementById('input-regular-price').value = prod.regular_price ?? '';
  document.getElementById('input-stock-qty').value     = getTotalStockQuantity(prod);
  document.getElementById('input-usable-stock-qty').value = getUsableStockQuantity(prod);
  document.getElementById('input-damaged-stock-qty').value = getDamagedStockQuantity(prod);
  document.getElementById('input-low-stock-threshold').value = getLowStockThreshold(prod);
  document.getElementById('input-near-out-stock-threshold').value = getNearOutStockThreshold(prod);
  document.getElementById('input-stock-status').value  = prod.stock_status || 'instock';
  document.getElementById('input-manage-stock').checked = prod.manage_stock ?? true;
  document.getElementById('input-short-desc').value    = safeText(prod.short_description);
  document.getElementById('input-desc').value          = safeText(prod.description);
  document.getElementById('input-len').value           = safeText(prod.length);
  document.getElementById('input-width').value         = safeText(prod.width);
  document.getElementById('input-height').value        = safeText(prod.height);

  const imgs = getProductImages(prod);
  formImages = imgs.map(i => ({ src: i.src, alt: i.alt || '' }));
  renderFormImages();
  syncStockSummaryInputs();

  document.getElementById('form-error').classList.add('hidden');
  document.getElementById('book-form-modal').classList.remove('hidden');
}

function closeBookFormModal() {
  document.getElementById('book-form-modal')?.classList.add('hidden');
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById('form-error');
  const btn   = document.getElementById('form-submit-btn');

  const bookId    = document.getElementById('form-book-id').value;
  const name      = document.getElementById('input-name').value.trim();
  const sku       = document.getElementById('input-sku').value.trim();
  const catInput  = document.getElementById('input-category').value.trim();
  const price     = parseFloat(document.getElementById('input-price').value) || 0;
  const regPrice  = parseFloat(document.getElementById('input-regular-price').value) || price;
  const stockQty  = parseInt(document.getElementById('input-stock-qty').value, 10) || 0;
  const usableStockQty = parseInt(document.getElementById('input-usable-stock-qty').value, 10) || 0;
  const damagedStockQty = parseInt(document.getElementById('input-damaged-stock-qty').value, 10) || 0;
  const lowStockThreshold = parseInt(document.getElementById('input-low-stock-threshold').value, 10) || 0;
  const nearOutStockThreshold = Math.max(lowStockThreshold + 1, parseInt(document.getElementById('input-near-out-stock-threshold').value, 10) || 0);
  const stockStat = document.getElementById('input-stock-status').value;
  const mgStock   = document.getElementById('input-manage-stock').checked;
  const shortDesc = document.getElementById('input-short-desc').value.trim();
  const desc      = document.getElementById('input-desc').value.trim();
  const lenVal    = document.getElementById('input-len').value.trim();
  const widthVal  = document.getElementById('input-width').value.trim();
  const heightVal = document.getElementById('input-height').value.trim();

  const imagesJson = formImages.map((img, i) => ({
    src: img.src,
    alt: img.alt || `${name} รูปที่ ${i + 1}`
  }));

  const categoriesJson = catInput
    ? catInput.split(',').map(c => ({ name: c.trim(), slug: c.trim().toLowerCase().replace(/\s+/g, '-') }))
    : [{ name: 'ทั่วไป', slug: 'general' }];

  if (!name || !sku) {
    errEl.textContent = 'กรุณากรอกชื่อหนังสือและ SKU';
    errEl.classList.remove('hidden'); return;
  }

  // ตรวจสอบรหัส SKU ซ้ำกับหนังสือเล่มอื่นในระบบล่วงหน้า
  const dupBook = adminProducts.find(p =>
    safeText(p.sku).trim().toLowerCase() === sku.toLowerCase() &&
    String(p.id) !== String(bookId)
  );
  if (dupBook) {
    errEl.textContent = `⚠️ รหัสสินค้า (SKU: "${sku}") ซ้ำกับหนังสือเรื่อง "${safeText(dupBook.name)}" ที่มีในระบบแล้ว กรุณาใช้ SKU อื่น`;
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> กำลังบันทึก...';
  errEl.classList.add('hidden');

  const payload = {
    name, sku,
    categories: categoriesJson,
    price, regular_price: regPrice,
    stock_quantity: usableStockQty,
    usable_stock_quantity: usableStockQty,
    damaged_stock_quantity: damagedStockQty,
    low_stock_threshold: lowStockThreshold,
    near_out_stock_threshold: nearOutStockThreshold,
    stock_status: usableStockQty <= 0 ? 'outofstock' : stockStat,
    manage_stock: mgStock,
    short_description: shortDesc || null,
    description: desc || null,
    images: imagesJson,
    length: lenVal || null,
    width: widthVal || null,
    height: heightVal || null
  };

  try {
    let resultErr = null;
    if (bookId) {
      // Update
      const { error } = await supabaseClient
        .from('products')
        .update(payload)
        .eq('id', bookId);
      resultErr = error;
    } else {
      // Insert
      const { error } = await supabaseClient
        .from('products')
        .insert(payload);
      resultErr = error;
    }

    if (resultErr) throw resultErr;

    closeBookFormModal();
    showToast(bookId ? `แก้ไขหนังสือ "${name}" สำเร็จ!` : `เพิ่มหนังสือ "${name}" เรียบร้อย!`);
    loadAdminProducts();

  } catch (err) {
    console.error('Form submit error:', err);
    let msg = err.message || 'ไม่สามารถบันทึกข้อมูลได้';
    const rawMsg = String(msg).toLowerCase();

    if (rawMsg.includes('products_sku_key') || (rawMsg.includes('duplicate key') && rawMsg.includes('sku'))) {
      msg = `รหัสสินค้า (SKU: "${sku}") ซ้ำกับหนังสือที่มีอยู่แล้วในระบบ กรุณาใช้รหัส SKU อื่น`;
    } else if (rawMsg.includes('products_pkey') || (rawMsg.includes('duplicate key') && rawMsg.includes('pkey'))) {
      msg = 'รหัสอ้างอิงสินค้า (ID) ซ้ำกับรายการในระบบ กรุณาลองใหม่อีกครั้ง';
    } else if (rawMsg.includes('duplicate key')) {
      msg = 'ข้อมูลบางรายการ (เช่น รหัส SKU) ซ้ำกับที่มีอยู่แล้วในระบบ';
    }

    errEl.textContent = '⚠️ เกิดข้อผิดพลาด: ' + msg;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save mr-1"></i> บันทึกข้อมูล';
  }
}

// ── Delete Modal ──────────────────────────────────────────────────

function openDeleteModal(productId) {
  const prod = adminProducts.find(p => p.id === productId);
  if (!prod) return;

  deletingBookId = productId;
  document.getElementById('delete-book-name').textContent = `${prod.name} (${prod.sku || 'N/A'})`;
  document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
  deletingBookId = null;
  document.getElementById('delete-modal')?.classList.add('hidden');
}

function openImageLightbox(src, name = '') {
  const modal = document.getElementById('image-lightbox-modal');
  const preview = document.getElementById('image-lightbox-preview');
  if (!modal || !preview || !src) return;

  preview.src = src;
  preview.alt = name ? `รูปปกหนังสือ ${name}` : 'รูปปกหนังสือ';
  modal.classList.remove('hidden');
}

function closeImageLightbox() {
  const modal = document.getElementById('image-lightbox-modal');
  const preview = document.getElementById('image-lightbox-preview');
  if (preview) {
    preview.src = '';
    preview.alt = 'รูปปกหนังสือ';
  }
  modal?.classList.add('hidden');
}

async function confirmDeleteBook() {
  if (!deletingBookId || !supabaseClient) return;

  const btn = document.getElementById('delete-confirm-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> กำลังลบ...';

  try {
    const prod = adminProducts.find(p => p.id === deletingBookId);
    const imgs = prod ? getProductImages(prod) : [];

    const { error } = await supabaseClient
      .from('products')
      .delete()
      .eq('id', deletingBookId);

    if (error) throw error;

    // ลบรูปออกจาก Storage API อย่างปลอดภัย
    if (imgs.length > 0) {
      const filePaths = imgs.map(img => {
        if (img.src && img.src.includes('/product-images/')) {
          const parts = img.src.split('/product-images/');
          return parts[1] ? decodeURIComponent(parts[1].split('?')[0]) : null;
        }
        return null;
      }).filter(Boolean);

      if (filePaths.length > 0) {
        supabaseClient.storage.from('product-images').remove(filePaths).catch(e => console.error('Storage remove error:', e));
      }
    }

    closeDeleteModal();
    showToast('ลบหนังสือออกจากระบบเรียบร้อยแล้ว');
    loadAdminProducts();
  } catch (err) {
    console.error('Delete error:', err);
    showToast('ลบหนังสือไม่สำเร็จ: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'ยืนยันการลบ';
  }
}

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

// ── Admin Authentication ───────────────────────────────────────────

async function setupAdminAuth() {
  const authScreen = document.getElementById('admin-auth-screen');
  const appShell = document.getElementById('admin-app-shell');
  const authError = document.getElementById('admin-auth-error');
  const loginForm = document.getElementById('admin-login-form');
  const logoutBtn = document.getElementById('admin-logout-btn');

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
      const email = document.getElementById('admin-email')?.value.trim();
      const password = document.getElementById('admin-password')?.value;

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
            throw new Error('บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานหลังร้าน');
          }

          showApp();
          loadAdminProducts();
        }
      } catch (err) {
        console.error('Admin login failed:', err);
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
        console.error('Admin logout failed:', err);
      }
    });
  }

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      if (!isAllowedAdminSession(session)) {
        await supabaseClient.auth.signOut();
        showAuthScreen('บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานหลังร้าน');
        return;
      }

      showApp();
      loadAdminProducts();
    } else {
      showAuthScreen();
    }
  } catch (err) {
    console.error('Auth check failed:', err);
    showAuthScreen('ไม่สามารถตรวจสอบสิทธิ์แอดมินได้');
  }
}

// ── Boot ──────────────────────────────────────────────────────────

async function quickAdjustDamagedStock(productId, delta) {
  const prod = adminProducts.find(p => String(p.id) === String(productId));
  if (!supabaseClient) {
    showToast('ยังไม่ได้เชื่อมต่อ Supabase');
    return;
  }
  if (!prod) {
    showToast('ไม่พบข้อมูลสินค้าที่ต้องการอัปเดต');
    return;
  }

  const currentDamagedQty = getDamagedStockQuantity(prod);
  if (delta < 0 && currentDamagedQty <= 0) {
    showToast('สต็อกชำรุดเป็น 0 อยู่แล้ว จึงลดต่อไม่ได้');
    return;
  }

  const newDamagedQty = Math.max(0, currentDamagedQty + delta);
  prod.damaged_stock_quantity = newDamagedQty;
  updateSummaryStats();
  filterAdminProducts();

  try {
    const { error } = await supabaseClient
      .from('products')
      .update({ damaged_stock_quantity: newDamagedQty })
      .eq('id', productId);

    if (error) throw error;
    showToast(`อัปเดตสต็อกชำรุด "${safeText(prod.name, 'หนังสือ')}" เป็น ${newDamagedQty} เล่มแล้ว`);
  } catch (err) {
    console.error('Quick damaged stock update failed:', err);
    showToast('อัปเดตสต็อกชำรุดไม่สำเร็จ: ' + err.message);
    loadAdminProducts(true);
  }
}

async function setLowStockThresholdValue(productId, rawValue, linkedNearOutValue = null) {
  const prod = adminProducts.find(p => String(p.id) === String(productId));
  if (!supabaseClient) {
    showToast('ยังไม่ได้เชื่อมต่อ Supabase');
    return;
  }
  if (!prod) {
    showToast('ไม่พบข้อมูลสินค้าที่ต้องการอัปเดต');
    return;
  }

  const currentNearOut = getNearOutStockThreshold(prod);
  const newLow = Math.max(0, parseInt(rawValue, 10) || 0);
  const newNearOut = Math.max(newLow + 1, linkedNearOutValue != null ? linkedNearOutValue : currentNearOut);

  prod.low_stock_threshold = newLow;
  prod.near_out_stock_threshold = newNearOut;
  filterAdminProducts();

  try {
    const { error } = await supabaseClient
      .from('products')
      .update({ low_stock_threshold: newLow, near_out_stock_threshold: newNearOut })
      .eq('id', productId);

    if (error) throw error;
    showToast(`อัปเดตจุดแจ้งเตือนเป็น ${newLow} ชิ้นแล้ว`);
  } catch (err) {
    console.error('Quick low stock threshold update failed:', err);
    showToast('อัปเดตจุดแจ้งเตือนไม่สำเร็จ: ' + err.message);
    loadAdminProducts(true);
  }
}

async function quickAdjustLowStockThreshold(productId, delta) {
  const prod = adminProducts.find(p => String(p.id) === String(productId));
  if (!prod) {
    showToast('à¹„à¸¡à¹ˆà¸žà¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ªà¸´à¸™à¸„à¹‰à¸²à¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸à¸²à¸£à¸­à¸±à¸›à¹€à¸”à¸•');
    return;
  }

  const currentLow = getLowStockThreshold(prod);
  const currentNearOut = getNearOutStockThreshold(prod);
  const newLow = Math.max(0, currentLow + delta);
  const newNearOut = Math.max(newLow + 1, currentNearOut);

  await setLowStockThresholdValue(productId, newLow, newNearOut);
}

async function setNearOutThresholdValue(productId, rawValue) {
  const prod = adminProducts.find(p => String(p.id) === String(productId));
  if (!supabaseClient) {
    showToast('à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­ Supabase');
    return;
  }
  if (!prod) {
    showToast('à¹„à¸¡à¹ˆà¸žà¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ªà¸´à¸™à¸„à¹‰à¸²à¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸à¸²à¸£à¸­à¸±à¸›à¹€à¸”à¸•');
    return;
  }

  const currentLow = getLowStockThreshold(prod);
  const newNearOut = Math.max(currentLow + 1, parseInt(rawValue, 10) || 0);

  prod.near_out_stock_threshold = newNearOut;
  filterAdminProducts();

  try {
    const { error } = await supabaseClient
      .from('products')
      .update({ near_out_stock_threshold: newNearOut })
      .eq('id', productId);

    if (error) throw error;
    showToast(`à¸­à¸±à¸›à¹€à¸”à¸•à¸Šà¹ˆà¸§à¸‡à¸ªà¸´à¸™à¸„à¹‰à¸²à¹ƒà¸à¸¥à¹‰à¸«à¸¡à¸”à¹€à¸›à¹‡à¸™ ${newNearOut} à¸Šà¸´à¹‰à¸™à¹à¸¥à¹‰à¸§`);
  } catch (err) {
    console.error('Quick near-out threshold update failed:', err);
    showToast('à¸­à¸±à¸›à¹€à¸”à¸•à¸Šà¹ˆà¸§à¸‡à¸ªà¸´à¸™à¸„à¹‰à¸²à¹ƒà¸à¸¥à¹‰à¸«à¸¡à¸”à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ: ' + err.message);
    loadAdminProducts(true);
  }
}

async function quickAdjustNearOutThreshold(productId, delta) {
  const prod = adminProducts.find(p => String(p.id) === String(productId));
  if (!supabaseClient) {
    showToast('ยังไม่ได้เชื่อมต่อ Supabase');
    return;
  }
  if (!prod) {
    showToast('ไม่พบข้อมูลสินค้าที่ต้องการอัปเดต');
    return;
  }

  const currentLow = getLowStockThreshold(prod);
  const currentNearOut = getNearOutStockThreshold(prod);
  const newNearOut = Math.max(currentLow + 1, currentNearOut + delta);

  prod.near_out_stock_threshold = newNearOut;
  filterAdminProducts();

  try {
    const { error } = await supabaseClient
      .from('products')
      .update({ near_out_stock_threshold: newNearOut })
      .eq('id', productId);

    if (error) throw error;
    showToast(`อัปเดตช่วงสินค้าใกล้หมดเป็น ${newNearOut} ชิ้นแล้ว`);
  } catch (err) {
    console.error('Quick near-out threshold update failed:', err);
    showToast('อัปเดตช่วงสินค้าใกล้หมดไม่สำเร็จ: ' + err.message);
    loadAdminProducts(true);
  }
}

function ensureAdminPaginationUi() {
  const tablePanel = document.querySelector('#admin-table-wrapper')?.closest('.panel');
  if (!tablePanel || document.getElementById('admin-pagination-bar')) return;

  const paginationBar = document.createElement('div');
  paginationBar.id = 'admin-pagination-bar';
  paginationBar.className = 'admin-pagination-bar hidden';
  paginationBar.innerHTML = `
    <div class="admin-pagination-summary" id="admin-pagination-summary">แสดง 0 รายการ</div>
    <div class="admin-pagination-controls">
      <label class="admin-page-size-label">
        <span>ต่อหน้า</span>
        <select id="admin-page-size" onchange="changeAdminPageSize(this.value)" class="admin-page-size-select">
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </label>
      <div class="admin-page-buttons" id="admin-page-buttons"></div>
    </div>
  `;

  tablePanel.appendChild(paginationBar);
}

function renderAdminPagination(totalItems) {
  ensureAdminPaginationUi();

  const bar = document.getElementById('admin-pagination-bar');
  const summary = document.getElementById('admin-pagination-summary');
  const pageButtons = document.getElementById('admin-page-buttons');
  const pageSizeSelect = document.getElementById('admin-page-size');
  if (!bar || !summary || !pageButtons || !pageSizeSelect) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / adminPageSize));
  adminCurrentPage = Math.min(Math.max(1, adminCurrentPage), totalPages);
  pageSizeSelect.value = String(adminPageSize);

  if (totalItems <= 0) {
    bar.classList.add('hidden');
    pageButtons.innerHTML = '';
    summary.textContent = 'ไม่พบรายการสินค้า';
    return;
  }

  bar.classList.remove('hidden');
  const start = (adminCurrentPage - 1) * adminPageSize + 1;
  const end = Math.min(totalItems, adminCurrentPage * adminPageSize);
  summary.textContent = `แสดง ${start}-${end} จาก ${totalItems} รายการ`;

  const pageNumbers = [];
  for (let page = 1; page <= totalPages; page += 1) {
    if (page === 1 || page === totalPages || Math.abs(page - adminCurrentPage) <= 1) {
      pageNumbers.push(page);
    } else if (pageNumbers[pageNumbers.length - 1] !== '...') {
      pageNumbers.push('...');
    }
  }

  pageButtons.innerHTML = `
    <button type="button" onclick="goToAdminPage(${adminCurrentPage - 1})" class="admin-page-btn" ${adminCurrentPage === 1 ? 'disabled' : ''}>
      <i class="fas fa-chevron-left"></i>
    </button>
    ${pageNumbers.map((item) => item === '...'
      ? '<span class="admin-page-ellipsis">...</span>'
      : `<button type="button" onclick="goToAdminPage(${item})" class="admin-page-btn ${item === adminCurrentPage ? 'active' : ''}">${item}</button>`
    ).join('')}
    <button type="button" onclick="goToAdminPage(${adminCurrentPage + 1})" class="admin-page-btn" ${adminCurrentPage === totalPages ? 'disabled' : ''}>
      <i class="fas fa-chevron-right"></i>
    </button>
  `;
}

function goToAdminPage(page) {
  const totalItems = lastFilteredAdminProducts.length || adminProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / adminPageSize));
  adminCurrentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  renderTableRows(lastFilteredAdminProducts);
}

function changeAdminPageSize(value) {
  adminPageSize = Math.max(1, Number(value) || 10);
  adminCurrentPage = 1;
  renderTableRows(lastFilteredAdminProducts);
}

function renderTableRows(list) {
  const wrapper = document.getElementById('admin-table-wrapper');
  const empty = document.getElementById('admin-empty');
  const tbody = document.getElementById('admin-product-rows');

  if (list.length === 0) {
    wrapper?.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  wrapper?.classList.remove('hidden');

  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / adminPageSize));
  adminCurrentPage = Math.min(Math.max(1, adminCurrentPage), totalPages);
  const startIndex = (adminCurrentPage - 1) * adminPageSize;
  const pageItems = list.slice(startIndex, startIndex + adminPageSize);

  tbody.innerHTML = pageItems.map(prod => {
    const imgs = getProductImages(prod);
    const cover = imgs[0]?.src || 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=200&q=80';
    const name = safeText(prod.name, 'ไม่ระบุชื่อ');
    const sku = safeText(prod.sku, 'N/A');
    const catStr = getCategoryString(prod);
    const price = prod.price != null && prod.price !== '' ? parseFloat(prod.price).toLocaleString() : '0';
    const usableQty = getUsableStockQuantity(prod);
    const damagedQty = getDamagedStockQuantity(prod);
    const lowStockThreshold = getLowStockThreshold(prod);
    const activeThreshold = showNearOutOnly && customLowStockThreshold != null ? customLowStockThreshold : lowStockThreshold;
    const nearOutUpperBound = activeThreshold > 0 ? activeThreshold * 2 : 0;
    const lowStock = showNearOutOnly && customLowStockThreshold != null
      ? (usableQty > 0 && usableQty <= customLowStockThreshold)
      : (isLowStock(prod) && usableQty > 0);
    const instock = prod.stock_status !== 'outofstock' && usableQty > 0;

    const statusBadge = instock
      ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold ${lowStock ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400'}">
           <i class="fas fa-circle text-[6px]"></i> พร้อมส่ง
         </span>`
      : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
           <i class="fas fa-circle text-[6px]"></i> หมดชั่วคราว
         </span>`;

    return `
      <tr class="hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
        <td class="py-3 px-4 text-center">
          <div class="w-10 h-13 aspect-[3/4] rounded-lg overflow-hidden border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 mx-auto">
            <img src="${cover}" alt="${name}" class="w-full h-full object-cover" onerror="this.src='https://images.unsplash.com/photo-1512820790803-83ca734da794?w=200&q=80'">
          </div>
        </td>
        <td class="py-3 px-4">
          <p class="font-bold text-stone-900 dark:text-stone-100 line-clamp-1 hover:text-primary transition">${name}</p>
          <p class="text-[10px] font-mono text-stone-400 mt-0.5">SKU: <span class="text-stone-600 dark:text-stone-300 font-bold">${sku}</span></p>
          <div class="sm:hidden mt-2 flex items-center gap-2">
            <button onclick="openEditModal(${prod.id})" class="px-2.5 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center gap-1 text-[10px] font-bold transition" title="แก้ไข">
              <i class="fas fa-pen-to-square text-[10px]"></i> แก้ไข
            </button>
            <button onclick="openDeleteModal(${prod.id})" class="px-2.5 py-1.5 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 flex items-center gap-1 text-[10px] font-bold transition" title="ลบ">
              <i class="fas fa-trash text-[10px]"></i> ลบ
            </button>
          </div>
        </td>
        <td class="py-3 px-4 text-stone-600 dark:text-stone-300 font-medium">
          <span class="inline-block px-2 py-0.5 rounded-md bg-stone-100 dark:bg-stone-800 text-[11px]">${catStr}</span>
        </td>
        <td class="py-3 px-4 text-right font-black text-primary dark:text-amber-300 font-sans text-sm">
          ฿${price}
        </td>
        <td class="py-3 px-4 text-center">
          <div class="space-y-2">
            <div class="flex items-center justify-center gap-2">
              <span class="w-10 text-right text-[10px] font-bold text-emerald-600 dark:text-emerald-400">ใช้ได้</span>
              <div class="inline-flex items-center border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden bg-white dark:bg-stone-900">
                <button onclick="quickAdjustStock(${prod.id}, -1)" class="w-6 h-6 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="ลดสต็อกใช้ได้">-</button>
                <span class="w-8 text-center text-xs font-bold text-stone-800 dark:text-white font-sans">${usableQty}</span>
                <button onclick="quickAdjustStock(${prod.id}, 1)" class="w-6 h-6 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="เพิ่มสต็อกใช้ได้">+</button>
              </div>
            </div>
            <div class="flex items-center justify-center gap-2">
              <span class="w-10 text-right text-[10px] font-bold text-rose-500 dark:text-rose-400">ชำรุด</span>
              <div class="inline-flex items-center border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden bg-white dark:bg-stone-900">
                <button onclick="quickAdjustDamagedStock(${prod.id}, -1)" class="w-6 h-6 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="ลดสต็อกชำรุด">-</button>
                <span class="w-8 text-center text-xs font-bold text-stone-800 dark:text-white font-sans">${damagedQty}</span>
                <button onclick="quickAdjustDamagedStock(${prod.id}, 1)" class="w-6 h-6 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="เพิ่มสต็อกชำรุด">+</button>
              </div>
            </div>
            <div class="text-[10px] font-bold ${lowStock ? 'text-amber-600 dark:text-amber-300' : 'text-stone-400'}">
              ${activeThreshold > 0 ? `เตือนเมื่อเหลือ <= ${activeThreshold}${lowStock ? ' | สต็อกต่ำ' : ''}` : 'ยังไม่ตั้งค่าแจ้งเตือน'}
            </div>
          </div>
        </td>
        <td class="py-3 px-4 text-center">
          ${statusBadge}
        </td>
        <td class="hidden sm:table-cell py-3 px-4 text-center sticky-action-col">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openEditModal(${prod.id})" class="w-7 h-7 rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-amber-100 dark:hover:bg-amber-950 text-stone-600 dark:text-stone-300 hover:text-amber-700 dark:hover:text-amber-300 flex items-center justify-center transition" title="แก้ไข">
              <i class="fas fa-pen-to-square text-xs"></i>
            </button>
            <button onclick="openDeleteModal(${prod.id})" class="w-7 h-7 rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-rose-100 dark:hover:bg-rose-950 text-stone-600 dark:text-stone-300 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition" title="ลบ">
              <i class="fas fa-trash text-xs"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  renderAdminPagination(totalItems);
}

function renderTableRows(list) {
  const wrapper = document.getElementById('admin-table-wrapper');
  const empty = document.getElementById('admin-empty');
  const tbody = document.getElementById('admin-product-rows');

  if (list.length === 0) {
    wrapper?.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  wrapper?.classList.remove('hidden');

  tbody.innerHTML = list.map(prod => {
    const imgs = getProductImages(prod);
    const cover = imgs[0]?.src || 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=200&q=80';
    const name = safeText(prod.name, 'ไม่ระบุชื่อ');
    const sku = safeText(prod.sku, 'N/A');
    const catStr = getCategoryString(prod);
    const price = prod.price != null && prod.price !== '' ? parseFloat(prod.price).toLocaleString() : '0';
    const usableQty = getUsableStockQuantity(prod);
    const damagedQty = getDamagedStockQuantity(prod);
    const lowStockThreshold = getLowStockThreshold(prod);
    const activeThreshold = showNearOutOnly && customLowStockThreshold != null ? customLowStockThreshold : lowStockThreshold;
    const nearOutUpperBound = activeThreshold > 0 ? activeThreshold * 2 : 0;
    const lowStock = showNearOutOnly && customLowStockThreshold != null
      ? (usableQty > 0 && usableQty <= customLowStockThreshold)
      : (isLowStock(prod) && usableQty > 0);
    const instock = prod.stock_status !== 'outofstock' && usableQty > 0;

    const statusBadge = instock
      ? `<span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold ${lowStock ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400'}">
           <i class="fas fa-circle text-[6px]"></i> ${lowStock ? 'ใกล้หมด' : 'พร้อมส่ง'}
         </span>`
      : `<span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
           <i class="fas fa-circle text-[6px]"></i> หมดชั่วคราว
         </span>`;

    return `
      <tr class="admin-table-row hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
        <td class="py-4 px-4 text-center">
          <button type="button" onclick="openImageLightbox('${cover.replace(/'/g, "\\'")}', '${name.replace(/'/g, "\\'")}')" class="admin-book-cover w-16 h-24 aspect-[2/3] rounded-[22px] overflow-hidden border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 mx-auto shadow-sm" title="กดเพื่อดูรูปใหญ่">
            <img src="${cover}" alt="${name}" class="w-full h-full object-cover" onerror="this.src='https://images.unsplash.com/photo-1512820790803-83ca734da794?w=200&q=80'">
          </button>
        </td>
        <td class="py-4 px-4">
          <p class="admin-product-name font-bold text-sm text-stone-900 dark:text-stone-100 line-clamp-2 leading-snug">${name}</p>
          <p class="admin-sku text-[10px] font-mono text-stone-400 mt-1">SKU: <span class="text-stone-600 dark:text-stone-300 font-bold">${sku}</span></p>
          <div class="sm:hidden mt-2 flex items-center gap-2">
            <button onclick="openEditModal(${prod.id})" class="px-2.5 py-1.5 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center gap-1 text-[10px] font-bold transition" title="แก้ไข">
              <i class="fas fa-pen-to-square text-[10px]"></i> แก้ไข
            </button>
            <button onclick="openDeleteModal(${prod.id})" class="px-2.5 py-1.5 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 flex items-center gap-1 text-[10px] font-bold transition" title="ลบ">
              <i class="fas fa-trash text-[10px]"></i> ลบ
            </button>
          </div>
        </td>
        <td class="py-4 px-4 text-stone-600 dark:text-stone-300 font-medium">
          <span class="admin-category-pill inline-block px-3 py-1.5 rounded-full bg-stone-100 dark:bg-stone-800 text-[11px]">${catStr}</span>
        </td>
        <td class="py-4 px-4 text-right font-black text-primary dark:text-amber-300 font-sans text-base">
          <span class="admin-price">฿${price}</span>
        </td>
        <td class="py-4 px-4 text-center">
          <div class="admin-stock-cell">
            <div class="admin-stock-row">
              <span class="admin-stock-label usable">ใช้ได้</span>
              <div class="inline-flex items-center border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden bg-white dark:bg-stone-900 shadow-sm">
                <button onclick="quickAdjustStock(${prod.id}, -1)" class="w-7 h-7 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="ลดสต็อกใช้ได้">-</button>
                <span class="w-10 text-center text-xs font-bold text-stone-800 dark:text-white font-sans">${usableQty}</span>
                <button onclick="quickAdjustStock(${prod.id}, 1)" class="w-7 h-7 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="เพิ่มสต็อกใช้ได้">+</button>
              </div>
            </div>
            <div class="admin-stock-row">
              <span class="admin-stock-label damaged">ชำรุด</span>
              <div class="inline-flex items-center border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden bg-white dark:bg-stone-900 shadow-sm">
                <button onclick="quickAdjustDamagedStock(${prod.id}, -1)" class="w-7 h-7 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="ลดสต็อกชำรุด">-</button>
                <span class="w-10 text-center text-xs font-bold text-stone-800 dark:text-white font-sans">${damagedQty}</span>
                <button onclick="quickAdjustDamagedStock(${prod.id}, 1)" class="w-7 h-7 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="เพิ่มสต็อกชำรุด">+</button>
              </div>
            </div>
            <div class="admin-stock-hint ${lowStock ? 'low' : ''}">
              ${activeThreshold > 0 ? `เตือนเมื่อเหลือไม่เกิน ${activeThreshold} ชิ้น` : 'ยังไม่ตั้งค่าระดับเตือน'}
            </div>
            ${activeThreshold > 0 ? `
              <div class="admin-stock-range-grid">
                <div class="admin-range-card alert ${lowStock ? 'active' : ''}">
                  <div class="admin-range-title">จุดแจ้งเตือน</div>
                  <div class="admin-range-value">
                    <span class="op"><=</span>
                    <span class="num">${activeThreshold}</span>
                    <span class="unit">ชิ้น</span>
                  </div>
                </div>
                <div class="admin-range-card near-out ${usableQty > activeThreshold && usableQty <= nearOutUpperBound ? 'active' : ''}">
                  <div class="admin-range-title">ช่วงสินค้าใกล้หมด</div>
                  <div class="admin-range-value">
                    <span class="op">></span>
                    <span class="num">${activeThreshold}</span>
                    <span class="mid">ถึง</span>
                    <span class="num">${nearOutUpperBound}</span>
                    <span class="unit">ชิ้น</span>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        </td>
        <td class="py-4 px-4 text-center">
          ${statusBadge}
        </td>
        <td class="hidden sm:table-cell py-4 px-4 text-center sticky-action-col">
          <div class="admin-row-actions flex items-center justify-center gap-2">
            <button onclick="openEditModal(${prod.id})" class="w-8 h-8 rounded-xl bg-stone-100 dark:bg-stone-800 hover:bg-amber-100 dark:hover:bg-amber-950 text-stone-600 dark:text-stone-300 hover:text-amber-700 dark:hover:text-amber-300 flex items-center justify-center transition" title="แก้ไข">
              <i class="fas fa-pen-to-square text-xs"></i>
            </button>
            <button onclick="openDeleteModal(${prod.id})" class="w-8 h-8 rounded-xl bg-stone-100 dark:bg-stone-800 hover:bg-rose-100 dark:hover:bg-rose-950 text-stone-600 dark:text-stone-300 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition" title="ลบ">
              <i class="fas fa-trash text-xs"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function applyAdminTableHeaders() {
  const headerRow = document.querySelector('#admin-table-wrapper thead tr');
  if (!headerRow) return;

  headerRow.innerHTML = `
    <th class="py-3.5 px-4 w-16 text-center">รูป</th>
    <th class="py-3.5 px-4">ชื่อหนังสือ / SKU</th>
    <th class="py-3.5 px-4">หมวดหมู่</th>
    <th class="py-3.5 px-4 w-28 text-right">ราคา (บาท)</th>
    <th class="py-3.5 px-4 w-36 text-center">จำนวนสต็อก</th>
    <th class="py-3.5 px-4 w-32 text-center">จุดแจ้งเตือน</th>
    <th class="py-3.5 px-4 w-28 text-center">สถานะ</th>
    <th class="hidden sm:table-cell py-3.5 px-4 w-28 text-center sticky-action-col">จัดการ</th>
  `;
}

function renderTableRows(list) {
  const wrapper = document.getElementById('admin-table-wrapper');
  const empty = document.getElementById('admin-empty');
  const tbody = document.getElementById('admin-product-rows');

  applyAdminTableHeaders();

  if (list.length === 0) {
    wrapper?.classList.add('hidden');
    empty?.classList.remove('hidden');
    document.getElementById('admin-pagination-bar')?.classList.add('hidden');
    return;
  }

  empty?.classList.add('hidden');
  wrapper?.classList.remove('hidden');

  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / adminPageSize));
  adminCurrentPage = Math.min(Math.max(1, adminCurrentPage), totalPages);
  const startIndex = (adminCurrentPage - 1) * adminPageSize;
  const pageItems = list.slice(startIndex, startIndex + adminPageSize);

  tbody.innerHTML = pageItems.map((prod) => {
    const imgs = getProductImages(prod);
    const cover = imgs[0]?.src || 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=200&q=80';
    const name = safeText(prod.name, 'ไม่ระบุชื่อ');
    const sku = safeText(prod.sku, 'N/A');
    const catStr = getCategoryString(prod);
    const price = prod.price != null && prod.price !== '' ? parseFloat(prod.price).toLocaleString() : '0';
    const usableQty = getUsableStockQuantity(prod);
    const damagedQty = getDamagedStockQuantity(prod);
    const lowStockThreshold = getLowStockThreshold(prod);
    const lowStock = showNearOutOnly && customLowStockThreshold != null
      ? (usableQty > 0 && usableQty <= customLowStockThreshold)
      : (isLowStock(prod) && usableQty > 0);
    const instock = prod.stock_status !== 'outofstock' && usableQty > 0;

    const statusBadge = instock
      ? `<span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold ${lowStock ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300' : 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400'}">
           <i class="fas fa-circle text-[6px]"></i> ${lowStock ? 'ใกล้หมด' : 'พร้อมส่ง'}
         </span>`
      : `<span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
           <i class="fas fa-circle text-[6px]"></i> หมดชั่วคราว
         </span>`;

    return `
      <tr class="admin-table-row hover:bg-stone-50/80 dark:hover:bg-stone-850/50 transition duration-150">
        <td class="py-4 px-4 text-center">
          <button type="button" onclick="openImageLightbox('${cover.replace(/'/g, "\\'")}', '${name.replace(/'/g, "\\'")}')" class="admin-book-cover w-16 h-24 aspect-[2/3] rounded-[22px] overflow-hidden border border-stone-200 dark:border-stone-700 bg-stone-100 dark:bg-stone-900 mx-auto shadow-sm" title="กดเพื่อดูรูปใหญ่">
            <img src="${cover}" alt="${name}" class="w-full h-full object-cover" onerror="this.src='https://images.unsplash.com/photo-1512820790803-83ca734da794?w=200&q=80'">
          </button>
        </td>
        <td class="py-4 px-4">
          <p class="admin-product-name font-bold text-sm text-stone-900 dark:text-stone-100 line-clamp-2 leading-snug">${name}</p>
          <p class="admin-sku text-[10px] font-mono text-stone-400 mt-1">SKU: <span class="text-stone-600 dark:text-stone-300 font-bold">${sku}</span></p>
          <div class="sm:hidden mt-2 flex items-center gap-2">
            <button onclick="openEditModal(${prod.id})" class="px-2.5 py-1.5 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center gap-1 text-[10px] font-bold transition" title="แก้ไข">
              <i class="fas fa-pen-to-square text-[10px]"></i> แก้ไข
            </button>
            <button onclick="openDeleteModal(${prod.id})" class="px-2.5 py-1.5 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 flex items-center gap-1 text-[10px] font-bold transition" title="ลบ">
              <i class="fas fa-trash text-[10px]"></i> ลบ
            </button>
          </div>
        </td>
        <td class="py-4 px-4 text-stone-600 dark:text-stone-300 font-medium">
          <span class="admin-category-pill inline-block px-3 py-1.5 rounded-full bg-stone-100 dark:bg-stone-800 text-[11px]">${catStr}</span>
        </td>
        <td class="py-4 px-4 text-right font-black text-primary dark:text-amber-300 font-sans text-base">
          <span class="admin-price">฿${price}</span>
        </td>
        <td class="py-4 px-4 text-center">
          <div class="admin-stock-cell">
            <div class="admin-stock-row">
              <span class="admin-stock-label usable">ใช้ได้</span>
              <div class="inline-flex items-center border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden bg-white dark:bg-stone-900 shadow-sm">
                <button onclick="quickAdjustStock(${prod.id}, -1)" class="w-7 h-7 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="ลดสต็อกใช้ได้">-</button>
                <span class="w-10 text-center text-xs font-bold text-stone-800 dark:text-white font-sans">${usableQty}</span>
                <button onclick="quickAdjustStock(${prod.id}, 1)" class="w-7 h-7 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="เพิ่มสต็อกใช้ได้">+</button>
              </div>
            </div>
            <div class="admin-stock-row">
              <span class="admin-stock-label damaged">ชำรุด</span>
              <div class="inline-flex items-center border border-stone-200 dark:border-stone-700 rounded-xl overflow-hidden bg-white dark:bg-stone-900 shadow-sm">
                <button onclick="quickAdjustDamagedStock(${prod.id}, -1)" class="w-7 h-7 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="ลดสต็อกชำรุด">-</button>
                <span class="w-10 text-center text-xs font-bold text-stone-800 dark:text-white font-sans">${damagedQty}</span>
                <button onclick="quickAdjustDamagedStock(${prod.id}, 1)" class="w-7 h-7 flex items-center justify-center hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-500 font-bold transition" title="เพิ่มสต็อกชำรุด">+</button>
              </div>
            </div>
          </div>
        </td>
        <td class="py-4 px-4 text-center">
          <div class="admin-threshold-editor ${lowStock ? 'active' : ''}">
            <div class="admin-threshold-stepper">
              <button onclick="quickAdjustLowStockThreshold(${prod.id}, -1)" class="admin-step-btn" title="ลดจุดแจ้งเตือน">-</button>
              <label class="admin-threshold-input-wrap">
                <input type="number" min="0" step="1" value="${lowStockThreshold}" class="admin-threshold-input" aria-label="จุดแจ้งเตือน ${name}" onchange="setLowStockThresholdValue(${prod.id}, this.value)">
                <span class="admin-threshold-unit">ชิ้น</span>
              </label>
              <button onclick="quickAdjustLowStockThreshold(${prod.id}, 1)" class="admin-step-btn" title="เพิ่มจุดแจ้งเตือน">+</button>
            </div>
          </div>
        </td>
        <td class="py-4 px-4 text-center">
          ${statusBadge}
        </td>
        <td class="hidden sm:table-cell py-4 px-4 text-center sticky-action-col">
          <div class="admin-row-actions flex items-center justify-center gap-2">
            <button onclick="openEditModal(${prod.id})" class="w-8 h-8 rounded-xl bg-stone-100 dark:bg-stone-800 hover:bg-amber-100 dark:hover:bg-amber-950 text-stone-600 dark:text-stone-300 hover:text-amber-700 dark:hover:text-amber-300 flex items-center justify-center transition" title="แก้ไข">
              <i class="fas fa-pen-to-square text-xs"></i>
            </button>
            <button onclick="openDeleteModal(${prod.id})" class="w-8 h-8 rounded-xl bg-stone-100 dark:bg-stone-800 hover:bg-rose-100 dark:hover:bg-rose-950 text-stone-600 dark:text-stone-300 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition" title="ลบ">
              <i class="fas fa-trash text-xs"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  renderAdminPagination(totalItems);
}

Object.assign(window, {
  toggleTheme,
  loadAdminProducts,
  filterAdminProducts,
  goToAdminPage,
  changeAdminPageSize,
  quickAdjustStock,
  quickAdjustDamagedStock,
  quickAdjustLowStockThreshold,
  quickAdjustNearOutThreshold,
  setLowStockThresholdValue,
  setNearOutThresholdValue,
  applyCustomLowStockFilter,
  clearCustomLowStockFilter,
  toggleAlertLevelFilter,
  toggleNearOutFilter,
  addImageFromUrl,
  handleImageFileUpload,
  setCoverImage,
  removeFormImage,
  openAddModal,
  openEditModal,
  closeBookFormModal,
  handleFormSubmit,
  openDeleteModal,
  closeDeleteModal,
  confirmDeleteBook,
  openImageLightbox,
  closeImageLightbox
});

window.addEventListener('DOMContentLoaded', () => {
  applyAdminTableHeaders();
  ensureLowStockUi();
  updateCustomLowStockUi();
  document.getElementById('input-usable-stock-qty')?.addEventListener('input', syncStockSummaryInputs);
  document.getElementById('input-damaged-stock-qty')?.addEventListener('input', syncStockSummaryInputs);
  syncStockSummaryInputs();
  initTheme();
  initSupabase();
  setupAdminAuth();

  document.getElementById('image-lightbox-modal')?.addEventListener('click', (event) => {
    if (event.target?.id === 'image-lightbox-modal') {
      closeImageLightbox();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeImageLightbox();
    }
  });
});
