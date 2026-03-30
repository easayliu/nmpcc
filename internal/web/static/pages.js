// ── Page Render Functions ──

// ── Overview Page ──
function renderOverview($el) {
  var d = cachedDashboard;
  var healthPct = d && d.total_accounts > 0 ? Math.round((d.healthy_accounts / d.total_accounts) * 100) : 0;
  var healthyVal = d ? d.healthy_accounts + '<span class="text-fg-faint font-normal text-[14px] tabular-nums">/' + d.total_accounts + '</span>' : '--';
  var healthColor = healthPct >= 80 ? 'emerald' : healthPct >= 50 ? 'amber' : 'red';

  // Compute totals across all accounts
  var totalCost = 0;
  var totalActive = 0;
  cachedAccounts.forEach(function(a) {
    if (a.usage) totalCost += a.usage.totalCostUsd;
    totalActive += a.active || 0;
  });

  var tableRows = cachedAccounts.map(overviewTableRow).join('');
  var mobileCards = cachedAccounts.map(overviewMobileCard).join('');

  var emptyHtml = '<div class="border-2 border-dashed border-border rounded-2xl py-12 flex flex-col items-center gap-2">'
    + '<div class="w-10 h-10 rounded-xl bg-surface-1 border border-border flex items-center justify-center text-fg-faint">'
    + '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>'
    + '</div>'
    + '<p class="text-[12px] text-fg-muted font-medium">No accounts yet</p>'
    + '<button onclick="navigate(\'accounts\');openLoginModal()" class="text-[12px] text-accent hover:underline underline-offset-2 font-medium">Add your first account</button>'
    + '</div>';

  var desktopTable = '<div class="border border-border rounded-xl overflow-hidden bg-surface-0 overflow-x-auto">'
    + '<table class="w-full text-[11px]">'
    + '<thead><tr class="border-b border-border text-fg-faint bg-surface-1">'
    + '<th class="text-left font-semibold px-4 py-2.5 uppercase tracking-wider text-[10px]">Account</th>'
    + '<th class="text-left font-semibold px-4 py-2.5 uppercase tracking-wider text-[10px]">Status</th>'
    + '<th class="text-left font-semibold px-4 py-2.5 uppercase tracking-wider text-[10px]">Subscription</th>'
    + '<th class="text-left font-semibold px-4 py-2.5 uppercase tracking-wider text-[10px]">5h</th>'
    + '<th class="text-left font-semibold px-4 py-2.5 uppercase tracking-wider text-[10px]">Weekly</th>'
    + '<th class="text-right font-semibold px-4 py-2.5 uppercase tracking-wider text-[10px]">Cost</th>'
    + '<th class="text-right font-semibold px-4 py-2.5 uppercase tracking-wider text-[10px]">Reqs</th>'
    + '</tr></thead>'
    + '<tbody class="stagger">' + tableRows + '</tbody>'
    + '</table></div>';

  var tableHtml = cachedAccounts.length === 0 ? emptyHtml
    : '<div class="hidden lg:block">' + desktopTable + '</div>'
    + '<div class="lg:hidden space-y-2 stagger">' + mobileCards + '</div>';

  $el.innerHTML = '<div class="p-4 sm:p-6 lg:p-8 page-enter">'
    + '<div class="mb-6">'
    + '<h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Overview</h1>'
    + '<p class="text-[12px] text-fg-faint mt-1.5 font-medium">Service status and metrics'
    + (lastRefreshTime ? ' <span class="text-fg-faint/60">&middot; updated ' + timeAgo(lastRefreshTime) + '</span>' : '')
    + '</p>'
    + '</div>'
    + '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 stagger mb-6">'
    + statCard('Uptime', d ? formatUptime(d.uptime_seconds) : '--', upArrowIcon())
    + statCard('Requests', d ? d.total_requests.toLocaleString() : '--', chartIcon())
    + statCard('Healthy', healthyVal, heartIcon(), healthColor)
    + statCard('Active', totalActive, boltIcon())
    + statCard('Cost', totalCost > 0 ? '$' + totalCost.toFixed(2) : '--', dollarIcon())
    + '</div>'
    + '<div>'
    + '<div class="flex items-center justify-between mb-3">'
    + '<h2 class="text-[12px] font-semibold text-fg-muted uppercase tracking-wider">Accounts</h2>'
    + '<div class="flex items-center gap-3">'
    + '<span class="text-[11px] text-fg-faint tabular-nums">' + cachedAccounts.length + ' total</span>'
    + '<button onclick="navigate(\'accounts\');openLoginModal()" class="text-[11px] text-accent hover:underline underline-offset-2 font-medium">+ Add</button>'
    + '</div>'
    + '</div>'
    + tableHtml
    + '</div></div>';
}

