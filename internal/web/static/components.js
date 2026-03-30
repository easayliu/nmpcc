// ── Reusable UI Components ──

function statCard(label, value, icon, accentColor) {
  const ring = accentColor
    ? `border-${accentColor}-200 dark:border-${accentColor}-900/40`
    : 'border-border';
  return `
    <div class="bg-surface-1 border ${ring} rounded-xl px-3 sm:px-4 py-3 sm:py-3.5 card-lift">
      <div class="flex items-center justify-between mb-2">
        <p class="text-[10px] text-fg-faint uppercase tracking-wider font-semibold">${label}</p>
        <span class="text-fg-faint/50 hidden sm:inline">${icon}</span>
      </div>
      <p class="text-[16px] sm:text-[20px] font-semibold tabular-nums tracking-tight leading-none">${value}</p>
    </div>`;
}

function upArrowIcon() {
  return '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v8m0-8l-3 3m3-3l3 3"/><circle cx="12" cy="12" r="10"/></svg>';
}
function chartIcon() {
  return '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M7 16l4-4 4 4 6-6"/></svg>';
}
function heartIcon() {
  return '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 116.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z"/></svg>';
}
function boltIcon() {
  return '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>';
}
function dollarIcon() {
  return '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>';
}

function usageBar(pct, compact) {
  var color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500';
  var textColor = pct > 80 ? 'text-red-600 dark:text-red-400' : pct > 50 ? 'text-amber-600 dark:text-amber-400' : 'text-fg';
  var w = compact ? 'w-12' : 'w-16';
  var h = compact ? 'h-1' : 'h-1.5';
  return '<div class="flex items-center gap-2">'
    + '<div class="' + w + ' bg-surface-2 rounded-full ' + h + '"><div class="' + color + ' ' + h + ' rounded-full transition-all duration-500" style="width:' + Math.min(pct, 100) + '%"></div></div>'
    + '<span class="' + textColor + ' tabular-nums font-semibold text-[11px]">' + pct + '%</span>'
    + '</div>';
}

function miniUsageBar(label, pct, resetText) {
  if (pct === undefined || pct === null) return '';
  var color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500';
  return '<div class="flex-1 min-w-0">'
    + '<div class="flex items-center justify-between mb-0.5">'
    + '<span class="text-[10px] text-fg-faint font-medium uppercase tracking-wider">' + label + '</span>'
    + '<span class="text-[10px] text-fg-muted tabular-nums font-semibold">' + pct + '%</span>'
    + '</div>'
    + '<div class="w-full bg-surface-2 rounded-full h-1"><div class="' + color + ' h-1 rounded-full transition-all duration-500" style="width:' + Math.min(pct, 100) + '%"></div></div>'
    + (resetText ? '<div class="text-[10px] text-fg-faint mt-0.5 tabular-nums">' + resetText + '</div>' : '')
    + '</div>';
}

function usageBarFull(label, pct, resets) {
  if (pct === undefined || pct === null) return '';
  var color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500';
  var textColor = pct > 80 ? 'text-red-600 dark:text-red-400' : pct > 50 ? 'text-amber-600 dark:text-amber-400' : 'text-fg';
  return '<div>'
    + '<div class="flex items-center justify-between mb-1">'
    + '<span class="text-[11px] text-fg-muted">' + label + '</span>'
    + '<span class="text-[11px] ' + textColor + ' font-semibold tabular-nums">' + pct + '%</span>'
    + '</div>'
    + '<div class="w-full bg-surface-2 rounded-full h-1.5"><div class="' + color + ' h-1.5 rounded-full transition-all duration-500" style="width:' + Math.min(pct, 100) + '%"></div></div>'
    + (resets ? '<div class="text-[10px] text-fg-faint mt-0.5 tabular-nums">' + esc(resets) + '</div>' : '')
    + '</div>';
}

