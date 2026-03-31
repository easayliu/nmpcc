import { html, useState, useEffect, useCallback } from './lib.js';
import { formatTokens } from './utils.js';
import { api } from './api.js';
import { Spinner } from './components.js';

// ── Log Table Row (Desktop) ──
function LogRow({ log, showDate }) {
  const t = new Date(log.timestamp * 1000);
  const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = t.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const model = (log.model || 'default').replace('claude-', '').replace('-20250514', '');
  const mode = log.stream ? 'SSE' : 'JSON';
  const dur = log.durationMs < 1000 ? log.durationMs + 'ms' : (log.durationMs / 1000).toFixed(1) + 's';
  const cost = log.totalCostUsd > 0 ? '$' + log.totalCostUsd.toFixed(6) : '--';

  return html`
    <tr class="border-b border-border-subtle last:border-0 table-row-hover transition-colors">
      <td class="px-3 py-2.5 text-fg-faint tabular-nums text-[11px]">${showDate ? date + ' ' : ''}${time}</td>
      <td class="px-3 py-2.5"><span class="font-medium text-[11px]">${log.account}</span></td>
      <td class="px-3 py-2.5"><span class="text-[10px] bg-surface-2 border border-border-subtle px-1.5 py-0.5 rounded font-mono tabular-nums">${model}</span></td>
      <td class="px-3 py-2.5 text-center"><span class="text-[10px] px-1.5 py-0.5 rounded font-medium ${log.stream ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30' : 'text-fg-muted bg-surface-1'}">${mode}</span></td>
      <td class="px-3 py-2.5 text-right tabular-nums text-[11px]">${formatTokens(log.inputTokens)}</td>
      <td class="px-3 py-2.5 text-right tabular-nums text-[11px]">${formatTokens(log.outputTokens)}</td>
      <td class="px-3 py-2.5 text-right text-[10px] tabular-nums">
        ${log.cacheReadInputTokens > 0 ? html`<span class="text-emerald-600 dark:text-emerald-400">R:${formatTokens(log.cacheReadInputTokens)}</span> ` : ''}
        ${log.cacheCreation1h > 0 ? html`<span class="text-amber-600 dark:text-amber-400">1h:${formatTokens(log.cacheCreation1h)}</span> ` : ''}
        ${log.cacheCreation5m > 0 ? html`<span class="text-blue-600 dark:text-blue-400">5m:${formatTokens(log.cacheCreation5m)}</span> ` : ''}
        ${!log.cacheReadInputTokens && !log.cacheCreation1h && !log.cacheCreation5m ? html`<span class="text-fg-faint">--</span>` : ''}
      </td>
      <td class="px-3 py-2.5 text-right tabular-nums text-fg-muted text-[11px]">${dur}</td>
      <td class="px-3 py-2.5 text-right tabular-nums font-medium text-[11px]">${cost}</td>
    </tr>`;
}

// ── Log Mobile Card ──
function LogCard({ log, showDate }) {
  const t = new Date(log.timestamp * 1000);
  const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = t.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const model = (log.model || 'default').replace('claude-', '').replace('-20250514', '');
  const dur = log.durationMs < 1000 ? log.durationMs + 'ms' : (log.durationMs / 1000).toFixed(1) + 's';
  const cost = log.totalCostUsd > 0 ? '$' + log.totalCostUsd.toFixed(6) : '--';

  return html`
    <div class="bg-surface-1 border border-border rounded-xl p-3">
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-[12px] font-semibold text-fg">${log.account}</span>
        <span class="text-[10px] text-fg-faint tabular-nums">${showDate ? date + ' ' : ''}${time}</span>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[10px] bg-surface-2 border border-border-subtle px-1.5 py-0.5 rounded font-mono tabular-nums">${model}</span>
        <span class="text-[10px] text-fg-muted tabular-nums">In:${formatTokens(log.inputTokens)}</span>
        <span class="text-[10px] text-fg-muted tabular-nums">Out:${formatTokens(log.outputTokens)}</span>
        <span class="text-[10px] text-fg-muted tabular-nums">${dur}</span>
        <span class="text-[10px] font-medium tabular-nums">${cost}</span>
      </div>
    </div>`;
}

