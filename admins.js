const SUPABASE_URL = 'https://ueptjmsurtshpcldpxxp.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcHRqbXN1cnRzaHBjbGRweHhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NjQzNDIsImV4cCI6MjEwMjI0MDM0Mn0.lma8_ZDsRl35NHAFv7qWE7kF-wQeNGp_uYdHbfM1958';

let supabaseClient = null;
let adminAccounts = [];
let memberAccounts = [];
let removingAdminEmail = null;

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

function initSupabase() {
  if (!window.supabase) {
    console.error('Supabase SDK ยังไม่โหลด');
    return false;
  }

  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    console.log('Admins Supabase connected:', SUPABASE_URL);
    return true;
  } catch (err) {
    console.error('Supabase init error:', err);
    return false;
  }
}

function formatDateTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return value;
  }
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

function escapeHtml(value) {
  return decodeMojibake(String(value ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] bg-stone-900 text-white text-sm font-bold px-4 py-3 rounded-2xl shadow-2xl';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function updateAdminStats() {
  document.getElementById('admins-count').textContent = adminAccounts.length;
  document.getElementById('admins-latest').textContent = adminAccounts[0]?.email || '-';
  const pendingCount = document.getElementById('non-admin-count');
  if (pendingCount) pendingCount.textContent = memberAccounts.length;
}

function renderAdminRows() {
  const rows = document.getElementById('admins-rows');
  const empty = document.getElementById('admins-empty');
  const wrapper = document.getElementById('admins-table-wrapper');

  if (!adminAccounts.length) {
    rows.innerHTML = '';
    wrapper?.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  wrapper?.classList.remove('hidden');

  rows.innerHTML = adminAccounts.map((admin) => `
    <tr class="hover:bg-stone-50/70 dark:hover:bg-stone-900/40 transition">
      <td class="py-4 px-4">
        <div class="font-bold text-stone-900 dark:text-stone-100 break-all">${escapeHtml(admin.email || '-')}</div>
      </td>
      <td class="py-4 px-4 text-stone-600 dark:text-stone-300">${escapeHtml(admin.display_name || '-')}</td>
      <td class="py-4 px-4 text-stone-500 dark:text-stone-400">${formatDateTime(admin.created_at)}</td>
      <td class="py-4 px-4 text-stone-500 dark:text-stone-400">${formatDateTime(admin.last_sign_in_at)}</td>
      <td class="py-4 px-4 text-center">
        <span class="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-950/50 px-3 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
          <i class="fas fa-shield-halved mr-1"></i> Admin
        </span>
      </td>
      <td class="py-4 px-4 text-center">
        <button onclick="openRemoveAdminModal('${escapeJsString(admin.email || '')}')" class="inline-flex items-center gap-1 rounded-xl border border-rose-200 dark:border-rose-900 px-3 py-2 text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition">
          <i class="fas fa-user-minus"></i> ถอดสิทธิ์
        </button>
      </td>
    </tr>
  `).join('');
}

function renderMemberRows() {
  const rows = document.getElementById('non-admin-rows');
  const empty = document.getElementById('non-admin-empty');
  const wrapper = document.getElementById('non-admin-table-wrapper');

  if (!rows || !empty || !wrapper) return;

  if (!memberAccounts.length) {
    rows.innerHTML = '';
    wrapper.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  wrapper.classList.remove('hidden');

  rows.innerHTML = memberAccounts.map((member) => `
    <tr class="hover:bg-stone-50/70 dark:hover:bg-stone-900/40 transition">
      <td class="py-4 px-4">
        <div class="font-bold text-stone-900 dark:text-stone-100 break-all">${escapeHtml(member.email || '-')}</div>
      </td>
      <td class="py-4 px-4 text-stone-600 dark:text-stone-300">${escapeHtml(member.display_name || '-')}</td>
      <td class="py-4 px-4 text-stone-500 dark:text-stone-400">${formatDateTime(member.created_at)}</td>
      <td class="py-4 px-4 text-stone-500 dark:text-stone-400">${formatDateTime(member.last_sign_in_at)}</td>
      <td class="py-4 px-4 text-center">
        <span class="inline-flex items-center rounded-full bg-stone-100 dark:bg-stone-800 px-3 py-1 text-[11px] font-bold text-stone-600 dark:text-stone-300">
          <i class="fas fa-user mr-1"></i> User
        </span>
      </td>
      <td class="py-4 px-4 text-center">
        <button onclick="grantAdminFromList('${escapeJsString(member.email || '')}')" class="inline-flex items-center gap-1 rounded-xl bg-primary hover:bg-primary-hover text-white px-3 py-2 text-[11px] font-bold transition">
          <i class="fas fa-user-shield"></i> มอบสิทธิ์
        </button>
      </td>
    </tr>
  `).join('');
}

function renderAllTables() {
  document.getElementById('admins-loading')?.classList.add('hidden');
  renderAdminRows();
  renderMemberRows();
  updateAdminStats();
}

async function loadAdminAccounts() {
  const loading = document.getElementById('admins-loading');
  const adminEmpty = document.getElementById('admins-empty');
  const adminWrapper = document.getElementById('admins-table-wrapper');
  const memberEmpty = document.getElementById('non-admin-empty');
  const memberWrapper = document.getElementById('non-admin-table-wrapper');

  loading?.classList.remove('hidden');
  adminEmpty?.classList.add('hidden');
  adminWrapper?.classList.add('hidden');
  memberEmpty?.classList.add('hidden');
  memberWrapper?.classList.add('hidden');

  try {
    const { data, error } = await supabaseClient.rpc('list_manageable_accounts');
    if (error) throw error;

    const accounts = Array.isArray(data) ? data : [];
    adminAccounts = accounts.filter((item) => item.is_admin);
    memberAccounts = accounts.filter((item) => !item.is_admin);

    adminAccounts.sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')));
    memberAccounts.sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')));

    renderAllTables();
  } catch (err) {
    console.error('Load accounts failed:', err);
    loading?.classList.add('hidden');
    adminEmpty?.classList.remove('hidden');
    memberEmpty?.classList.remove('hidden');
    showToast('โหลดรายชื่อผู้ใช้ไม่สำเร็จ: ' + err.message);
  }
}

async function promoteAdmin(targetEmail) {
  const input = document.getElementById('admin-email-input');
  const errorBox = document.getElementById('admin-form-error');
  const email = String(targetEmail || input?.value || '').trim().toLowerCase();

  errorBox.classList.add('hidden');
  errorBox.textContent = '';

  if (!email) {
    errorBox.textContent = 'กรุณากรอกอีเมลผู้ใช้ก่อน';
    errorBox.classList.remove('hidden');
    return;
  }

  try {
    const { error } = await supabaseClient.rpc('set_admin_status', {
      target_email: email,
      make_admin: true
    });
    if (error) throw error;

    if (input) input.value = '';
    showToast(`เพิ่ม ${email} เป็นแอดมินแล้ว`);
    await loadAdminAccounts();
  } catch (err) {
    console.error('Promote admin failed:', err);
    errorBox.textContent = err.message || 'เพิ่มแอดมินไม่สำเร็จ';
    errorBox.classList.remove('hidden');
  }
}

async function grantAdminFromList(email) {
  await promoteAdmin(email);
}

function openRemoveAdminModal(email) {
  removingAdminEmail = email;
  document.getElementById('remove-admin-email').textContent = email || '-';
  document.getElementById('remove-admin-modal').classList.remove('hidden');
}

function closeRemoveAdminModal() {
  removingAdminEmail = null;
  document.getElementById('remove-admin-modal').classList.add('hidden');
}

async function confirmRemoveAdmin() {
  if (!removingAdminEmail) return;

  const confirmBtn = document.getElementById('remove-admin-confirm-btn');
  const original = confirmBtn.textContent;
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'กำลังดำเนินการ...';

  try {
    const { error } = await supabaseClient.rpc('set_admin_status', {
      target_email: removingAdminEmail,
      make_admin: false
    });
    if (error) throw error;

    showToast(`ถอดสิทธิ์แอดมินของ ${removingAdminEmail} แล้ว`);
    closeRemoveAdminModal();
    await loadAdminAccounts();
  } catch (err) {
    console.error('Remove admin failed:', err);
    showToast('ถอดสิทธิ์แอดมินไม่สำเร็จ: ' + err.message);
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = original;
  }
}

function showAuthScreen(message = '') {
  const authScreen = document.getElementById('admins-auth-screen');
  const appShell = document.getElementById('admins-app-shell');
  const errorBox = document.getElementById('admins-auth-error');
  const logoutBtn = document.getElementById('admins-logout-btn');

  authScreen?.classList.remove('hidden');
  appShell?.classList.add('hidden');
  logoutBtn?.classList.add('hidden');

  if (message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
  } else {
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }
}

function showAppShell() {
  const authScreen = document.getElementById('admins-auth-screen');
  const appShell = document.getElementById('admins-app-shell');
  const errorBox = document.getElementById('admins-auth-error');
  const logoutBtn = document.getElementById('admins-logout-btn');

  authScreen?.classList.add('hidden');
  appShell?.classList.remove('hidden');
  logoutBtn?.classList.remove('hidden');
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

function setupAdminsAuth() {
  const loginForm = document.getElementById('admins-login-form');
  const authError = document.getElementById('admins-auth-error');
  const logoutBtn = document.getElementById('admins-logout-btn');

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    authError.classList.add('hidden');
    authError.textContent = '';

    const email = document.getElementById('admins-email').value.trim();
    const password = document.getElementById('admins-password').value;

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;

      if (!isAllowedAdminSession(data.session)) {
        await supabaseClient.auth.signOut();
        throw new Error('บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานหลังร้าน');
      }

      showAppShell();
      await loadAdminAccounts();
    } catch (err) {
      console.error('Admins login failed:', err);
      authError.textContent = err.message || 'เข้าสู่ระบบไม่สำเร็จ';
      authError.classList.remove('hidden');
    }
  });

  logoutBtn?.addEventListener('click', async () => {
    try {
      await supabaseClient.auth.signOut();
    } catch (err) {
      console.error('Admins logout failed:', err);
    } finally {
      showAuthScreen();
    }
  });

  supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) {
      showAuthScreen();
      return;
    }

    if (!isAllowedAdminSession(session)) {
      await supabaseClient.auth.signOut();
      showAuthScreen('บัญชีนี้ไม่มีสิทธิ์เข้าใช้งานหลังร้าน');
      return;
    }

    showAppShell();
    await loadAdminAccounts();
  });
}

Object.assign(window, {
  toggleTheme,
  loadAdminAccounts,
  promoteAdmin,
  grantAdminFromList,
  openRemoveAdminModal,
  closeRemoveAdminModal,
  confirmRemoveAdmin
});

window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (!initSupabase()) {
    showAuthScreen('ไม่สามารถเชื่อมต่อ Supabase ได้');
    return;
  }
  setupAdminsAuth();
});