function planBadgeColors(plan) {
  switch (plan) {
    case 'Max 20X': return ['text-amber-600 dark:text-amber-400', 'bg-amber-50 dark:bg-amber-950/30', 'border-amber-200 dark:border-amber-900/40'];
    case 'Max 5X':  return ['text-purple-600 dark:text-purple-400', 'bg-purple-50 dark:bg-purple-950/30', 'border-purple-200 dark:border-purple-900/40'];
    case 'Max':     return ['text-indigo-600 dark:text-indigo-400', 'bg-indigo-50 dark:bg-indigo-950/30', 'border-indigo-200 dark:border-indigo-900/40'];
    case 'Pro':     return ['text-blue-600 dark:text-blue-400', 'bg-blue-50 dark:bg-blue-950/30', 'border-blue-200 dark:border-blue-900/40'];
    default:        return ['text-slate-600 dark:text-slate-400', 'bg-slate-50 dark:bg-slate-950/30', 'border-slate-200 dark:border-slate-900/40'];
  }
}

function planBadgeHtml(profile, size) {
  if (!profile) return '';
  var plan = formatPlanName(profile);
  if (!plan) return '';
  var c = planBadgeColors(plan);
  var sz = size === 'sm' ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-0.5';
  return ' <span class="' + sz + ' ' + c[0] + ' ' + c[1] + ' border ' + c[2] + ' rounded-md font-medium">' + esc(plan) + '</span>';
}

function detailRow(label, value) {
  return '<div class="flex items-center justify-between py-2 border-b border-border-subtle last:border-0">'
    + '<span class="text-fg-muted">' + label + '</span>'
    + '<span class="text-fg">' + value + '</span>'
    + '</div>';
}

function detailRowCompact(label, value) {
  return '<div class="flex items-center justify-between py-1">'
    + '<span class="text-fg-faint text-[11px]">' + label + '</span>'
    + '<span class="text-fg tabular-nums text-[11px] font-medium">' + value + '</span>'
    + '</div>';
}

function settingRow(label, key, value, description) {
  return '<div class="bg-surface-1 border border-border rounded-xl px-4 sm:px-5 py-3.5 sm:py-4">'
    + '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">'
    + '<div class="min-w-0">'
    + '<p class="text-[12px] font-semibold text-fg">' + label + '</p>'
    + '<p class="text-[11px] text-fg-faint mt-0.5">' + description + '</p>'
    + '</div>'
    + '<div class="flex items-center gap-2 shrink-0">'
    + '<button onclick="adjustSetting(\'' + key + '\', -1)" class="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors text-[14px] font-medium">&minus;</button>'
    + '<span id="setting_' + key + '" class="text-[14px] font-semibold tabular-nums w-8 text-center">' + value + '</span>'
    + '<button onclick="adjustSetting(\'' + key + '\', 1)" class="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors text-[14px] font-medium">+</button>'
    + '</div>'
    + '</div></div>';
}

function proxySettingRow(label, value, description) {
  return '<div class="bg-surface-1 border border-border rounded-xl px-4 sm:px-5 py-3.5 sm:py-4">'
    + '<div class="mb-2">'
    + '<p class="text-[12px] font-semibold text-fg">' + label + '</p>'
    + '<p class="text-[11px] text-fg-faint mt-0.5">' + description + '</p>'
    + '</div>'
    + '<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">'
    + '<input id="globalProxyInput" type="text" value="' + escAttr(value) + '" placeholder="socks5://127.0.0.1:1080 or http://host:port"'
    + ' class="flex-1 text-[12px] bg-surface-0 border border-border-subtle rounded-lg px-3 py-2 text-fg font-mono'
    + ' focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/10 placeholder-fg-faint transition-all min-w-0">'
    + '<button onclick="saveGlobalProxy()" id="saveProxyBtn"'
    + ' class="text-[12px] bg-accent text-white hover:opacity-90 px-3 py-2 rounded-lg font-semibold transition-opacity shrink-0">Save</button>'
    + '</div>'
    + '</div>';
}