// ── Filter Bar ──
function FilterBar({ filter, accounts, onChange }) {
  const ranges = [
    { key: '1h', label: '1h' },
    { key: 'today', label: 'Today' },
    { key: '24h', label: '24h' },
    { key: '7d', label: '7d' },
    { key: 'all', label: 'All' },
  ];

  return html`
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 mb-4">
      <select value=${filter.account} onChange=${e => onChange({ ...filter, account: e.target.value, offset: 0 })}
        class="text-[11px] bg-surface-0 border border-border rounded-lg px-2.5 py-1.5 text-fg font-medium focus:outline-none focus:border-accent/40 min-w-0 sm:w-40">
        <option value="">All Accounts</option>
        ${accounts.map(a => html`<option key=${a.name} value=${a.name}>${a.name}</option>`)}
      </select>
      <div class="flex items-center gap-1">
        ${ranges.map(r => html`
          <button key=${r.key} onclick=${() => onChange({ ...filter, range: r.key, offset: 0 })}
            class="text-[11px] px-2.5 py-1.5 rounded-lg font-medium transition-colors ${filter.range === r.key
              ? 'bg-accent text-white'
              : 'bg-surface-1 text-fg-muted hover:text-fg hover:bg-surface-2 border border-border'}">${r.label}</button>`)}
      </div>
      <select value=${filter.limit} onChange=${e => onChange({ ...filter, limit: parseInt(e.target.value), offset: 0 })}
        class="text-[11px] bg-surface-0 border border-border rounded-lg px-2.5 py-1.5 text-fg font-medium focus:outline-none focus:border-accent/40 sm:w-24 sm:ml-auto">
        <option value="100">100</option>
        <option value="200">200</option>
        <option value="500">500</option>
      </select>
    </div>`;
}

// ── Logs Page ──
export function Logs({ accounts }) {
  const [filter, setFilter] = useState({ account: '', range: 'today', limit: 200, offset: 0 });
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState({ count: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async (f) => {
    const params = [];
    if (f.account) params.push('account=' + encodeURIComponent(f.account));
    if (f.limit) params.push('limit=' + f.limit);
    if (f.offset > 0) params.push('offset=' + f.offset);

    const now = Math.floor(Date.now() / 1000);
    if (f.range === 'today') params.push('since=' + Math.floor(new Date().setHours(0, 0, 0, 0) / 1000));
    else if (f.range === '1h') params.push('since=' + (now - 3600));
    else if (f.range === '24h') params.push('since=' + (now - 86400));
    else if (f.range === '7d') params.push('since=' + (now - 604800));

    try {
      const result = await api('GET', '/api/logs' + (params.length ? '?' + params.join('&') : ''));
      if (Array.isArray(result)) {
        setLogs(result);
        let s = { count: result.length, inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
        result.forEach(l => { s.inputTokens += l.inputTokens || 0; s.outputTokens += l.outputTokens || 0; s.totalCostUsd += l.totalCostUsd || 0; });
        setSummary(s);
        setHasMore(false);
      } else {
        setLogs(result.logs || []);
        setSummary(result.summary || { count: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0 });
        setHasMore(result.hasMore || false);
      }
    } catch {
      setLogs([]);
      setSummary({ count: 0, inputTokens: 0, outputTokens: 0, totalCostUsd: 0 });
      setHasMore(false);
    }
  }, []);

  useEffect(() => { setLoading(true); fetchLogs(filter).then(() => setLoading(false)); }, [filter, fetchLogs]);

  const showDate = filter.range !== 'today' && filter.range !== '1h';
  const pageStart = filter.offset + 1;
  const pageEnd = filter.offset + logs.length;

  const headers = ['Time', 'Account', 'Model', 'Mode', 'In', 'Out', 'Cache', 'Duration', 'Cost'];
  const headerAlign = [0, 0, 0, 1, 2, 2, 2, 2, 2]; // 0=left, 1=center, 2=right

  if (loading) return html`
    <div class="p-4 sm:p-6 lg:p-8 page-enter">
      <div class="mb-6"><h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Request Logs</h1>
        <p class="text-[12px] text-fg-faint mt-1.5 font-medium">Loading...</p></div>
      <${Spinner} />
    </div>`;

  return html`
    <div class="p-4 sm:p-6 lg:p-8 page-enter">
      <div class="mb-4">
        <h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Request Logs</h1>
      </div>

      <${FilterBar} filter=${filter} accounts=${accounts} onChange=${setFilter} />

      ${summary.count > 0 && html`
        <div class="flex flex-wrap items-center gap-3 sm:gap-4 text-[11px] text-fg-faint tabular-nums mb-4">
          <span>Total: <strong class="text-fg-muted">${summary.count}</strong> requests</span>
          <span>In: <strong class="text-fg-muted">${formatTokens(summary.inputTokens)}</strong></span>
          <span>Out: <strong class="text-fg-muted">${formatTokens(summary.outputTokens)}</strong></span>
          <span>Cost: <strong class="text-fg-muted">$${summary.totalCostUsd.toFixed(4)}</strong></span>
          ${summary.count > logs.length && html`<span>Showing ${pageStart}-${pageEnd}</span>`}
        </div>`}

      ${logs.length === 0
        ? html`
          <div class="border-2 border-dashed border-border rounded-2xl py-12 flex flex-col items-center gap-2">
            <svg class="w-8 h-8 text-fg-faint/40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            <p class="text-[12px] text-fg-muted font-medium">No requests found</p>
          </div>`
        : html`
          <div class="hidden lg:block border border-border rounded-xl overflow-hidden bg-surface-0 overflow-x-auto">
            <table class="w-full text-[11px] min-w-[700px]">
              <thead><tr class="border-b border-border text-fg-faint bg-surface-1">
                ${headers.map((h, i) => html`<th key=${h} class="${headerAlign[i] === 2 ? 'text-right' : headerAlign[i] === 1 ? 'text-center' : 'text-left'} font-semibold px-3 py-2.5 uppercase tracking-wider text-[10px]">${h}</th>`)}
              </tr></thead>
              <tbody>${logs.map(l => html`<${LogRow} key=${l.timestamp + l.account} log=${l} showDate=${showDate} />`)}</tbody>
            </table>
          </div>
          <div class="lg:hidden space-y-2 stagger">${logs.map(l => html`<${LogCard} key=${l.timestamp + l.account} log=${l} showDate=${showDate} />`)}</div>
        `}

      ${(filter.offset > 0 || hasMore) && html`
        <div class="flex items-center justify-between mt-4">
          <button onclick=${() => setFilter(f => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))} disabled=${filter.offset <= 0}
            class="text-[11px] border border-border text-fg-muted hover:text-fg px-3 py-1.5 rounded-lg font-medium transition-colors ${filter.offset > 0 ? 'hover:bg-surface-1' : 'opacity-40 cursor-not-allowed'}">Previous</button>
          <span class="text-[11px] text-fg-faint tabular-nums">${pageStart}-${pageEnd} of ${summary.count}</span>
          <button onclick=${() => setFilter(f => ({ ...f, offset: f.offset + f.limit }))} disabled=${!hasMore}
            class="text-[11px] border border-border text-fg-muted hover:text-fg px-3 py-1.5 rounded-lg font-medium transition-colors ${hasMore ? 'hover:bg-surface-1' : 'opacity-40 cursor-not-allowed'}">Next</button>
        </div>`}
    </div>`;
}
