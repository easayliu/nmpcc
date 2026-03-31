import { html, render, useState, useEffect, useCallback, useRef } from './lib.js';
import { api } from './api.js';
import { formatUptime } from './utils.js';
import { Overview } from './overview.js';
import { Accounts, AccountDetail } from './accounts.js';
import { Logs } from './logs.js';
import { Settings } from './settings.js';

// ── Theme ──
function getEffectiveTheme(pref) {
  if (pref === 'system' || !pref) return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return pref;
}
function applyTheme(pref) {
  document.documentElement.classList.toggle('dark', getEffectiveTheme(pref) === 'dark');
}

// Apply theme immediately to avoid flash
applyTheme(localStorage.getItem('nmpcc_theme') || 'system');

// ── Nav Items ──
const navItems = [
  { id: 'overview', label: 'Overview', icon: html`<svg class="w-4 h-4 shrink-0 opacity-60" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 12a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z"/></svg>` },
  { id: 'accounts', label: 'Accounts', icon: html`<svg class="w-4 h-4 shrink-0 opacity-60" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>` },
  { id: 'logs', label: 'Logs', icon: html`<svg class="w-4 h-4 shrink-0 opacity-60" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>` },
  { id: 'settings', label: 'Settings', icon: html`<svg class="w-4 h-4 shrink-0 opacity-60" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z"/><circle cx="12" cy="12" r="3"/></svg>` },
];

// Mobile tab icons (slightly larger)
const mobileNavItems = [
  { id: 'overview', label: 'Overview', icon: html`<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 12a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z"/></svg>` },
  { id: 'accounts', label: 'Accounts', icon: html`<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>` },
  { id: 'logs', label: 'Logs', icon: html`<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>` },
  { id: 'settings', label: 'Settings', icon: html`<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z"/><circle cx="12" cy="12" r="3"/></svg>` },
];

// ── Header ──
function Header({ theme, onToggleTheme, onRefresh, connected, refreshing }) {
  const themeIcon = (() => {
    if (theme === 'system' || !theme) return html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
    if (getEffectiveTheme(theme) === 'dark') return html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
    return html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
  })();

  return html`
    <header class="min-h-[48px] border-b border-border flex items-center justify-between px-4 shrink-0 bg-surface-0 safe-area-pt">
      <div class="flex items-center gap-3">
        <div class="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-[11px] font-bold text-white tracking-tight shadow-sm">N</div>
        <div class="flex items-baseline gap-1.5">
          <span class="text-[14px] font-semibold tracking-tight">nmpcc</span>
          <span class="text-[10px] text-fg-faint font-medium tracking-wide uppercase">proxy</span>
        </div>
      </div>
      <div class="flex items-center gap-2.5">
        <button onclick=${onToggleTheme} title="Toggle theme"
          class="w-7 h-7 rounded-lg border border-border-subtle flex items-center justify-center text-fg-faint hover:text-fg hover:border-border transition-colors">
          ${themeIcon}
        </button>
        <button onclick=${onRefresh} title="Refresh"
          class="w-7 h-7 rounded-lg border border-border-subtle flex items-center justify-center text-fg-faint hover:text-fg hover:border-border transition-colors">
          <svg class="w-3.5 h-3.5 ${refreshing ? 'spin' : ''}" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M4.93 9a9 9 0 0115.04-1.36L20 9M19.07 15a9 9 0 01-15.04 1.36L4 15"/>
          </svg>
        </button>
        <div class="w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 pulse-dot' : 'bg-fg-faint/40'}" title="Connection status"></div>
      </div>
    </header>`;
}

