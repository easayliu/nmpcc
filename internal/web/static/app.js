// ── Theme ──
// Theme: 'light', 'dark', or 'system' (follow OS)
function getEffectiveTheme(pref) {
  if (pref === 'system' || !pref) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}

function applyTheme(pref) {
  var effective = getEffectiveTheme(pref);
  if (effective === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  var sun = document.getElementById('themeIconSun');
  var moon = document.getElementById('themeIconMoon');
  var sys = document.getElementById('themeIconSystem');
  if (sun && moon && sys) {
    sun.classList.add('hidden');
    moon.classList.add('hidden');
    sys.classList.add('hidden');
    if (pref === 'system' || !pref) {
      sys.classList.remove('hidden');
    } else if (effective === 'dark') {
      sun.classList.remove('hidden');
    } else {
      moon.classList.remove('hidden');
    }
  }
}

var currentThemePref = localStorage.getItem('nmpcc_theme') || 'system';
applyTheme(currentThemePref);

// Listen for OS theme changes when in system mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
  if (currentThemePref === 'system') {
    applyTheme('system');
  }
});

function toggleTheme() {
  // Cycle: system -> light -> dark -> system
  var order = ['system', 'light', 'dark'];
  var idx = order.indexOf(currentThemePref);
  currentThemePref = order[(idx + 1) % order.length];
  localStorage.setItem('nmpcc_theme', currentThemePref);
  applyTheme(currentThemePref);
}

// ── Mobile sidebar ──
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
}

