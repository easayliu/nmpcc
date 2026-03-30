// ── Utility Functions ──

function formatUptime(s) {
  if (typeof s !== 'number') return '--';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return diff + 's ago';
  return Math.floor(diff / 60) + 'm ago';
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function formatTokens(n) {
  if (!n || n === 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatBillingType(bt) {
  if (!bt) return '';
  return bt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatPlanName(profile) {
  if (!profile) return '';
  var tier = profile.rateLimitTier || '';
  var sub = profile.subscriptionType || '';
  var m = tier.match(/max[_\s]*(\d+x)/i);
  if (m) return 'Max ' + m[1].toUpperCase();
  if (sub === 'max') return 'Max';
  if (sub === 'pro') return 'Pro';
  if (sub) return sub.charAt(0).toUpperCase() + sub.slice(1);
  return '';
}

function formatResetTime(ts) {
  if (!ts) return '';
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'resetting...';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `resets in ${h}h ${m}m`;
  return `resets in ${m}m`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function label(key) {
  return { maxConcurrency: 'Max Concurrency', maxTurns: 'Max Turns' }[key] || key;
}