// ── Sidebar ──
function Sidebar({ page, onNavigate, accountCount, dashboard }) {
  return html`
    <aside class="sidebar w-52 border-r border-border flex flex-col shrink-0 bg-surface-0">
      <nav class="flex-1 py-3 px-2.5 space-y-0.5">
        ${navItems.map(item => html`
          <button key=${item.id} onclick=${() => onNavigate(item.id)}
            class="w-full text-left px-3 py-2 rounded-lg text-[12px] flex items-center gap-2.5 transition-colors font-medium ${
              page === item.id ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg hover:bg-surface-1'}">
            ${item.icon}
            ${item.label}
            ${item.id === 'accounts' && accountCount > 0 && html`
              <span class="ml-auto text-[10px] bg-surface-2 text-fg-faint px-1.5 py-0.5 rounded-md font-semibold tabular-nums">${accountCount}</span>`}
          </button>`)}
      </nav>
      <div class="border-t border-border px-3 py-2.5">
        <div class="flex items-center justify-between">
          <p class="text-[10px] text-fg-faint tracking-wide uppercase">Claude CLI Proxy</p>
          <span class="text-[10px] text-fg-faint tabular-nums">${dashboard ? formatUptime(dashboard.uptime_seconds) : ''}</span>
        </div>
      </div>
    </aside>`;
}

// ── Mobile Tab Bar ──
function MobileTabBar({ page, onNavigate }) {
  return html`
    <nav id="mobileTabBar" class="fixed bottom-0 left-0 right-0 h-14 bg-surface-0 border-t border-border flex items-center justify-around z-30 safe-area-pb">
      ${mobileNavItems.map(item => html`
        <button key=${item.id} onclick=${() => onNavigate(item.id)}
          class="flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-lg ${page === item.id ? 'text-accent' : 'text-fg-faint'}">
          ${item.icon}
          <span class="text-[10px] font-medium">${item.label}</span>
        </button>`)}
    </nav>`;
}

// ── Login Modal ──
function LoginModal({ show, onClose, onRefresh }) {
  if (!show) return null;
  return html`
    <div class="fixed inset-0 bg-black/30 dark:bg-black/50 modal-backdrop flex items-center justify-center z-50"
         onclick=${e => e.target === e.currentTarget && onClose()}>
      <div class="bg-surface-0 border border-border rounded-2xl w-full max-w-md mx-4 shadow-xl">
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 class="text-[13px] font-semibold">Add Account</h3>
          <button onclick=${onClose} class="text-fg-faint hover:text-fg transition-colors p-1 -mr-1 rounded-md hover:bg-surface-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="px-5 py-4 space-y-3">
          <div class="text-[12px] text-fg-muted leading-relaxed">Run the following command on the server to add an account:</div>
          <div class="bg-surface-1 border border-border-subtle rounded-lg p-3 font-mono text-[11px] text-fg select-all leading-relaxed">CLAUDE_CONFIG_DIR=/accounts/<span class="text-accent">NAME</span> claude auth login</div>
          <div class="text-[11px] text-fg-faint leading-relaxed">Replace <span class="font-mono text-accent">NAME</span> with the account name. The account will be auto-discovered after login.</div>
          <button onclick=${() => { onClose(); onRefresh(); }}
            class="w-full text-[12px] border border-border text-fg-muted hover:text-fg py-2 rounded-lg transition-colors font-medium hover:bg-surface-1">Done</button>
        </div>
      </div>
    </div>`;
}

// ── Pull to Refresh Hook ──
function usePullToRefresh(contentRef, onRefresh) {
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let startY = 0, pulling = false, pullDist = 0;
    const threshold = 60;
    const indicator = el.querySelector('.pull-indicator');
    if (!indicator) return;

    const onStart = (e) => {
      if (el.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      pulling = true; pullDist = 0;
      indicator.classList.add('pulling');
      indicator.classList.remove('ready', 'refreshing');
    };
    const onMove = (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy < 0) { pullDist = 0; indicator.style.height = '0'; return; }
      pullDist = Math.min(dy * 0.5, 80);
      indicator.style.height = pullDist + 'px';
      indicator.classList.toggle('ready', pullDist >= threshold);
    };
    const onEnd = () => {
      if (!pulling) return;
      pulling = false;
      indicator.classList.remove('pulling');
      if (pullDist >= threshold) {
        indicator.classList.remove('ready');
        indicator.classList.add('refreshing');
        indicator.style.height = '40px';
        onRefresh().then(() => { indicator.classList.remove('refreshing'); indicator.style.height = '0'; });
      } else { indicator.style.height = '0'; }
      pullDist = 0;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [contentRef, onRefresh]);
}

