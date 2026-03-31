import { html } from './lib.js';
import { formatUptime, formatTokens, formatResetTime, hashCode, formatPlanName } from './utils.js';
import { timeAgo } from './utils.js';
import { StatCard, UsageBar, MiniUsageBar, PlanBadge, Avatar, EmptyState, UpArrowIcon, ChartIcon, HeartIcon, BoltIcon, DollarIcon } from './components.js';

// ── Overview Table Row (Desktop) ──
function OverviewRow({ acc, onShowDetail }) {
  const pu = acc.planUsage;
  const rl = acc.rateLimit;
  const dotClass = acc.healthy ? (acc.active === 0 ? 'bg-emerald-500 pulse-dot' : 'bg-emerald-500') : 'bg-red-500';
  const textClass = acc.healthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  const statusText = acc.healthy ? (acc.active > 0 ? acc.active + ' active' : 'Idle') : 'Down';

  const resetInfo = rl?.resetsAt
    ? `${formatResetTime(rl.resetsAt)} (${new Date(rl.resetsAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
    : pu?.sessionResets || '';
  const weeklyReset = pu?.weeklyResets || '';

  const profile = acc.profile;

  return html`
    <tr class="border-b border-border-subtle last:border-0 table-row-hover transition-colors cursor-pointer" onclick=${() => onShowDetail(acc.name)}>
      <td class="px-4 py-2.5">
        <div class="flex items-center gap-2.5">
          <${Avatar} name=${acc.name} size="sm" />
          <div>
            <div class="flex items-center gap-1.5">
              <span class="font-semibold text-fg">${acc.name}</span>
              <${PlanBadge} profile=${profile} size="sm" />
            </div>
            ${profile?.emailAddress && html`<div class="text-[10px] text-fg-faint">${profile.emailAddress}</div>`}
          </div>
        </div>
      </td>
      <td class="px-4 py-2.5">
        <span class="inline-flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full ${dotClass}"></span>
          <span class="font-medium ${textClass}">${statusText}</span>
          ${rl?.status === 'limited' && html`<span class="ml-1 text-[10px] text-red-500 bg-red-50 dark:bg-red-950/30 px-1 py-0.5 rounded font-medium">LIMITED</span>`}
        </span>
      </td>
      <td class="px-4 py-2.5">
        ${profile ? html`
          <div>
            ${profile.subscriptionCreatedAt && html`<div class="text-[10px] text-fg-muted">Since ${new Date(profile.subscriptionCreatedAt).toLocaleDateString()}</div>`}
            ${profile.tokenExpiresAt && html`<div class="text-[10px] ${new Date(profile.tokenExpiresAt) < new Date() ? 'text-red-500' : 'text-fg-faint'}">Token ${new Date(profile.tokenExpiresAt) < new Date() ? 'expired' : 'expires'} ${new Date(profile.tokenExpiresAt).toLocaleDateString()}</div>`}
          </div>
        ` : html`<span class="text-fg-faint">--</span>`}
      </td>
      <td class="px-4 py-2.5">
        ${pu?.updatedAt ? html`<div><${UsageBar} pct=${pu.sessionUsed} />${resetInfo && html`<div class="text-[10px] text-fg-faint mt-0.5 tabular-nums">${resetInfo}</div>`}</div>` : html`<span class="text-fg-faint">--</span>`}
      </td>
      <td class="px-4 py-2.5">
        ${pu?.updatedAt ? html`<div><${UsageBar} pct=${pu.weeklyUsed} />${weeklyReset && html`<div class="text-[10px] text-fg-faint mt-0.5 tabular-nums">${weeklyReset}</div>`}</div>` : html`<span class="text-fg-faint">--</span>`}
      </td>
      <td class="px-4 py-2.5 text-right text-fg-muted tabular-nums font-medium text-[11px]">${acc.usage ? '$' + acc.usage.totalCostUsd.toFixed(4) : '--'}</td>
      <td class="px-4 py-2.5 text-right tabular-nums font-medium text-[11px]">${acc.requestCount}</td>
    </tr>`;
}

// ── Overview Mobile Card ──
function OverviewCard({ acc, onShowDetail }) {
  const pu = acc.planUsage;
  const dotClass = acc.healthy ? (acc.active === 0 ? 'bg-emerald-500 pulse-dot' : 'bg-emerald-500') : 'bg-red-500';
  const textClass = acc.healthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  const statusText = acc.healthy ? (acc.active > 0 ? acc.active + ' active' : 'Idle') : 'Down';

  return html`
    <div class="bg-surface-1 border border-border rounded-xl p-3 cursor-pointer" onclick=${() => onShowDetail(acc.name)}>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2.5 min-w-0">
          <${Avatar} name=${acc.name} />
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[12px] font-semibold text-fg truncate">${acc.name}</span>
              <${PlanBadge} profile=${acc.profile} size="sm" />
            </div>
            <div class="text-[10px] text-fg-faint">${acc.requestCount} reqs${acc.usage ? html` · $${acc.usage.totalCostUsd.toFixed(4)}` : ''}</div>
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <span class="w-1.5 h-1.5 rounded-full ${dotClass}"></span>
          <span class="text-[10px] font-medium ${textClass}">${statusText}</span>
          ${acc.rateLimit?.status === 'limited' && html`<span class="text-[9px] text-red-500 bg-red-50 dark:bg-red-950/30 px-1 py-0.5 rounded font-medium">LIMITED</span>`}
        </div>
      </div>
      ${pu?.updatedAt && html`
        <div class="flex items-center gap-3 mt-2 pt-2 border-t border-border-subtle">
          <${MiniUsageBar} label="5h" pct=${pu.sessionUsed} />
          <${MiniUsageBar} label="Wk" pct=${pu.weeklyUsed} />
        </div>`}
    </div>`;
}

// ── Overview Page ──
export function Overview({ dashboard: d, accounts, lastRefresh, onShowDetail, onNavigate, onShowLogin }) {
  const healthPct = d?.total_accounts > 0 ? Math.round((d.healthy_accounts / d.total_accounts) * 100) : 0;
  const healthColor = healthPct >= 80 ? 'emerald' : healthPct >= 50 ? 'amber' : 'red';
  let totalCost = 0, totalActive = 0;
  accounts.forEach(a => { if (a.usage) totalCost += a.usage.totalCostUsd; totalActive += a.active || 0; });

  const addFirst = () => { onNavigate('accounts'); onShowLogin(); };
  const emptyIcon = html`<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>`;

  const headers = ['Account', 'Status', 'Subscription', '5h', 'Weekly', 'Cost', 'Reqs'];

  return html`
    <div class="p-4 sm:p-6 lg:p-8 page-enter">
      <div class="mb-6">
        <h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Overview</h1>
        <p class="text-[12px] text-fg-faint mt-1.5 font-medium">
          Service status and metrics${lastRefresh ? html` <span class="text-fg-faint/60">· updated ${timeAgo(lastRefresh)}</span>` : ''}
        </p>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 stagger mb-6">
        <${StatCard} label="Uptime" value=${d ? formatUptime(d.uptime_seconds) : '--'} icon=${html`<${UpArrowIcon}/>`} />
        <${StatCard} label="Requests" value=${d ? d.total_requests.toLocaleString() : '--'} icon=${html`<${ChartIcon}/>`} />
        <${StatCard} label="Healthy" value=${d ? html`${d.healthy_accounts}<span class="text-fg-faint font-normal text-[14px] tabular-nums">/${d.total_accounts}</span>` : '--'} icon=${html`<${HeartIcon}/>`} accentColor=${healthColor} />
        <${StatCard} label="Active" value=${totalActive} icon=${html`<${BoltIcon}/>`} />
        <${StatCard} label="Cost" value=${totalCost > 0 ? '$' + totalCost.toFixed(2) : '--'} icon=${html`<${DollarIcon}/>`} />
      </div>

      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-[12px] font-semibold text-fg-muted uppercase tracking-wider">Accounts</h2>
          <div class="flex items-center gap-3">
            <span class="text-[11px] text-fg-faint tabular-nums">${accounts.length} total</span>
            <button onclick=${addFirst} class="text-[11px] text-accent hover:underline underline-offset-2 font-medium">+ Add</button>
          </div>
        </div>

        ${accounts.length === 0
          ? html`<${EmptyState} icon=${emptyIcon} title="No accounts yet" action="Add your first account" onAction=${addFirst} />`
          : html`
            <div class="hidden lg:block border border-border rounded-xl overflow-hidden bg-surface-0 overflow-x-auto">
              <table class="w-full text-[11px]">
                <thead><tr class="border-b border-border text-fg-faint bg-surface-1">
                  ${headers.map((h, i) => html`<th key=${h} class="${i >= 5 ? 'text-right' : 'text-left'} font-semibold px-4 py-2.5 uppercase tracking-wider text-[10px]">${h}</th>`)}
                </tr></thead>
                <tbody class="stagger">${accounts.map(a => html`<${OverviewRow} key=${a.name} acc=${a} onShowDetail=${onShowDetail} />`)}</tbody>
              </table>
            </div>
            <div class="lg:hidden space-y-2 stagger">${accounts.map(a => html`<${OverviewCard} key=${a.name} acc=${a} onShowDetail=${onShowDetail} />`)}</div>
          `}
      </div>
    </div>`;
}