// ── Pull to refresh (mobile) ──
(function() {
  var startY = 0, pulling = false, pullDist = 0;
  var threshold = 60;
  var $content = null, $indicator = null;

  function init() {
    $content = document.getElementById('content');
    $indicator = document.getElementById('pullIndicator');
    if (!$content || !$indicator) return;

    $content.addEventListener('touchstart', function(e) {
      if ($content.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      pulling = true;
      pullDist = 0;
      $indicator.classList.add('pulling');
      $indicator.classList.remove('ready', 'refreshing');
    }, { passive: true });

    $content.addEventListener('touchmove', function(e) {
      if (!pulling) return;
      var dy = e.touches[0].clientY - startY;
      if (dy < 0) { pullDist = 0; $indicator.style.height = '0'; return; }
      pullDist = Math.min(dy * 0.5, 80);
      $indicator.style.height = pullDist + 'px';
      if (pullDist >= threshold) {
        $indicator.classList.add('ready');
      } else {
        $indicator.classList.remove('ready');
      }
    }, { passive: true });

    $content.addEventListener('touchend', function() {
      if (!pulling) return;
      pulling = false;
      $indicator.classList.remove('pulling');
      if (pullDist >= threshold) {
        $indicator.classList.remove('ready');
        $indicator.classList.add('refreshing');
        $indicator.style.height = '40px';
        loadAll().then(function() {
          $indicator.classList.remove('refreshing');
          $indicator.style.height = '0';
        });
      } else {
        $indicator.style.height = '0';
      }
      pullDist = 0;
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ── State ──
let apiKey = localStorage.getItem('nmpcc_api_key') || '';
let currentPage = location.hash.replace('#', '') || 'overview';
let cachedDashboard = null;
let cachedAccounts = [];
let cachedLogs = [];
let lastRefreshTime = 0;

// ── API ──
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (apiKey) opts.headers['Authorization'] = 'Bearer ' + apiKey;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

// ── Data loading ──
async function loadAll(silent) {
  const icon = document.getElementById('refreshIcon');
  if (!silent) icon.classList.add('spin');
  try {
    const [dash, status] = await Promise.all([
      api('GET', '/api/dashboard'),
      api('GET', '/status'),
    ]);
    cachedDashboard = dash.error ? null : dash;
    cachedAccounts = status.accounts || [];
    lastRefreshTime = Date.now();
    document.getElementById('connDot').className = 'w-2 h-2 rounded-full bg-emerald-500 pulse-dot';
    // Update sidebar badge
    const badge = document.getElementById('accountsBadge');
    if (badge) badge.textContent = cachedAccounts.length;
    // Update sidebar uptime
    updateSidebarUptime();
  } catch {
    document.getElementById('connDot').className = 'w-2 h-2 rounded-full bg-red-500';
  }
  if (!silent) icon.classList.remove('spin');
  render();
}

function updateSidebarUptime() {
  const $el = document.getElementById('sidebarUptime');
  if ($el && cachedDashboard) {
    $el.textContent = formatUptime(cachedDashboard.uptime_seconds);
  }
}

// ── Navigation ──
function navigate(page) {
  currentPage = page;
  location.hash = page;
  // Close mobile sidebar
  document.querySelector('.sidebar')?.classList.remove('open');
  render();
}
window.addEventListener('hashchange', function() {
  var page = location.hash.replace('#', '');
  if (page && page !== currentPage) { currentPage = page; render(); }
});

function render() {
  // Desktop sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    const isActive = el.dataset.nav === currentPage;
    el.className = `nav-item w-full text-left px-3 py-2 rounded-lg text-[12px] flex items-center gap-2.5 transition-colors font-medium ${
      isActive ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg hover:bg-surface-1'
    }`;
  });
  // Mobile tab bar
  document.querySelectorAll('.mob-tab').forEach(el => {
    const isActive = el.dataset.nav === currentPage;
    el.className = `mob-tab flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-lg ${
      isActive ? 'text-accent' : 'text-fg-faint'
    }`;
  });

  const $content = document.getElementById('content');
  if (currentPage === 'overview') renderOverview($content);
  else if (currentPage === 'accounts') renderAccounts($content);
  else if (currentPage === 'logs') renderLogs($content);
  else if (currentPage === 'settings') renderSettings($content);
}

// ── Settings actions ──
async function adjustSetting(key, delta) {
  const $val = document.getElementById('setting_' + key);
  if (!$val) return;
  let current = parseInt($val.textContent) || 1;
  let next = current + delta;
  if (next < 1) next = 1;
  $val.textContent = next;

  const $status = document.getElementById('settingsSaveStatus');

  try {
    const body = {};
    body[key] = next;
    await api('PUT', '/api/settings', body);
    if ($status) {
      $status.textContent = label(key) + ' updated to ' + next;
      $status.className = 'mt-4 text-[11px] text-emerald-600 dark:text-emerald-400';
      setTimeout(() => { $status.textContent = ''; $status.className = 'mt-4 text-[11px] text-fg-faint'; }, 2000);
    }
  } catch (e) {
    $val.textContent = current;
    if ($status) {
      $status.textContent = 'Failed to save: ' + e.message;
      $status.className = 'mt-4 text-[11px] text-red-600 dark:text-red-400';
    }
  }
}

async function saveGlobalProxy() {
  const input = document.getElementById('globalProxyInput');
  const btn = document.getElementById('saveProxyBtn');
  const $status = document.getElementById('settingsSaveStatus');
  if (!input || !btn) return;

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    await api('PUT', '/api/proxy', { proxy: input.value.trim() });
    btn.textContent = 'Save';
    btn.disabled = false;
    if ($status) {
      $status.textContent = 'Global proxy updated';
      $status.className = 'mt-4 text-[11px] text-emerald-600 dark:text-emerald-400';
      setTimeout(() => { $status.textContent = ''; $status.className = 'mt-4 text-[11px] text-fg-faint'; }, 2000);
    }
  } catch (e) {
    btn.textContent = 'Save';
    btn.disabled = false;
    if ($status) {
      $status.textContent = 'Failed to save: ' + e.message;
      $status.className = 'mt-4 text-[11px] text-red-600 dark:text-red-400';
    }
  }
}

// ── API Keys ──
async function loadApiKeys() {
  var $list = document.getElementById('apiKeysList');
  if (!$list) return;

  try {
    var data = await api('GET', '/api/apikey');
    var keys = data.keys || [];
    if (keys.length === 0) {
      $list.innerHTML = '<p class="text-[11px] text-fg-faint py-2">No API keys configured. API endpoints are open.</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      html += '<div class="flex items-center justify-between bg-surface-0 border border-border-subtle rounded-lg px-3 py-2 group">'
        + '<div class="flex items-center gap-2.5 min-w-0">'
        + '<svg class="w-3.5 h-3.5 text-fg-faint shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>'
        + '<code class="text-[11px] font-mono text-fg-muted truncate">' + esc(k.masked) + '</code>'
        + '</div>'
        + '<button onclick="deleteApiKey(\'' + escAttr(k.id) + '\')"'
        + ' class="text-[11px] text-fg-faint hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30"'
        + ' title="Delete this key">'
        + '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>'
        + '</button>'
        + '</div>';
    }
    $list.innerHTML = html;
  } catch (e) {
    $list.innerHTML = '<p class="text-[11px] text-red-500">Failed to load keys</p>';
  }
}

async function generateApiKey() {
  var btn = document.getElementById('genApiKeyBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full spin"></div> Generating...';

  try {
    var data = await api('POST', '/api/apikey');
    var newKey = data.key;

    // Show the new key banner
    var banner = document.getElementById('newKeyBanner');
    var keyEl = document.getElementById('newKeyValue');
    if (banner && keyEl) {
      keyEl.textContent = newKey;
      banner.dataset.key = newKey;
      banner.classList.remove('hidden');
    }

    btn.disabled = false;
    btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg> Generate';
    await loadApiKeys();
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg> Generate';
    var $status = document.getElementById('settingsSaveStatus');
    if ($status) {
      $status.textContent = 'Failed to generate key: ' + e.message;
      $status.className = 'mt-4 text-[11px] text-red-600 dark:text-red-400';
    }
  }
}

function copyNewKey() {
  var keyEl = document.getElementById('newKeyValue');
  var btn = document.getElementById('copyKeyBtn');
  if (!keyEl) return;
  navigator.clipboard.writeText(keyEl.textContent).then(function() {
    if (btn) { btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = 'Copy'; }, 1500); }
  });
}

function useNewKey() {
  var banner = document.getElementById('newKeyBanner');
  var key = banner ? banner.dataset.key : '';
  if (!key) return;
  apiKey = key;
  localStorage.setItem('nmpcc_api_key', apiKey);
  var $status = document.getElementById('settingsSaveStatus');
  if ($status) {
    $status.textContent = 'Key applied to your local session.';
    $status.className = 'mt-4 text-[11px] text-emerald-600 dark:text-emerald-400';
    setTimeout(function() { $status.textContent = ''; $status.className = 'mt-4 text-[11px] text-fg-faint'; }, 2000);
  }
}

async function deleteApiKey(keyId) {
  if (!confirm('Delete this API key? Clients using it will lose access.')) return;

  try {
    await api('DELETE', '/api/apikey', { key: keyId });
    await loadApiKeys();
    var $status = document.getElementById('settingsSaveStatus');
    if ($status) {
      $status.textContent = 'API key deleted.';
      $status.className = 'mt-4 text-[11px] text-emerald-600 dark:text-emerald-400';
      setTimeout(function() { $status.textContent = ''; $status.className = 'mt-4 text-[11px] text-fg-faint'; }, 2000);
    }
  } catch (e) {
    var $status = document.getElementById('settingsSaveStatus');
    if ($status) {
      $status.textContent = 'Failed to delete key: ' + e.message;
      $status.className = 'mt-4 text-[11px] text-red-600 dark:text-red-400';
    }
  }
}

// ── Account actions ──
async function fetchUsage(name) {
  const btn = document.getElementById('usageBtn');
  const $result = document.getElementById('usageResult');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Fetching...';
  $result.classList.add('hidden');

  try {
    const data = await api('GET', '/api/usage?account=' + encodeURIComponent(name));
    if (data.entries && data.entries.length > 0) {
      let html = '<div class="space-y-2.5 mt-2">';
      for (const e of data.entries) {
        const pct = e.used || 0;
        const barColor = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500';
        html += '<div class="text-[11px]">';
        html += '<div class="flex justify-between text-fg-muted mb-0.5"><span>' + esc(e.label) + '</span><span class="font-semibold text-fg tabular-nums">' + pct + '%</span></div>';
        html += '<div class="w-full bg-surface-2 rounded-full h-1.5"><div class="' + barColor + ' h-1.5 rounded-full transition-all duration-500" style="width:' + Math.min(pct, 100) + '%"></div></div>';
        if (e.resetsAt) html += '<div class="text-[10px] text-fg-faint mt-0.5 tabular-nums">' + esc(e.resetsAt) + '</div>';
        if (e.extraUsage) html += '<div class="text-[10px] text-fg-faint mt-0.5">Extra usage: ' + esc(e.extraUsage) + '</div>';
        html += '</div>';
      }
      html += '</div>';
      $result.innerHTML = html;
      $result.classList.remove('hidden');
    }
    btn.textContent = 'Fetch Usage';
    btn.disabled = false;
    // Reload to update plan usage in pool
    await loadAll(true);
    // Refresh detail modal to show updated plan usage
    await showAccountDetail(name);
  } catch (e) {
    btn.textContent = 'Failed: ' + e.message;
    setTimeout(() => { btn.textContent = 'Fetch Usage'; btn.disabled = false; }, 3000);
  }
}

async function refreshQuota(name) {
  const btn = document.getElementById('quotaRefreshBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Checking...';

  try {
    await api('POST', '/api/refresh-quota?account=' + encodeURIComponent(name));
    await loadAll(true);
    await showAccountDetail(name);
  } catch (e) {
    btn.textContent = 'Failed: ' + e.message;
    setTimeout(() => { btn.textContent = 'Refresh Quota'; btn.disabled = false; }, 2000);
  }
}

async function deleteAccount(name) {
  if (!confirm('Delete account "' + name + '"? This will remove its config directory.')) return;
  const btn = document.getElementById('deleteAccountBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Deleting...';

  try {
    await api('DELETE', '/api/accounts?account=' + encodeURIComponent(name));
    document.getElementById('detailModal').classList.add('hidden');
    await loadAll();
  } catch (e) {
    btn.textContent = 'Failed: ' + e.message;
    setTimeout(() => { btn.textContent = 'Delete Account'; btn.disabled = false; }, 2000);
  }
}

async function saveAccountProxy(name) {
  const input = document.getElementById('accProxy_' + name);
  const btn = document.getElementById('accProxySaveBtn_' + name);
  const $status = document.getElementById('accProxyStatus_' + name);
  if (!input || !btn) return;

  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    await api('PUT', '/api/accounts/proxy', { account: name, proxy: input.value.trim() });
    btn.textContent = 'Save';
    btn.disabled = false;
    if ($status) {
      $status.textContent = input.value.trim() ? 'Proxy saved' : 'Cleared, using global proxy';
      $status.className = 'mt-1 text-[10px] text-emerald-600 dark:text-emerald-400';
      setTimeout(() => { $status.textContent = ''; $status.className = 'mt-1 text-[10px] text-fg-faint'; }, 2000);
    }
    await loadAll(true);
  } catch (e) {
    btn.textContent = 'Save';
    btn.disabled = false;
    if ($status) {
      $status.textContent = 'Failed: ' + e.message;
      $status.className = 'mt-1 text-[10px] text-red-600 dark:text-red-400';
    }
  }
}

async function adjustAccountConcurrency(name, delta) {
  const $val = document.getElementById('accConc_' + name);
  if (!$val) return;
  let current = parseInt($val.textContent) || 0;
  let next = current + delta;
  if (next < 0) next = 0;
  $val.textContent = next;

  try {
    await api('PUT', '/api/accounts/concurrency', { account: name, maxConcurrency: next });
  } catch (e) {
    $val.textContent = current;
  }
}

// ── Login Modal ──
function openLoginModal() {
  document.getElementById('loginModal').classList.remove('hidden');
}

function closeLoginModal() {
  document.getElementById('loginModal').classList.add('hidden');
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', function(e) {
  // Escape to close modals
  if (e.key === 'Escape') {
    document.getElementById('detailModal').classList.add('hidden');
    closeLoginModal();
  }
  // R to refresh (when not in input)
  if (e.key === 'r' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT') {
    loadAll();
  }
});

// ── Init ──
loadAll();
