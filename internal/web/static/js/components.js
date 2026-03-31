import { html } from './lib.js';
import { hashCode, formatPlanName, planBadgeColors } from './utils.js';

// ── Icons ──
export const UpArrowIcon = () => html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v8m0-8l-3 3m3-3l3 3"/><circle cx="12" cy="12" r="10"/></svg>`;
export const ChartIcon = () => html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M7 16l4-4 4 4 6-6"/></svg>`;
export const HeartIcon = () => html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 116.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z"/></svg>`;
export const BoltIcon = () => html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`;
export const DollarIcon = () => html`<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>`;

// ── Stat Card ──
export function StatCard({ label, value, icon, accentColor }) {
  const ring = accentColor ? `border-${accentColor}-200 dark:border-${accentColor}-900/40` : 'border-border';
  return html`
    <div class="bg-surface-1 border ${ring} rounded-xl px-3 sm:px-4 py-3 sm:py-3.5 card-lift">
      <div class="flex items-center justify-between mb-2">
        <p class="text-[10px] text-fg-faint uppercase tracking-wider font-semibold">${label}</p>
        <span class="text-fg-faint/50 hidden sm:inline">${icon}</span>
      </div>
      <p class="text-[16px] sm:text-[20px] font-semibold tabular-nums tracking-tight leading-none">${value}</p>
    </div>`;
}

// ── Usage Bars ──
export function UsageBar({ pct, compact }) {
  const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500';
  const textColor = pct > 80 ? 'text-red-600 dark:text-red-400' : pct > 50 ? 'text-amber-600 dark:text-amber-400' : 'text-fg';
  const w = compact ? 'w-12' : 'w-16';
  const h = compact ? 'h-1' : 'h-1.5';
  return html`
    <div class="flex items-center gap-2">
      <div class="${w} bg-surface-2 rounded-full ${h}"><div class="${color} ${h} rounded-full transition-all duration-500" style="width:${Math.min(pct, 100)}%"></div></div>
      <span class="${textColor} tabular-nums font-semibold text-[11px]">${pct}%</span>
    </div>`;
}

export function MiniUsageBar({ label, pct, resetText }) {
  if (pct == null) return null;
  const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500';
  return html`
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between mb-0.5">
        <span class="text-[10px] text-fg-faint font-medium uppercase tracking-wider">${label}</span>
        <span class="text-[10px] text-fg-muted tabular-nums font-semibold">${pct}%</span>
      </div>
      <div class="w-full bg-surface-2 rounded-full h-1"><div class="${color} h-1 rounded-full transition-all duration-500" style="width:${Math.min(pct, 100)}%"></div></div>
      ${resetText && html`<div class="text-[10px] text-fg-faint mt-0.5 tabular-nums">${resetText}</div>`}
    </div>`;
}

export function UsageBarFull({ label, pct, resets }) {
  if (pct == null) return null;
  const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500';
  const textColor = pct > 80 ? 'text-red-600 dark:text-red-400' : pct > 50 ? 'text-amber-600 dark:text-amber-400' : 'text-fg';
  return html`
    <div>
      <div class="flex items-center justify-between mb-1">
        <span class="text-[11px] text-fg-muted">${label}</span>
        <span class="text-[11px] ${textColor} font-semibold tabular-nums">${pct}%</span>
      </div>
      <div class="w-full bg-surface-2 rounded-full h-1.5"><div class="${color} h-1.5 rounded-full transition-all duration-500" style="width:${Math.min(pct, 100)}%"></div></div>
      ${resets && html`<div class="text-[10px] text-fg-faint mt-0.5 tabular-nums">${resets}</div>`}
    </div>`;
}

// ── Plan Badge ──
export function PlanBadge({ profile, size }) {
  if (!profile) return null;
  const plan = formatPlanName(profile);
  if (!plan) return null;
  const c = planBadgeColors(plan);
  const sz = size === 'sm' ? 'text-[9px] px-1 py-0.5' : 'text-[10px] px-1.5 py-0.5';
  return html` <span class="${sz} ${c[0]} ${c[1]} border ${c[2]} rounded-md font-medium">${plan}</span>`;
}

// ── Detail Rows ──
export function DetailRow({ label, children }) {
  return html`
    <div class="flex items-center justify-between py-2 border-b border-border-subtle last:border-0">
      <span class="text-fg-muted">${label}</span>
      <span class="text-fg">${children}</span>
    </div>`;
}

export function DetailRowCompact({ label, children }) {
  return html`
    <div class="flex items-center justify-between py-1">
      <span class="text-fg-faint text-[11px]">${label}</span>
      <span class="text-fg tabular-nums text-[11px] font-medium">${children}</span>
    </div>`;
}

// ── Avatar ──
export function Avatar({ name, size }) {
  const hue = hashCode(name) % 360;
  const initials = name.slice(0, 2).toUpperCase();
  const sz = size === 'lg' ? 'w-9 h-9 text-[11px]' : size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-8 h-8 text-[10px]';
  return html`
    <div class="${sz} rounded-lg flex items-center justify-center font-bold tracking-tight shrink-0"
         style="background:hsl(${hue},40%,92%);color:hsl(${hue},50%,35%)">${initials}</div>`;
}

// ── Empty State ──
export function EmptyState({ icon, title, action, onAction }) {
  return html`
    <div class="border-2 border-dashed border-border rounded-2xl py-12 flex flex-col items-center gap-2">
      <div class="w-10 h-10 rounded-xl bg-surface-1 border border-border flex items-center justify-center text-fg-faint">${icon}</div>
      <p class="text-[12px] text-fg-muted font-medium">${title}</p>
      ${action && html`<button onclick=${onAction} class="text-[12px] text-accent hover:underline underline-offset-2 font-medium">${action}</button>`}
    </div>`;
}

// ── Spinner ──
export function Spinner() {
  return html`<div class="flex justify-center py-12"><div class="w-5 h-5 border-2 border-accent border-t-transparent rounded-full spin"></div></div>`;
}