// ── Accounts Page ──
function renderAccounts($el) {
  // Separate healthy/unhealthy for visual grouping
  var healthyAccs = cachedAccounts.filter(function(a) { return a.healthy; });
  var unhealthyAccs = cachedAccounts.filter(function(a) { return !a.healthy; });

  var accountsHtml = '';
  if (cachedAccounts.length === 0) {
    accountsHtml = '<div class="border-2 border-dashed border-border rounded-2xl py-16 flex flex-col items-center gap-3">'
      + '<div class="w-10 h-10 rounded-xl bg-surface-1 border border-border flex items-center justify-center text-fg-faint">'
      + '<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>'
      + '</div>'
      + '<p class="text-[13px] text-fg-muted font-medium">No accounts configured</p>'
      + '<button onclick="openLoginModal()" class="text-[12px] text-accent hover:underline underline-offset-2 font-medium">Add your first account</button>'
      + '</div>';
  } else {
    accountsHtml = '<div class="space-y-2 stagger">' + healthyAccs.map(accountCard).join('') + '</div>';
    if (unhealthyAccs.length > 0) {
      accountsHtml += '<div class="mt-4"><p class="text-[10px] text-red-500 uppercase tracking-wider font-semibold mb-2">Unhealthy</p>'
        + '<div class="space-y-2">' + unhealthyAccs.map(accountCard).join('') + '</div></div>';
    }
  }

  $el.innerHTML = '<div class="p-4 sm:p-6 lg:p-8 page-enter">'
    + '<div class="flex items-center justify-between mb-6">'
    + '<div>'
    + '<h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Accounts</h1>'
    + '<p class="text-[12px] text-fg-faint mt-1.5 font-medium">' + cachedAccounts.length + ' account' + (cachedAccounts.length !== 1 ? 's' : '') + ' configured</p>'
    + '</div>'
    + '<button onclick="openLoginModal()"'
    + ' class="text-[12px] bg-accent text-white hover:opacity-90 px-4 py-2 rounded-lg font-semibold transition-opacity shadow-sm flex items-center gap-1.5">'
    + '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>'
    + 'Add Account</button>'
    + '</div>'
    + accountsHtml
    + '</div>';
}

// ── Logs Page ──