// ── App ──
function App() {
  const [page, setPage] = useState(location.hash.slice(1) || 'overview');
  const [dashboard, setDashboard] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(0);
  const [connected, setConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('nmpcc_theme') || 'system');
  const [detailName, setDetailName] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const contentRef = useRef(null);

  const loadAll = useCallback(async (silent) => {
    if (!silent) setRefreshing(true);
    try {
      const [dash, status] = await Promise.all([
        api('GET', '/api/dashboard'),
        api('GET', '/status'),
      ]);
      setDashboard(dash.error ? null : dash);
      setAccounts(status.accounts || []);
      setLastRefresh(Date.now());
      setConnected(true);
    } catch { setConnected(false); }
    if (!silent) setRefreshing(false);
  }, []);

  // Initial load
  useEffect(() => { loadAll(); }, [loadAll]);

  // Hash navigation
  const navigate = useCallback((p) => { setPage(p); location.hash = p; }, []);
  useEffect(() => {
    const handler = () => { const p = location.hash.slice(1); if (p) setPage(p); };
    addEventListener('hashchange', handler);
    return () => removeEventListener('hashchange', handler);
  }, []);

  // Theme
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (theme === 'system') applyTheme('system'); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(theme) + 1) % 3];
    setTheme(next);
    localStorage.setItem('nmpcc_theme', next);
  }, [theme]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') { setDetailName(null); setShowLogin(false); }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') loadAll();
    };
    addEventListener('keydown', handler);
    return () => removeEventListener('keydown', handler);
  }, [loadAll]);

  // Pull to refresh
  usePullToRefresh(contentRef, loadAll);

  const openLogin = useCallback(() => setShowLogin(true), []);

  const currentPage = (() => {
    switch (page) {
      case 'overview': return html`<${Overview} dashboard=${dashboard} accounts=${accounts} lastRefresh=${lastRefresh} onShowDetail=${setDetailName} onNavigate=${navigate} onShowLogin=${openLogin} />`;
      case 'accounts': return html`<${Accounts} accounts=${accounts} onShowDetail=${setDetailName} onShowLogin=${openLogin} />`;
      case 'logs': return html`<${Logs} accounts=${accounts} />`;
      case 'settings': return html`<${Settings} onRefresh=${loadAll} />`;
      default: return null;
    }
  })();

  return html`
    <${Header} theme=${theme} onToggleTheme=${toggleTheme} onRefresh=${() => loadAll()} connected=${connected} refreshing=${refreshing} />
    <div class="flex flex-1 overflow-hidden">
      <${Sidebar} page=${page} onNavigate=${navigate} accountCount=${accounts.length} dashboard=${dashboard} />
      <main ref=${contentRef} class="flex-1 overflow-y-auto bg-surface-0 relative">
        <div class="pull-indicator" id="pullIndicator">
          <div class="pull-icon text-fg-faint">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3"/>
            </svg>
          </div>
        </div>
        ${currentPage}
      </main>
    </div>
    <${MobileTabBar} page=${page} onNavigate=${navigate} />
    <${LoginModal} show=${showLogin} onClose=${() => setShowLogin(false)} onRefresh=${loadAll} />
    ${detailName && html`<${AccountDetail} name=${detailName} accounts=${accounts} onClose=${() => setDetailName(null)} onRefresh=${loadAll} />`}
  `;
}

// ── Mount ──
render(html`<${App} />`, document.getElementById('app'));
