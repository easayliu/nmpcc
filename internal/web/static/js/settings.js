import { html, useState, useEffect, useCallback } from './lib.js';
import { api, setApiKey, getApiKey } from './api.js';
import { Spinner } from './components.js';

// ── Setting Row (number stepper) ──
function SettingRow({ label, description, value, onChange }) {
  return html`
    <div class="bg-surface-1 border border-border rounded-xl px-4 sm:px-5 py-3.5 sm:py-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
        <div class="min-w-0">
          <p class="text-[12px] font-semibold text-fg">${label}</p>
          <p class="text-[11px] text-fg-faint mt-0.5">${description}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button onclick=${() => onChange(Math.max(1, value - 1))}
            class="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors text-[14px] font-medium">-</button>
          <span class="text-[14px] font-semibold tabular-nums w-8 text-center">${value}</span>
          <button onclick=${() => onChange(value + 1)}
            class="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-fg-muted hover:text-fg hover:bg-surface-2 transition-colors text-[14px] font-medium">+</button>
        </div>
      </div>
    </div>`;
}

// ── API Key Item ──
function ApiKeyItem({ masked, id, onDelete }) {
  return html`
    <div class="flex items-center justify-between bg-surface-0 border border-border-subtle rounded-lg px-3 py-2 group">
      <div class="flex items-center gap-2.5 min-w-0">
        <svg class="w-3.5 h-3.5 text-fg-faint shrink-0" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
        <code class="text-[11px] font-mono text-fg-muted truncate">${masked}</code>
      </div>
      <button onclick=${() => onDelete(id)} title="Delete this key"
        class="text-[11px] text-fg-faint hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>
    </div>`;
}