// Current log filter state
var logFilter = { account: '', range: 'today', limit: 200, offset: 0 };
var logSummary = { count: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
var logHasMore = false;

async function fetchLogs() {
  var params = [];
  if (logFilter.account) params.push('account=' + encodeURIComponent(logFilter.account));
  if (logFilter.limit) params.push('limit=' + logFilter.limit);
  if (logFilter.offset > 0) params.push('offset=' + logFilter.offset);

  // Time range
  var now = Math.floor(Date.now() / 1000);
  if (logFilter.range === 'today') {
    var startOfDay = Math.floor(new Date().setHours(0,0,0,0) / 1000);
    params.push('since=' + startOfDay);
  } else if (logFilter.range === '1h') {
    params.push('since=' + (now - 3600));
  } else if (logFilter.range === '24h') {
    params.push('since=' + (now - 86400));
  } else if (logFilter.range === '7d') {
    params.push('since=' + (now - 604800));
  }
  // 'all' = no since param

  var url = '/api/logs' + (params.length ? '?' + params.join('&') : '');
  try {
    var result = await api('GET', url);
    // Support both new {logs,summary,hasMore} format and legacy array format
    if (Array.isArray(result)) {
      cachedLogs = result;
      logSummary = { count: result.length, inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
      result.forEach(function(l) {
        logSummary.inputTokens += l.inputTokens || 0;
        logSummary.outputTokens += l.outputTokens || 0;
        logSummary.totalCostUsd += l.totalCostUsd || 0;
      });
      logHasMore = false;
    } else {
      cachedLogs = result.logs || [];
      logSummary = result.summary || { count: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
      logHasMore = result.hasMore || false;
    }
  } catch (e) {
    cachedLogs = [];
    logSummary = { count: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
    logHasMore = false;
  }
}

function buildLogRows() {
  return cachedLogs.map(function(log) {
    const t = new Date(log.timestamp * 1000);
    const time = t.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
    const date = t.toLocaleDateString([], {month: 'short', day: 'numeric'});
    const model = (log.model || 'default').replace('claude-', '').replace('-20250514', '');
    const mode = log.stream ? 'SSE' : 'JSON';
    const dur = log.durationMs < 1000 ? log.durationMs + 'ms' : (log.durationMs / 1000).toFixed(1) + 's';
    const cost = log.totalCostUsd > 0 ? '$' + log.totalCostUsd.toFixed(6) : '--';

    var cacheInfo = '';
    if (log.cacheReadInputTokens > 0) cacheInfo += '<span class="text-emerald-600 dark:text-emerald-400">R:' + formatTokens(log.cacheReadInputTokens) + '</span> ';
    if (log.cacheCreation1h > 0) cacheInfo += '<span class="text-amber-600 dark:text-amber-400">1h:' + formatTokens(log.cacheCreation1h) + '</span> ';
    if (log.cacheCreation5m > 0) cacheInfo += '<span class="text-blue-600 dark:text-blue-400">5m:' + formatTokens(log.cacheCreation5m) + '</span> ';
    if (!cacheInfo) cacheInfo = '<span class="text-fg-faint">--</span>';

    var showDate = logFilter.range !== 'today' && logFilter.range !== '1h';

    return '<tr class="border-b border-border-subtle last:border-0 table-row-hover transition-colors">'
      + '<td class="px-3 py-2.5 text-fg-faint tabular-nums text-[11px]">' + (showDate ? date + ' ' : '') + time + '</td>'
      + '<td class="px-3 py-2.5"><span class="font-medium text-[11px]">' + esc(log.account) + '</span></td>'
      + '<td class="px-3 py-2.5"><span class="text-[10px] bg-surface-2 border border-border-subtle px-1.5 py-0.5 rounded font-mono tabular-nums">' + esc(model) + '</span></td>'
      + '<td class="px-3 py-2.5 text-center"><span class="text-[10px] px-1.5 py-0.5 rounded font-medium '
        + (log.stream ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30' : 'text-fg-muted bg-surface-1')
        + '">' + mode + '</span></td>'
      + '<td class="px-3 py-2.5 text-right tabular-nums text-[11px]">' + formatTokens(log.inputTokens) + '</td>'
      + '<td class="px-3 py-2.5 text-right tabular-nums text-[11px]">' + formatTokens(log.outputTokens) + '</td>'
      + '<td class="px-3 py-2.5 text-right text-[10px] tabular-nums">' + cacheInfo + '</td>'
      + '<td class="px-3 py-2.5 text-right tabular-nums text-fg-muted text-[11px]">' + dur + '</td>'
      + '<td class="px-3 py-2.5 text-right tabular-nums font-medium text-[11px]">' + cost + '</td>'
      + '</tr>';
  }).join('');
}

function buildMobileLogCards() {
  return cachedLogs.map(function(log) {
    const t = new Date(log.timestamp * 1000);
    const time = t.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
    const date = t.toLocaleDateString([], {month: 'short', day: 'numeric'});
    const model = (log.model || 'default').replace('claude-', '').replace('-20250514', '');
    const dur = log.durationMs < 1000 ? log.durationMs + 'ms' : (log.durationMs / 1000).toFixed(1) + 's';
    const cost = log.totalCostUsd > 0 ? '$' + log.totalCostUsd.toFixed(6) : '--';
    var showDate = logFilter.range !== 'today' && logFilter.range !== '1h';
    return '<div class="bg-surface-1 border border-border rounded-xl p-3">'
      + '<div class="flex items-center justify-between mb-1.5">'
      + '<span class="text-[12px] font-semibold text-fg">' + esc(log.account) + '</span>'
      + '<span class="text-[10px] text-fg-faint tabular-nums">' + (showDate ? date + ' ' : '') + time + '</span>'
      + '</div>'
      + '<div class="flex items-center gap-2 flex-wrap">'
      + '<span class="text-[10px] bg-surface-2 border border-border-subtle px-1.5 py-0.5 rounded font-mono tabular-nums">' + esc(model) + '</span>'
      + '<span class="text-[10px] text-fg-muted tabular-nums">In:' + formatTokens(log.inputTokens) + '</span>'
      + '<span class="text-[10px] text-fg-muted tabular-nums">Out:' + formatTokens(log.outputTokens) + '</span>'
      + '<span class="text-[10px] text-fg-muted tabular-nums">' + dur + '</span>'
      + '<span class="text-[10px] font-medium tabular-nums">' + cost + '</span>'
      + '</div></div>';
  }).join('');
}

function logFilterBar() {
  // Account options from cached accounts
  var accountOpts = '<option value="">All Accounts</option>';
  cachedAccounts.forEach(function(a) {
    var sel = logFilter.account === a.name ? ' selected' : '';
    accountOpts += '<option value="' + escAttr(a.name) + '"' + sel + '>' + esc(a.name) + '</option>';
  });

  // Time range buttons
  var ranges = [
    { key: '1h', label: '1h' },
    { key: 'today', label: 'Today' },
    { key: '24h', label: '24h' },
    { key: '7d', label: '7d' },
    { key: 'all', label: 'All' }
  ];
  var rangeButtons = ranges.map(function(r) {
    var active = logFilter.range === r.key
      ? 'bg-accent text-white'
      : 'bg-surface-1 text-fg-muted hover:text-fg hover:bg-surface-2 border border-border';
    return '<button onclick="logFilter.range=\'' + r.key + '\';reloadLogs()" class="text-[11px] px-2.5 py-1.5 rounded-lg font-medium transition-colors ' + active + '">' + r.label + '</button>';
  }).join('');

  return '<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 mb-4">'
    + '<select onchange="logFilter.account=this.value;reloadLogs()"'
    + ' class="text-[11px] bg-surface-0 border border-border rounded-lg px-2.5 py-1.5 text-fg font-medium'
    + ' focus:outline-none focus:border-accent/40 min-w-0 sm:w-40">'
    + accountOpts + '</select>'
    + '<div class="flex items-center gap-1">' + rangeButtons + '</div>'
    + '<select onchange="logFilter.limit=parseInt(this.value);reloadLogs()"'
    + ' class="text-[11px] bg-surface-0 border border-border rounded-lg px-2.5 py-1.5 text-fg font-medium'
    + ' focus:outline-none focus:border-accent/40 sm:w-24 sm:ml-auto">'
    + '<option value="100"' + (logFilter.limit === 100 ? ' selected' : '') + '>100</option>'
    + '<option value="200"' + (logFilter.limit === 200 ? ' selected' : '') + '>200</option>'
    + '<option value="500"' + (logFilter.limit === 500 ? ' selected' : '') + '>500</option>'
    + '</select>'
    + '</div>';
}

function renderLogsContent($el) {
  var rows = buildLogRows();
  var mobileLogCards = buildMobileLogCards();

  var pageStart = logFilter.offset + 1;
  var pageEnd = logFilter.offset + cachedLogs.length;

  var summaryHtml = logSummary.count > 0
    ? '<div class="flex flex-wrap items-center gap-3 sm:gap-4 text-[11px] text-fg-faint tabular-nums mb-4">'
      + '<span>Total: <strong class="text-fg-muted">' + logSummary.count + '</strong> requests</span>'
      + '<span>In: <strong class="text-fg-muted">' + formatTokens(logSummary.inputTokens) + '</strong></span>'
      + '<span>Out: <strong class="text-fg-muted">' + formatTokens(logSummary.outputTokens) + '</strong></span>'
      + '<span>Cost: <strong class="text-fg-muted">$' + logSummary.totalCostUsd.toFixed(4) + '</strong></span>'
      + (logSummary.count > cachedLogs.length ? '<span>Showing ' + pageStart + '-' + pageEnd + '</span>' : '')
      + '</div>'
    : '';

  // Pagination controls
  var paginationHtml = '';
  if (logFilter.offset > 0 || logHasMore) {
    paginationHtml = '<div class="flex items-center justify-between mt-4">'
      + '<button onclick="logPrevPage()"'
      + ' class="text-[11px] border border-border text-fg-muted hover:text-fg px-3 py-1.5 rounded-lg font-medium transition-colors'
      + (logFilter.offset > 0 ? ' hover:bg-surface-1' : ' opacity-40 cursor-not-allowed') + '"'
      + (logFilter.offset > 0 ? '' : ' disabled') + '>Previous</button>'
      + '<span class="text-[11px] text-fg-faint tabular-nums">' + pageStart + '-' + pageEnd + ' of ' + logSummary.count + '</span>'
      + '<button onclick="logNextPage()"'
      + ' class="text-[11px] border border-border text-fg-muted hover:text-fg px-3 py-1.5 rounded-lg font-medium transition-colors'
      + (logHasMore ? ' hover:bg-surface-1' : ' opacity-40 cursor-not-allowed') + '"'
      + (logHasMore ? '' : ' disabled') + '>Next</button>'
      + '</div>';
  }

  $el.innerHTML = '<div class="p-4 sm:p-6 lg:p-8 page-enter">'
    + '<div class="mb-4">'
    + '<h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Request Logs</h1>'
    + '</div>'
    + logFilterBar()
    + summaryHtml
    + (cachedLogs.length === 0
      ? '<div class="border-2 border-dashed border-border rounded-2xl py-12 flex flex-col items-center gap-2">'
        + '<svg class="w-8 h-8 text-fg-faint/40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>'
        + '<p class="text-[12px] text-fg-muted font-medium">No requests found</p></div>'
      : '<div class="hidden lg:block border border-border rounded-xl overflow-hidden bg-surface-0 overflow-x-auto">'
        + '<table class="w-full text-[11px] min-w-[700px]">'
        + '<thead><tr class="border-b border-border text-fg-faint bg-surface-1">'
        + '<th class="text-left font-semibold px-3 py-2.5 uppercase tracking-wider text-[10px]">Time</th>'
        + '<th class="text-left font-semibold px-3 py-2.5 uppercase tracking-wider text-[10px]">Account</th>'
        + '<th class="text-left font-semibold px-3 py-2.5 uppercase tracking-wider text-[10px]">Model</th>'
        + '<th class="text-center font-semibold px-3 py-2.5 uppercase tracking-wider text-[10px]">Mode</th>'
        + '<th class="text-right font-semibold px-3 py-2.5 uppercase tracking-wider text-[10px]">In</th>'
        + '<th class="text-right font-semibold px-3 py-2.5 uppercase tracking-wider text-[10px]">Out</th>'
        + '<th class="text-right font-semibold px-3 py-2.5 uppercase tracking-wider text-[10px]">Cache</th>'
        + '<th class="text-right font-semibold px-3 py-2.5 uppercase tracking-wider text-[10px]">Duration</th>'
        + '<th class="text-right font-semibold px-3 py-2.5 uppercase tracking-wider text-[10px]">Cost</th>'
        + '</tr></thead>'
        + '<tbody>' + rows + '</tbody>'
        + '</table></div>'
        + '<div class="lg:hidden space-y-2 stagger">' + mobileLogCards + '</div>')
    + paginationHtml
    + '</div>';
}

function logNextPage() {
  if (!logHasMore) return;
  logFilter.offset += logFilter.limit;
  reloadLogs(false);
}

function logPrevPage() {
  if (logFilter.offset <= 0) return;
  logFilter.offset = Math.max(0, logFilter.offset - logFilter.limit);
  reloadLogs(false);
}

async function renderLogs($el) {
  $el.innerHTML = '<div class="p-4 sm:p-6 lg:p-8 page-enter">'
    + '<div class="mb-6"><h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Request Logs</h1>'
    + '<p class="text-[12px] text-fg-faint mt-1.5 font-medium">Loading...</p></div>'
    + '<div class="flex justify-center py-12"><div class="w-5 h-5 border-2 border-accent border-t-transparent rounded-full spin"></div></div></div>';

  await fetchLogs();
  renderLogsContent($el);
}

async function reloadLogs(resetPage) {
  if (resetPage !== false) logFilter.offset = 0;
  var $el = document.getElementById('content');
  await fetchLogs();
  renderLogsContent($el);
}

// ── Settings Page ──
async function renderSettings($el) {
  $el.innerHTML = '<div class="p-4 sm:p-6 lg:p-8 page-enter">'
    + '<div class="mb-6">'
    + '<h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Settings</h1>'
    + '<p class="text-[12px] text-fg-faint mt-1.5 font-medium">Runtime configuration</p>'
    + '</div>'
    + '<div class="flex justify-center py-12"><div class="w-5 h-5 border-2 border-accent border-t-transparent rounded-full spin"></div></div></div>';

  let settings;
  try {
    settings = await api('GET', '/api/settings');
  } catch {
    settings = { maxConcurrency: 1, maxTurns: 10, globalProxy: '', apiKeyCount: 0 };
  }

  $el.innerHTML = '<div class="p-4 sm:p-6 lg:p-8 page-enter">'
    + '<div class="mb-6">'
    + '<h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Settings</h1>'
    + '<p class="text-[12px] text-fg-faint mt-1.5 font-medium">Runtime configuration</p>'
    + '</div>'
    + '<div class="space-y-4">'
    + settingRow('Max Concurrency', 'maxConcurrency', settings.maxConcurrency,
        'Maximum concurrent requests per account. Higher values increase throughput but may trigger rate limits.')
    + settingRow('Max Turns', 'maxTurns', settings.maxTurns,
        'Maximum tool-use turns per CLI request. Set to 1 for pure proxy mode.')
    + proxySettingRow('Global Proxy', settings.globalProxy || '',
        'Applied to all accounts without a per-account proxy. Supports socks5:// and http:// protocols.')
    + apiKeysSection(settings.apiKeyCount || 0)
    + '</div>'
    + '<div id="settingsSaveStatus" class="mt-4 text-[11px] text-fg-faint"></div>'
    + '</div>';

  // Load API keys list after DOM is ready
  if (settings.apiKeyCount > 0) {
    loadApiKeys();
  }
}

// ── Account Detail ──
async function showAccountDetail(name) {
  const $modal = document.getElementById('detailModal');
  const $title = document.getElementById('detailTitle');
  const $body = document.getElementById('detailBody');

  $title.textContent = name;
  $body.innerHTML = '<div class="flex items-center gap-2 py-8 justify-center"><div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full spin"></div><span class="text-fg-faint text-[12px]">Loading...</span></div>';
  $modal.classList.remove('hidden');

  try {
    const acc = cachedAccounts.find(a => a.name === name);
    if (!acc) {
      $body.innerHTML = '<p class="text-fg-muted text-[12px]">Account not found. It may have been removed.</p>';
      return;
    }
    const rl = acc.rateLimit;
    const usage = acc.usage;
    const pu = acc.planUsage;

    // Profile section
    const profile = acc?.profile;
    let profileSection = '';
    if (profile) {
      var planName = formatPlanName(profile);
      var tokenExpiry = '';
      if (profile.tokenExpiresAt) {
        var expDate = new Date(profile.tokenExpiresAt);
        var isExpired = expDate < new Date();
        tokenExpiry = isExpired
          ? '<span class="text-red-500 font-medium">Expired ' + expDate.toLocaleString() + '</span>'
          : '<span class="text-emerald-600 dark:text-emerald-400">' + expDate.toLocaleString() + '</span>';
      }
      profileSection = '<div class="space-y-1">'
        + '<p class="text-[10px] text-fg-faint uppercase tracking-wider font-semibold mb-2">Account Info</p>'
        + (profile.displayName ? detailRow('Name', esc(profile.displayName)) : '')
        + (profile.emailAddress ? detailRow('Email', esc(profile.emailAddress)) : '')
        + (planName ? detailRow('Subscription', planBadgeHtml(profile)) : '')
        + (profile.rateLimitTier ? detailRow('Rate Limit Tier', esc(profile.rateLimitTier)) : '')
        + (profile.organizationName ? detailRow('Organization', esc(profile.organizationName) + (profile.organizationRole ? ' <span class="text-fg-faint">(' + esc(profile.organizationRole) + ')</span>' : '')) : '')
        + (profile.accountCreatedAt ? detailRow('Account Created', new Date(profile.accountCreatedAt).toLocaleDateString()) : '')
        + (profile.subscriptionCreatedAt ? detailRow('Subscribed Since', new Date(profile.subscriptionCreatedAt).toLocaleDateString()) : '')
        + (tokenExpiry ? detailRow('Token Expires', tokenExpiry) : '')
        + '</div>';
    }

    // Plan usage section with nice bars
    // Use rateLimit.resetsAt for the 5h reset time
    var fiveHourResetStr = '';
    if (rl && rl.resetsAt) {
      fiveHourResetStr = formatResetTime(rl.resetsAt) + ' (' + new Date(rl.resetsAt * 1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ')';
    } else if (pu && pu.sessionResets) {
      fiveHourResetStr = pu.sessionResets;
    }
    let planSection = '';
    if (pu && pu.updatedAt) {
      planSection = '<div class="mt-3 pt-3 border-t border-border">'
        + '<p class="text-[10px] text-fg-faint uppercase tracking-wider font-semibold mb-3">Plan Usage</p>'
        + '<div class="space-y-3">'
        + usageBarFull('5-hour usage', pu.sessionUsed, fiveHourResetStr || pu.sessionResets)
        + usageBarFull('Weekly (all models)', pu.weeklyUsed, pu.weeklyResets)
        + usageBarFull('Weekly (Sonnet)', pu.sonnetUsed, pu.sonnetResets)
        + (pu.extraUsage ? '<div class="flex items-center justify-between text-[11px]"><span class="text-fg-muted">Extra usage</span><span class="text-fg font-medium">' + esc(pu.extraUsage) + '</span></div>' : '')
        + '</div></div>';
    }

    let quotaSection = '';
    if (rl) {
      const isLimited = rl.status === 'limited';
      const statusBadge = isLimited
        ? '<span class="text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 px-2 py-0.5 rounded-md text-[11px] font-medium">Limited</span>'
        : '<span class="text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 px-2 py-0.5 rounded-md text-[11px] font-medium">Available</span>';
      quotaSection = '<div class="mt-3 pt-3 border-t border-border space-y-1">'
        + '<p class="text-[10px] text-fg-faint uppercase tracking-wider font-semibold mb-2">Rate Limit</p>'
        + detailRow('Status', statusBadge)
        + detailRow('Type', esc(rl.rateLimitType || 'five_hour'))
        + (rl.resetsAt ? detailRow('Resets', formatResetTime(rl.resetsAt) + ' <span class="text-fg-faint">(' + new Date(rl.resetsAt * 1000).toLocaleTimeString() + ')</span>') : '')
        + (rl.updatedAt ? detailRow('Last Check', new Date(rl.updatedAt * 1000).toLocaleTimeString()) : '')
        + '</div>';
    }

    let usageSection = '';
    if (usage) {
      usageSection = '<div class="mt-3 pt-3 border-t border-border space-y-1">'
        + '<p class="text-[10px] text-fg-faint uppercase tracking-wider font-semibold mb-2">Token Usage</p>'
        + '<div class="grid grid-cols-2 gap-x-4 gap-y-1">'
        + detailRowCompact('Input', formatTokens(usage.inputTokens))
        + detailRowCompact('Output', formatTokens(usage.outputTokens))
        + detailRowCompact('Cache Read', formatTokens(usage.cacheReadInputTokens))
        + detailRowCompact('Cache 1h', formatTokens(usage.cacheCreation1h || 0))
        + detailRowCompact('Cache 5m', formatTokens(usage.cacheCreation5m || 0))
        + '</div>'
        + '<div class="flex items-center justify-between py-2 mt-1 border-t border-border-subtle">'
        + '<span class="text-fg-muted font-medium">Total Cost</span>'
        + '<span class="font-semibold text-accent">$' + usage.totalCostUsd.toFixed(4) + '</span>'
        + '</div></div>';
    }

    // Concurrency control
    var concurrencySection = '<div class="mt-3 pt-3 border-t border-border">'
      + '<div class="flex items-center justify-between">'
      + '<div>'
      + '<p class="text-[11px] text-fg-muted font-medium">Max Concurrency</p>'
      + '<p class="text-[10px] text-fg-faint">0 = global default</p>'
      + '</div>'
      + '<div class="flex items-center gap-2">'
      + '<button onclick="adjustAccountConcurrency(\'' + escJs(name) + '\', -1)" class="w-6 h-6 rounded-md border border-border flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-2 text-[12px] font-medium">&minus;</button>'
      + '<span id="accConc_' + esc(name) + '" class="text-[12px] font-semibold tabular-nums w-6 text-center">' + (acc.maxConcurrency || 0) + '</span>'
      + '<button onclick="adjustAccountConcurrency(\'' + escJs(name) + '\', 1)" class="w-6 h-6 rounded-md border border-border flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-2 text-[12px] font-medium">+</button>'
      + '</div>'
      + '</div></div>';

    // Per-account proxy control
    var proxySection = '<div class="mt-3 pt-3 border-t border-border">'
      + '<div class="mb-2">'
      + '<p class="text-[11px] text-fg-muted font-medium">Proxy</p>'
      + '<p class="text-[10px] text-fg-faint">Leave empty to use global proxy</p>'
      + '</div>'
      + '<div class="flex items-center gap-2">'
      + '<input id="accProxy_' + esc(name) + '" type="text" value="' + escAttr(acc.proxy || '') + '" placeholder="socks5://... or http://..."'
      + ' class="flex-1 text-[11px] bg-surface-0 border border-border-subtle rounded-lg px-2.5 py-1.5 text-fg font-mono'
      + ' focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/10 placeholder-fg-faint transition-all">'
      + '<button onclick="saveAccountProxy(\'' + escJs(name) + '\')" id="accProxySaveBtn_' + esc(name) + '"'
      + ' class="text-[11px] border border-border text-fg-muted hover:text-fg hover:bg-surface-2 px-2.5 py-1.5 rounded-lg font-medium transition-colors shrink-0">Save</button>'
      + '</div>'
      + '<div id="accProxyStatus_' + esc(name) + '" class="mt-1 text-[10px] text-fg-faint"></div>'
      + '</div>';

    $body.innerHTML = '<div class="space-y-1 fade-in">'
      + detailRow('Status', acc && acc.healthy
        ? '<span class="text-emerald-600 dark:text-emerald-400 font-medium">Healthy</span>'
        : '<span class="text-red-600 dark:text-red-400 font-medium">Unhealthy</span>')
      + (acc ? detailRow('Requests', String(acc.requestCount || 0)) : '')
      + '</div>'
      + concurrencySection
      + proxySection
      + profileSection
      + planSection
      + quotaSection
      + usageSection
      + '<div class="mt-3 pt-3 border-t border-border space-y-2">'
      + '<div class="grid grid-cols-2 gap-2">'
      + '<button onclick="fetchUsage(\'' + escJs(name) + '\')" id="usageBtn"'
      + ' class="text-[11px] border border-border text-fg-muted hover:text-fg py-2 rounded-lg transition-colors font-medium hover:bg-surface-1">Fetch Usage</button>'
      + '<button onclick="refreshQuota(\'' + escJs(name) + '\')" id="quotaRefreshBtn"'
      + ' class="text-[11px] border border-border text-fg-muted hover:text-fg py-2 rounded-lg transition-colors font-medium hover:bg-surface-1">Refresh Quota</button>'
      + '</div>'
      + '<div id="usageResult" class="hidden"></div>'
      + '<button onclick="deleteAccount(\'' + escJs(name) + '\')" id="deleteAccountBtn"'
      + ' class="w-full text-[11px] border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 py-2 rounded-lg transition-colors font-medium">Delete Account</button>'
      + '</div>';
  } catch (e) {
    $body.innerHTML = '<p class="text-red-600 dark:text-red-400 text-[11px]">Failed to load: ' + esc(e.message) + '</p>';
  }
}