function apiKeysSection(keyCount) {
  return '<div class="bg-surface-1 border border-border rounded-xl px-4 sm:px-5 py-3.5 sm:py-4">'
    + '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-3">'
    + '<div class="min-w-0">'
    + '<p class="text-[12px] font-semibold text-fg">API Keys</p>'
    + '<p class="text-[11px] text-fg-faint mt-0.5">Keys for /v1/* endpoint authentication. No keys = open access.</p>'
    + '</div>'
    + '<button onclick="generateApiKey()" id="genApiKeyBtn"'
    + ' class="text-[12px] bg-accent text-white hover:opacity-90 px-3 py-2 rounded-lg font-semibold transition-opacity shrink-0 flex items-center gap-1.5">'
    + '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>'
    + 'Generate</button>'
    + '</div>'
    + '<div id="apiKeysList" class="space-y-2">'
    + (keyCount === 0
      ? '<p class="text-[11px] text-fg-faint py-2">No API keys configured. API endpoints are open.</p>'
      : '<div class="flex justify-center py-3"><div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full spin"></div></div>')
    + '</div>'
    + '<div id="newKeyBanner" class="hidden mt-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded-lg p-3">'
    + '<p class="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium mb-1">New key generated — copy it now, it won\'t be shown again:</p>'
    + '<div class="flex items-center gap-2">'
    + '<code id="newKeyValue" class="flex-1 text-[11px] font-mono text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-900/40 px-2.5 py-1.5 rounded select-all break-all"></code>'
    + '<button onclick="copyNewKey()" id="copyKeyBtn" class="text-[11px] border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2.5 py-1.5 rounded-lg font-medium shrink-0 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors">Copy</button>'
    + '<button onclick="useNewKey()" class="text-[11px] border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2.5 py-1.5 rounded-lg font-medium shrink-0 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors">Use</button>'
    + '</div>'
    + '</div>'
    + '</div>';
}

