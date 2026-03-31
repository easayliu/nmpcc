export function formatUptime(s) {
  if (typeof s !== 'number') return '--';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return diff + 's ago';
  return Math.floor(diff / 60) + 'm ago';
}

export function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash);
}

export function formatTokens(n) {
  if (!n || n === 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}

export function formatPlanName(profile) {
  if (!profile) return '';
  const tier = profile.rateLimitTier || '';
  const sub = profile.subscriptionType || '';
  const m = tier.match(/max[_\s]*(\d+x)/i);
  if (m) return 'Max ' + m[1].toUpperCase();
  if (sub === 'max') return 'Max';
  if (sub === 'pro') return 'Pro';
  if (sub) return sub.charAt(0).toUpperCase() + sub.slice(1);
  return '';
}

export function formatResetTime(ts) {
  if (!ts) return '';
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'resetting...';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `resets in ${h}h ${m}m`;
  return `resets in ${m}m`;
}

export function planBadgeColors(plan) {
  switch (plan) {
    case 'Max 20X': return ['text-amber-600 dark:text-amber-400', 'bg-amber-50 dark:bg-amber-950/30', 'border-amber-200 dark:border-amber-900/40'];
    case 'Max 5X': return ['text-purple-600 dark:text-purple-400', 'bg-purple-50 dark:bg-purple-950/30', 'border-purple-200 dark:border-purple-900/40'];
    case 'Max': return ['text-indigo-600 dark:text-indigo-400', 'bg-indigo-50 dark:bg-indigo-950/30', 'border-indigo-200 dark:border-indigo-900/40'];
    case 'Pro': return ['text-blue-600 dark:text-blue-400', 'bg-blue-50 dark:bg-blue-950/30', 'border-blue-200 dark:border-blue-900/40'];
    default: return ['text-slate-600 dark:text-slate-400', 'bg-slate-50 dark:bg-slate-950/30', 'border-slate-200 dark:border-slate-900/40'];
  }
}