// ── Settings Page ──
export function Settings({ onRefresh }) {
  const [settings, setSettings] = useState(null);
  const [keys, setKeys] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [proxyValue, setProxyValue] = useState('');
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState('');
  const [generating, setGenerating] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);

  const showStatus = (msg, type = 'success') => {
    setStatus(msg); setStatusType(type);
    if (type === 'success') setTimeout(() => setStatus(''), 2000);
  };

  const loadSettings = useCallback(async () => {
    try {
      const s = await api('GET', '/api/settings');
      setSettings(s);
      setProxyValue(s.globalProxy || '');
      if (s.apiKeyCount > 0) {
        const data = await api('GET', '/api/apikey');
        setKeys(data.keys || []);
      }
    } catch {
      setSettings({ maxConcurrency: 1, maxTurns: 10, globalProxy: '', apiKeyCount: 0 });
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const updateSetting = async (key, value) => {
    try {
      await api('PUT', '/api/settings', { [key]: value });
      setSettings(s => ({ ...s, [key]: value }));
      showStatus(`${key === 'maxConcurrency' ? 'Max Concurrency' : 'Max Turns'} updated to ${value}`);
    } catch (e) { showStatus('Failed: ' + e.message, 'error'); }
  };

  const saveProxy = async () => {
    setProxySaving(true);
    try {
      await api('PUT', '/api/proxy', { proxy: proxyValue.trim() });
      showStatus('Global proxy updated');
    } catch (e) { showStatus('Failed: ' + e.message, 'error'); }
    setProxySaving(false);
  };

  const generateKey = async () => {
    setGenerating(true);
    try {
      const data = await api('POST', '/api/apikey');
      setNewKey(data.key);
      const keysData = await api('GET', '/api/apikey');
      setKeys(keysData.keys || []);
    } catch (e) { showStatus('Failed: ' + e.message, 'error'); }
    setGenerating(false);
  };

  const deleteKey = async (keyId) => {
    if (!confirm('Delete this API key? Clients using it will lose access.')) return;
    try {
      await api('DELETE', '/api/apikey', { key: keyId });
      const data = await api('GET', '/api/apikey');
      setKeys(data.keys || []);
      showStatus('API key deleted.');
    } catch (e) { showStatus('Failed: ' + e.message, 'error'); }
  };

  const copyKey = () => {
    navigator.clipboard.writeText(newKey);
    showStatus('Copied to clipboard');
  };

  const useKey = () => {
    setApiKey(newKey);
    showStatus('Key applied to your local session.');
  };

  if (!settings) return html`<div class="p-4 sm:p-6 lg:p-8 page-enter"><div class="mb-6"><h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Settings</h1></div><${Spinner} /></div>`;

  return html`
    <div class="p-4 sm:p-6 lg:p-8 page-enter">
      <div class="mb-6">
        <h1 class="font-serif text-[22px] sm:text-[28px] tracking-tight leading-none">Settings</h1>
        <p class="text-[12px] text-fg-faint mt-1.5 font-medium">Runtime configuration</p>
      </div>

      <div class="space-y-4">
        <${SettingRow} label="Max Concurrency" description="Maximum concurrent requests per account. Higher values increase throughput but may trigger rate limits."
          value=${settings.maxConcurrency} onChange=${v => updateSetting('maxConcurrency', v)} />

        <${SettingRow} label="Max Turns" description="Maximum tool-use turns per CLI request. Set to 1 for pure proxy mode."
          value=${settings.maxTurns} onChange=${v => updateSetting('maxTurns', v)} />

        <!-- Global Proxy -->
        <div class="bg-surface-1 border border-border rounded-xl px-4 sm:px-5 py-3.5 sm:py-4">
          <div class="mb-2">
            <p class="text-[12px] font-semibold text-fg">Global Proxy</p>
            <p class="text-[11px] text-fg-faint mt-0.5">Applied to all accounts without a per-account proxy. Supports socks5:// and http:// protocols.</p>
          </div>
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input type="text" value=${proxyValue} onInput=${e => setProxyValue(e.target.value)}
              placeholder="socks5://127.0.0.1:1080 or http://host:port"
              class="flex-1 text-[12px] bg-surface-0 border border-border-subtle rounded-lg px-3 py-2 text-fg font-mono focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/10 placeholder-fg-faint transition-all min-w-0" />
            <button onclick=${saveProxy} disabled=${proxySaving}
              class="text-[12px] bg-accent text-white hover:opacity-90 px-3 py-2 rounded-lg font-semibold transition-opacity shrink-0">
              ${proxySaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <!-- API Keys -->
        <div class="bg-surface-1 border border-border rounded-xl px-4 sm:px-5 py-3.5 sm:py-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-3">
            <div class="min-w-0">
              <p class="text-[12px] font-semibold text-fg">API Keys</p>
              <p class="text-[11px] text-fg-faint mt-0.5">Keys for /v1/* endpoint authentication. No keys = open access.</p>
            </div>
            <button onclick=${generateKey} disabled=${generating}
              class="text-[12px] bg-accent text-white hover:opacity-90 px-3 py-2 rounded-lg font-semibold transition-opacity shrink-0 flex items-center gap-1.5">
              ${generating
                ? html`<div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full spin"></div> Generating...`
                : html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg> Generate`}
            </button>
          </div>

          <div class="space-y-2">
            ${keys.length === 0
              ? html`<p class="text-[11px] text-fg-faint py-2">No API keys configured. API endpoints are open.</p>`
              : keys.map(k => html`<${ApiKeyItem} key=${k.id} masked=${k.masked} id=${k.id} onDelete=${deleteKey} />`)}
          </div>

          ${newKey && html`
            <div class="mt-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 rounded-lg p-3">
              <p class="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium mb-1">New key generated — copy it now, it won't be shown again:</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-[11px] font-mono text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-900/40 px-2.5 py-1.5 rounded select-all break-all">${newKey}</code>
                <button onclick=${copyKey} class="text-[11px] border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2.5 py-1.5 rounded-lg font-medium shrink-0 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors">Copy</button>
                <button onclick=${useKey} class="text-[11px] border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2.5 py-1.5 rounded-lg font-medium shrink-0 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors">Use</button>
              </div>
            </div>`}
        </div>
      </div>

      ${status && html`
        <div class="mt-4 text-[11px] ${statusType === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}">${status}</div>`}
    </div>`;
}