function overviewTableRow(acc) {
  var pu = acc.planUsage;
  var fiveHourCell = '<span class="text-fg-faint">--</span>';
  var weeklyCell = '<span class="text-fg-faint">--</span>';
  if (pu && pu.updatedAt) {
    fiveHourCell = usageBar(pu.sessionUsed);
    weeklyCell = usageBar(pu.weeklyUsed);
  }
  // 5h reset time: prefer rateLimit.resetsAt, fallback to planUsage.sessionResets
  var rl = acc.rateLimit;
  var resetInfo = '';
  if (rl && rl.resetsAt) {
    resetInfo = '<div class="text-[10px] text-fg-faint mt-0.5 tabular-nums">' + formatResetTime(rl.resetsAt) + ' (' + new Date(rl.resetsAt * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ')</div>';
  } else if (pu && pu.sessionResets) {
    resetInfo = '<div class="text-[10px] text-fg-faint mt-0.5 tabular-nums">' + esc(pu.sessionResets) + '</div>';
  }
  // Weekly reset time from planUsage
  var weeklyResetInfo = '';
  if (pu && pu.weeklyResets) {
    weeklyResetInfo = '<div class="text-[10px] text-fg-faint mt-0.5 tabular-nums">' + esc(pu.weeklyResets) + '</div>';
  }
  var dotClass = acc.healthy ? 'bg-emerald-500' : 'bg-red-500';
  if (acc.healthy && acc.active === 0) dotClass += ' pulse-dot';
  var textClass = acc.healthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  var statusText = acc.healthy ? (acc.active > 0 ? acc.active + ' active' : 'Idle') : 'Down';

  // Rate limit badge
  var rlBadge = '';
  if (acc.rateLimit && acc.rateLimit.status === 'limited') {
    rlBadge = '<span class="ml-1 text-[10px] text-red-500 bg-red-50 dark:bg-red-950/30 px-1 py-0.5 rounded font-medium">LIMITED</span>';
  }

  return '<tr class="border-b border-border-subtle last:border-0 table-row-hover transition-colors cursor-pointer" onclick="showAccountDetail(\'' + esc(acc.name) + '\')">'
    + '<td class="px-4 py-2.5"><div class="flex items-center gap-2.5">'
    + '<div class="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold tracking-tight shrink-0" style="background:hsl(' + (hashCode(acc.name) % 360) + ',40%,92%);color:hsl(' + (hashCode(acc.name) % 360) + ',50%,35%)">' + acc.name.slice(0, 2).toUpperCase() + '</div>'
    + '<span class="font-semibold text-fg">' + esc(acc.name) + '</span>' + planBadgeHtml(acc.profile, 'sm') + (acc.profile && acc.profile.emailAddress ? '<div class="text-[10px] text-fg-faint font-normal">' + esc(acc.profile.emailAddress) + '</div>' : '') + '</div></td>'
    + '<td class="px-4 py-2.5"><span class="inline-flex items-center gap-1.5">'
    + '<span class="w-1.5 h-1.5 rounded-full ' + dotClass + '"></span>'
    + '<span class="font-medium ' + textClass + '">' + statusText + '</span>' + rlBadge
    + '</span></td>'
    + '<td class="px-4 py-2.5">' + (function(p) {
        if (!p) return '<span class="text-fg-faint">--</span>';
        var lines = '';
        if (p.subscriptionCreatedAt) lines += '<div class="text-[10px] text-fg-muted">Since ' + new Date(p.subscriptionCreatedAt).toLocaleDateString() + '</div>';
        if (p.tokenExpiresAt) {
          var exp = new Date(p.tokenExpiresAt);
          var isExpired = exp < new Date();
          lines += '<div class="text-[10px] ' + (isExpired ? 'text-red-500' : 'text-fg-faint') + '">Token ' + (isExpired ? 'expired' : 'expires') + ' ' + exp.toLocaleDateString() + '</div>';
        }
        return lines || '<span class="text-fg-faint">--</span>';
      })(acc.profile) + '</td>'
    + '<td class="px-4 py-2.5">' + fiveHourCell + resetInfo + '</td>'
    + '<td class="px-4 py-2.5">' + weeklyCell + weeklyResetInfo + '</td>'
    + '<td class="px-4 py-2.5 text-right text-fg-muted tabular-nums font-medium text-[11px]">' + (acc.usage ? '$' + acc.usage.totalCostUsd.toFixed(4) : '--') + '</td>'
    + '<td class="px-4 py-2.5 text-right tabular-nums font-medium text-[11px]">' + acc.requestCount + '</td>'
    + '</tr>';
}

function overviewMobileCard(acc) {
  var pu = acc.planUsage;
  var dotClass = acc.healthy ? 'bg-emerald-500' : 'bg-red-500';
  if (acc.healthy && acc.active === 0) dotClass += ' pulse-dot';
  var textClass = acc.healthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  var statusText = acc.healthy ? (acc.active > 0 ? acc.active + ' active' : 'Idle') : 'Down';
  var rlBadge = '';
  if (acc.rateLimit && acc.rateLimit.status === 'limited') {
    rlBadge = ' <span class="text-[9px] text-red-500 bg-red-50 dark:bg-red-950/30 px-1 py-0.5 rounded font-medium">LIMITED</span>';
  }
  // Usage bars
  var usageHtml = '';
  if (pu && pu.updatedAt) {
    usageHtml = '<div class="flex items-center gap-3 mt-2 pt-2 border-t border-border-subtle">'
      + miniUsageBar('5h', pu.sessionUsed, '')
      + miniUsageBar('Wk', pu.weeklyUsed, '')
      + '</div>';
  }
  var hue = hashCode(acc.name) % 360;
  return '<div class="bg-surface-1 border border-border rounded-xl p-3 cursor-pointer" onclick="showAccountDetail(\'' + esc(acc.name) + '\')">'
    + '<div class="flex items-center justify-between">'
    + '<div class="flex items-center gap-2.5 min-w-0">'
    + '<div class="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0" style="background:hsl(' + hue + ',40%,92%);color:hsl(' + hue + ',50%,35%)">' + acc.name.slice(0, 2).toUpperCase() + '</div>'
    + '<div class="min-w-0">'
    + '<div class="flex items-center gap-1.5 flex-wrap"><span class="text-[12px] font-semibold text-fg truncate">' + esc(acc.name) + '</span>' + planBadgeHtml(acc.profile, 'sm') + '</div>'
    + '<div class="text-[10px] text-fg-faint">' + acc.requestCount + ' reqs' + (acc.usage ? ' &middot; $' + acc.usage.totalCostUsd.toFixed(4) : '') + '</div>'
    + '</div></div>'
    + '<div class="flex items-center gap-1.5 shrink-0">'
    + '<span class="w-1.5 h-1.5 rounded-full ' + dotClass + '"></span>'
    + '<span class="text-[10px] font-medium ' + textClass + '">' + statusText + '</span>' + rlBadge
    + '</div>'
    + '</div>'
    + usageHtml
    + '</div>';
}

function accountCard(acc) {
  const statusText = acc.healthy ? (acc.active > 0 ? acc.active + ' active' : 'Idle') : 'Unhealthy';
  const statusColor = acc.healthy ? 'emerald' : 'red';
  const rl = acc.rateLimit;
  const pu = acc.planUsage;

  // Quota badge
  let quotaBadge = '';
  if (rl) {
    const isLimited = rl.status === 'limited';
    if (isLimited) {
      const resetIn = formatResetTime(rl.resetsAt);
      quotaBadge = '<span class="text-[10px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 px-2 py-0.5 rounded-md font-medium">Limited ' + resetIn + '</span>';
    } else {
      quotaBadge = '<span class="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 px-2 py-0.5 rounded-md font-medium">Available</span>';
    }
  }

  // Plan usage mini bars + 5h reset time
  var accRl = acc.rateLimit;
  var fiveHourReset = '';
  if (accRl && accRl.resetsAt) {
    fiveHourReset = formatResetTime(accRl.resetsAt) + ' (' + new Date(accRl.resetsAt * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ')';
  } else if (pu && pu.sessionResets) {
    fiveHourReset = pu.sessionResets;
  }
  let usageBars = '';
  if (pu && pu.updatedAt) {
    usageBars = '<div class="flex items-center gap-3 sm:gap-4 mt-2 pt-2 border-t border-border-subtle">'
      + miniUsageBar('5h', pu.sessionUsed, fiveHourReset)
      + miniUsageBar('Wk', pu.weeklyUsed, pu.weeklyResets || '')
      + '<span class="hidden sm:contents">' + miniUsageBar('Sonnet', pu.sonnetUsed, pu.sonnetResets || '') + '</span>'
      + '</div>';
  }

  const initials = acc.name.slice(0, 2).toUpperCase();
  const hue = hashCode(acc.name) % 360;

  return '<div class="bg-surface-1 border border-border rounded-xl px-3 sm:px-4 py-3 sm:py-3.5 card-lift cursor-pointer group" onclick="showAccountDetail(\'' + esc(acc.name) + '\')">'
    + '<div class="flex items-center justify-between gap-2">'
    + '<div class="flex items-center gap-2.5 sm:gap-3.5 min-w-0">'
    + '<div class="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center text-[10px] sm:text-[11px] font-bold tracking-tight shadow-sm shrink-0" style="background:hsl(' + hue + ',40%,92%);color:hsl(' + hue + ',50%,35%)">' + initials + '</div>'
    + '<div class="min-w-0">'
    + '<p class="text-[12px] sm:text-[13px] font-semibold text-fg truncate">' + esc(acc.name) + (acc.profile && acc.profile.displayName ? ' <span class="text-fg-faint font-normal hidden sm:inline">(' + esc(acc.profile.displayName) + ')</span>' : '') + planBadgeHtml(acc.profile) + '</p>'
    + (acc.profile && acc.profile.emailAddress ? '<p class="text-[10px] text-fg-faint font-medium truncate hidden sm:block">' + esc(acc.profile.emailAddress) + '</p>' : '')
    + '<p class="text-[10px] sm:text-[11px] text-fg-faint tabular-nums font-medium">' + acc.requestCount + ' req' + (acc.requestCount !== 1 ? 's' : '') + (acc.usage ? ' &middot; $' + acc.usage.totalCostUsd.toFixed(4) : '') + (acc.proxy ? ' &middot; <span class="text-blue-500" title="' + escAttr(acc.proxy) + '">proxy</span>' : '') + '</p>'
    + '</div></div>'
    + '<div class="flex items-center gap-2 sm:gap-3 shrink-0">'
    + '<span class="hidden sm:inline">' + quotaBadge + '</span>'
    + '<span class="inline-flex items-center gap-1.5 text-[10px] sm:text-[11px] font-medium">'
    + '<span class="w-1.5 h-1.5 rounded-full bg-' + statusColor + '-500 ' + (acc.healthy && acc.active === 0 ? 'pulse-dot' : '') + '"></span>'
    + '<span class="text-' + statusColor + '-600 dark:text-' + statusColor + '-400">' + statusText + '</span></span>'
    + '<svg class="w-4 h-4 text-fg-faint/40 group-hover:text-fg-faint transition-colors hidden sm:block" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>'
    + '</div></div>'
    + usageBars
    + '</div>';
}
