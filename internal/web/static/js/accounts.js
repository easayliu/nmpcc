import { html, useState, useCallback } from './lib.js';
import { formatTokens, formatPlanName, formatResetTime } from './utils.js';
import { api } from './api.js';
import { Avatar, PlanBadge, MiniUsageBar, UsageBarFull, DetailRow, DetailRowCompact, EmptyState } from './components.js';

// ── Account Card ──
function AccountCard({ acc, onShowDetail }) {
  const rl = acc.rateLimit;
  const pu = acc.planUsage;
  const statusText = acc.healthy ? (acc.active > 0 ? acc.active + ' active' : 'Idle') : 'Unhealthy';
  const statusColor = acc.healthy ? 'emerald' : 'red';

  const isLimited = rl?.status === 'limited';
  const quotaBadge = rl
    ? isLimited
      ? html`<span class="text-[10px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 px-2 py-0.5 rounded-md font-medium">Limited ${formatResetTime(rl.resetsAt)}</span>`
      : html`<span class="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 px-2 py-0.5 rounded-md font-medium">Available</span>`
    : null;

  const fiveHourReset = rl?.resetsAt
    ? `${formatResetTime(rl.resetsAt)} (${new Date(rl.resetsAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
    : pu?.sessionResets || '';

  return html`
    <div class="bg-surface-1 border border-border rounded-xl px-3 sm:px-4 py-3 sm:py-3.5 card-lift cursor-pointer group" onclick=${() => onShowDetail(acc.name)}>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
          <${Avatar} name=${acc.name} size="lg" />
          <div class="min-w-0">
            <p class="text-[12px] sm:text-[13px] font-semibold text-fg truncate">
              ${acc.name}
              ${acc.profile?.displayName && html` <span class="text-fg-faint font-normal hidden sm:inline">(${acc.profile.displayName})</span>`}
              <${PlanBadge} profile=${acc.profile} />
            </p>
            ${acc.profile?.emailAddress && html`<p class="text-[10px] text-fg-faint font-medium truncate hidden sm:block">${acc.profile.emailAddress}</p>`}
            <p class="text-[10px] sm:text-[11px] text-fg-faint tabular-nums font-medium">
              ${acc.requestCount} req${acc.requestCount !== 1 ? 's' : ''}${acc.usage ? html` · $${acc.usage.totalCostUsd.toFixed(4)}` : ''}${acc.proxy ? html` · <span class="text-blue-500" title=${acc.proxy}>proxy</span>` : ''}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 sm:gap-3 shrink-0">
          <span class="hidden sm:inline">${quotaBadge}</span>
          <span class="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-medium">
            <span class="w-1.5 h-1.5 rounded-full bg-${statusColor}-500 ${acc.healthy && acc.active === 0 ? 'pulse-dot' : ''}"></span>
            <span class="text-${statusColor}-600 dark:text-${statusColor}-400">${statusText}</span>
          </span>
          <svg class="w-4 h-4 text-fg-faint/40 group-hover:text-fg-faint transition-colors hidden sm:block" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
        </div>
      </div>
      ${pu?.updatedAt && html`
        <div class="flex items-center gap-3 sm:gap-4 mt-2 pt-2 border-t border-border-subtle">
          <${MiniUsageBar} label="5h" pct=${pu.sessionUsed} resetText=${fiveHourReset} />
          <${MiniUsageBar} label="Wk" pct=${pu.weeklyUsed} resetText=${pu.weeklyResets || ''} />
          <span class="hidden sm:contents"><${MiniUsageBar} label="Sonnet" pct=${pu.sonnetUsed} resetText=${pu.sonnetResets || ''} /></span>
        </div>`}
    </div>`;
}

// ── Accounts Page ──
export function Accounts({ accounts, onShowDetail, onShowLogin }) {
  const healthy = accounts.filter(a => a.healthy);
  const unhealthy = accounts.filter(a => !a.healthy);
  const emptyIcon = html`<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>`;

  return html`
    <div class="p-4 sm:p-6 lg:p-8 page-enter">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Accounts</h1>
          <p class="text-[12px] text-fg-faint mt-1.5 font-medium">${accounts.length} account${accounts.length !== 1 ? 's' : ''} configured</p>
        </div>
        <button onclick=${onShowLogin}
          class="text-[12px] bg-accent text-white hover:opacity-90 px-4 py-2 rounded-lg font-semibold transition-opacity shadow-sm flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
          Add Account
        </button>
      </div>
      ${accounts.length === 0
        ? html`<${EmptyState} icon=${emptyIcon} title="No accounts configured" action="Add your first account" onAction=${onShowLogin} />`
        : html`
          <div class="space-y-2 stagger">${healthy.map(a => html`<${AccountCard} key=${a.name} acc=${a} onShowDetail=${onShowDetail} />`)}</div>
          ${unhealthy.length > 0 && html`
            <div class="mt-4">
              <p class="text-[10px] text-red-500 uppercase tracking-wider font-semibold mb-2">Unhealthy</p>
              <div class="space-y-2">${unhealthy.map(a => html`<${AccountCard} key=${a.name} acc=${a} onShowDetail=${onShowDetail} />`)}</div>
            </div>`}
        `}
    </div>`;
}

// ── Account Detail Modal ──
export function AccountDetail({ name, accounts, onClose, onRefresh }) {
  const acc = accounts.find(a => a.name === name);
  const [usageLoading, setUsageLoading] = useState(false);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [usageResult, setUsageResult] = useState(null);
  const [proxyValue, setProxyValue] = useState(acc?.proxy || '');
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyStatus, setProxyStatus] = useState('');
  const [concurrency, setConcurrency] = useState(acc?.maxConcurrency || 0);
  const [statusMsg, setStatusMsg] = useState('');

  if (!acc) return html`
    <div class="fixed inset-0 bg-black/30 dark:bg-black/50 modal-backdrop flex items-end sm:items-center justify-center z-50" onclick=${e => e.target === e.currentTarget && onClose()}>
      <div class="bg-surface-0 border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-md sm:mx-4 shadow-xl p-5">
        <p class="text-fg-muted text-[12px]">Account not found.</p>
      </div>
    </div>`;

  const rl = acc.rateLimit;
  const usage = acc.usage;
  const pu = acc.planUsage;
  const profile = acc.profile;

  const fiveHourReset = rl?.resetsAt
    ? `${formatResetTime(rl.resetsAt)} (${new Date(rl.resetsAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
    : pu?.sessionResets || '';

  const fetchUsage = async () => {
    setUsageLoading(true);
    try {
      const data = await api('GET', '/api/usage?account=' + encodeURIComponent(name));
      setUsageResult(data.entries || []);
      await onRefresh(true);
    } catch (e) { setStatusMsg('Failed: ' + e.message); }
    setUsageLoading(false);
  };

  const refreshQuota = async () => {
    setQuotaLoading(true);
    try {
      await api('POST', '/api/refresh-quota?account=' + encodeURIComponent(name));
      await onRefresh(true);
    } catch (e) { setStatusMsg('Failed: ' + e.message); }
    setQuotaLoading(false);
  };

  const deleteAccount = async () => {
    if (!confirm(`Delete account "${name}"? This will remove its config directory.`)) return;
    setDeleteLoading(true);
    try {
      await api('DELETE', '/api/accounts?account=' + encodeURIComponent(name));
      onClose();
      await onRefresh();
    } catch (e) { setStatusMsg('Failed: ' + e.message); setDeleteLoading(false); }
  };

  const saveProxy = async () => {
    setProxySaving(true);
    try {
      await api('PUT', '/api/accounts/proxy', { account: name, proxy: proxyValue.trim() });
      setProxyStatus(proxyValue.trim() ? 'Proxy saved' : 'Cleared, using global proxy');
      await onRefresh(true);
      setTimeout(() => setProxyStatus(''), 2000);
    } catch (e) { setProxyStatus('Failed: ' + e.message); }
    setProxySaving(false);
  };

  const adjustConcurrency = async (delta) => {
    const next = Math.max(0, concurrency + delta);
    setConcurrency(next);
    try { await api('PUT', '/api/accounts/concurrency', { account: name, maxConcurrency: next }); }
    catch { setConcurrency(concurrency); }
  };

  return html`
    <div class="fixed inset-0 bg-black/30 dark:bg-black/50 modal-backdrop flex items-end sm:items-center justify-center z-50"
         onclick=${e => e.target === e.currentTarget && onClose()}>
      <div class="bg-surface-0 border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-md sm:mx-4 shadow-xl max-h-[90vh] sm:max-h-[85vh] flex flex-col safe-area-pb">
        <div class="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <h3 class="text-[13px] font-semibold">${name}</h3>
          <button onclick=${onClose} class="text-fg-faint hover:text-fg transition-colors p-1 -mr-1 rounded-md hover:bg-surface-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="px-5 py-4 text-[12px] space-y-2 overflow-y-auto">
          <div class="space-y-1 fade-in">
            <${DetailRow} label="Status">${acc.healthy
              ? html`<span class="text-emerald-600 dark:text-emerald-400 font-medium">Healthy</span>`
              : html`<span class="text-red-600 dark:text-red-400 font-medium">Unhealthy</span>`}</${DetailRow}>
            <${DetailRow} label="Requests">${acc.requestCount || 0}</${DetailRow}>
          </div>

          <!-- Concurrency -->
          <div class="mt-3 pt-3 border-t border-border">
            <div class="flex items-center justify-between">
              <div><p class="text-[11px] text-fg-muted font-medium">Max Concurrency</p><p class="text-[10px] text-fg-faint">0 = global default</p></div>
              <div class="flex items-center gap-2">
                <button onclick=${() => adjustConcurrency(-1)} class="w-6 h-6 rounded-md border border-border flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-2 text-[12px] font-medium">-</button>
                <span class="text-[12px] font-semibold tabular-nums w-6 text-center">${concurrency}</span>
                <button onclick=${() => adjustConcurrency(1)} class="w-6 h-6 rounded-md border border-border flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-2 text-[12px] font-medium">+</button>
              </div>
            </div>
          </div>

          <!-- Proxy -->
          <div class="mt-3 pt-3 border-t border-border">
            <div class="mb-2"><p class="text-[11px] text-fg-muted font-medium">Proxy</p><p class="text-[10px] text-fg-faint">Leave empty to use global proxy</p></div>
            <div class="flex items-center gap-2">
              <input type="text" value=${proxyValue} onInput=${e => setProxyValue(e.target.value)} placeholder="socks5://... or http://..."
                class="flex-1 text-[11px] bg-surface-0 border border-border-subtle rounded-lg px-2.5 py-1.5 text-fg font-mono focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/10 placeholder-fg-faint transition-all" />
              <button onclick=${saveProxy} disabled=${proxySaving}
                class="text-[11px] border border-border text-fg-muted hover:text-fg hover:bg-surface-2 px-2.5 py-1.5 rounded-lg font-medium transition-colors shrink-0">
                ${proxySaving ? 'Saving...' : 'Save'}
              </button>
            </div>
            ${proxyStatus && html`<div class="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400">${proxyStatus}</div>`}
          </div>

          <!-- Profile -->
          ${profile && html`
            <div class="mt-3 pt-3 border-t border-border space-y-1">
              <p class="text-[10px] text-fg-faint uppercase tracking-wider font-semibold mb-2">Account Info</p>
              ${profile.displayName && html`<${DetailRow} label="Name">${profile.displayName}</${DetailRow}>`}
              ${profile.emailAddress && html`<${DetailRow} label="Email">${profile.emailAddress}</${DetailRow}>`}
              ${formatPlanName(profile) && html`<${DetailRow} label="Subscription"><${PlanBadge} profile=${profile} /></${DetailRow}>`}
              ${profile.rateLimitTier && html`<${DetailRow} label="Rate Limit Tier">${profile.rateLimitTier}</${DetailRow}>`}
              ${profile.organizationName && html`<${DetailRow} label="Organization">${profile.organizationName}${profile.organizationRole ? html` <span class="text-fg-faint">(${profile.organizationRole})</span>` : ''}</${DetailRow}>`}
              ${profile.accountCreatedAt && html`<${DetailRow} label="Account Created">${new Date(profile.accountCreatedAt).toLocaleDateString()}</${DetailRow}>`}
              ${profile.subscriptionCreatedAt && html`<${DetailRow} label="Subscribed Since">${new Date(profile.subscriptionCreatedAt).toLocaleDateString()}</${DetailRow}>`}
              ${profile.tokenExpiresAt && html`<${DetailRow} label="Token Expires">${(() => {
                const exp = new Date(profile.tokenExpiresAt);
                const isExpired = exp < new Date();
                return isExpired
                  ? html`<span class="text-red-500 font-medium">Expired ${exp.toLocaleString()}</span>`
                  : html`<span class="text-emerald-600 dark:text-emerald-400">${exp.toLocaleString()}</span>`;
              })()}</${DetailRow}>`}
            </div>`}

          <!-- Plan Usage -->
          ${pu?.updatedAt && html`
            <div class="mt-3 pt-3 border-t border-border">
              <p class="text-[10px] text-fg-faint uppercase tracking-wider font-semibold mb-3">Plan Usage</p>
              <div class="space-y-3">
                <${UsageBarFull} label="5-hour usage" pct=${pu.sessionUsed} resets=${fiveHourReset || pu.sessionResets} />
                <${UsageBarFull} label="Weekly (all models)" pct=${pu.weeklyUsed} resets=${pu.weeklyResets} />
                <${UsageBarFull} label="Weekly (Sonnet)" pct=${pu.sonnetUsed} resets=${pu.sonnetResets} />
                ${pu.extraUsage && html`<div class="flex items-center justify-between text-[11px]"><span class="text-fg-muted">Extra usage</span><span class="text-fg font-medium">${pu.extraUsage}</span></div>`}
              </div>
            </div>`}

          <!-- Rate Limit -->
          ${rl && html`
            <div class="mt-3 pt-3 border-t border-border space-y-1">
              <p class="text-[10px] text-fg-faint uppercase tracking-wider font-semibold mb-2">Rate Limit</p>
              <${DetailRow} label="Status">${rl.status === 'limited'
                ? html`<span class="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 px-2 py-0.5 rounded-md text-[11px] font-medium">Limited</span>`
                : html`<span class="text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 px-2 py-0.5 rounded-md text-[11px] font-medium">Available</span>`}</${DetailRow}>
              <${DetailRow} label="Type">${rl.rateLimitType || 'five_hour'}</${DetailRow}>
              ${rl.resetsAt && html`<${DetailRow} label="Resets">${formatResetTime(rl.resetsAt)} <span class="text-fg-faint">(${new Date(rl.resetsAt * 1000).toLocaleTimeString()})</span></${DetailRow}>`}
              ${rl.updatedAt && html`<${DetailRow} label="Last Check">${new Date(rl.updatedAt * 1000).toLocaleTimeString()}</${DetailRow}>`}
            </div>`}

          <!-- Token Usage -->
          ${usage && html`
            <div class="mt-3 pt-3 border-t border-border space-y-1">
              <p class="text-[10px] text-fg-faint uppercase tracking-wider font-semibold mb-2">Token Usage</p>
              <div class="grid grid-cols-2 gap-x-4 gap-y-1">
                <${DetailRowCompact} label="Input">${formatTokens(usage.inputTokens)}</${DetailRowCompact}>
                <${DetailRowCompact} label="Output">${formatTokens(usage.outputTokens)}</${DetailRowCompact}>
                <${DetailRowCompact} label="Cache Read">${formatTokens(usage.cacheReadInputTokens)}</${DetailRowCompact}>
                <${DetailRowCompact} label="Cache 1h">${formatTokens(usage.cacheCreation1h || 0)}</${DetailRowCompact}>
                <${DetailRowCompact} label="Cache 5m">${formatTokens(usage.cacheCreation5m || 0)}</${DetailRowCompact}>
              </div>
              <div class="flex items-center justify-between py-2 mt-1 border-t border-border-subtle">
                <span class="text-fg-muted font-medium">Total Cost</span>
                <span class="font-semibold text-accent">$${usage.totalCostUsd.toFixed(4)}</span>
              </div>
            </div>`}

          <!-- Usage Result -->
          ${usageResult?.length > 0 && html`
            <div class="space-y-2.5 mt-2">
              ${usageResult.map(e => {
                const barColor = e.used > 80 ? 'bg-red-500' : e.used > 50 ? 'bg-amber-500' : 'bg-emerald-500';
                return html`
                  <div class="text-[11px]">
                    <div class="flex justify-between text-fg-muted mb-0.5"><span>${e.label}</span><span class="font-semibold text-fg tabular-nums">${e.used || 0}%</span></div>
                    <div class="w-full bg-surface-2 rounded-full h-1.5"><div class="${barColor} h-1.5 rounded-full transition-all duration-500" style="width:${Math.min(e.used || 0, 100)}%"></div></div>
                    ${e.resetsAt && html`<div class="text-[10px] text-fg-faint mt-0.5 tabular-nums">${e.resetsAt}</div>`}
                    ${e.extraUsage && html`<div class="text-[10px] text-fg-faint mt-0.5">Extra usage: ${e.extraUsage}</div>`}
                  </div>`;
              })}
            </div>`}

          <!-- Actions -->
          <div class="mt-3 pt-3 border-t border-border space-y-2">
            <div class="grid grid-cols-2 gap-2">
              <button onclick=${fetchUsage} disabled=${usageLoading}
                class="text-[11px] border border-border text-fg-muted hover:text-fg py-2 rounded-lg transition-colors font-medium hover:bg-surface-1">
                ${usageLoading ? 'Fetching...' : 'Fetch Usage'}
              </button>
              <button onclick=${refreshQuota} disabled=${quotaLoading}
                class="text-[11px] border border-border text-fg-muted hover:text-fg py-2 rounded-lg transition-colors font-medium hover:bg-surface-1">
                ${quotaLoading ? 'Checking...' : 'Refresh Quota'}
              </button>
            </div>
            ${statusMsg && html`<div class="text-[11px] text-red-500">${statusMsg}</div>`}
            <button onclick=${deleteAccount} disabled=${deleteLoading}
              class="w-full text-[11px] border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 py-2 rounded-lg transition-colors font-medium">
              ${deleteLoading ? 'Deleting...' : 'Delete Account'}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}
