/** 時間語義工具：只做字串 → 數值區間，不假造精度。 */

/** ISO 或年／年月 → epoch ms（取該精度起點）。無法解析回 null。 */
export function parseTime(value?: string | null): number | null {
  if (!value) return null;
  const s = String(value).trim();
  if (s === '' || s === 'unknown' || s === 'null') return null;
  let m = /^(-?\d{4})$/.exec(s);
  if (m) return Date.UTC(Number(m[1]), 0, 1);
  m = /^(-?\d{4})-(\d{1,2})$/.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
  m = /^(-?\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** 該時間點所代表的區間終點（用於「未提供結束時間」的期間判斷）。 */
export function parseTimeEnd(value?: string | null): number | null {
  if (!value) return null;
  const s = String(value).trim();
  let m = /^(-?\d{4})$/.exec(s);
  if (m) return Date.UTC(Number(m[1]) + 1, 0, 1) - 1;
  m = /^(-?\d{4})-(\d{1,2})$/.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]), 1) - 1;
  m = /^(-?\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1) - 1;
  return parseTime(s);
}

export function yearOf(ms: number): number {
  return new Date(ms).getUTCFullYear();
}

const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = FMT_CACHE.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('zh-TW', { timeZone: 'UTC', ...opts });
    FMT_CACHE.set(key, f);
  }
  return f;
}

/** 依時間精度顯示，避免把「2023」顯示成精確日期。 */
export function formatTime(value?: string | null, precision?: string | null): string {
  if (!value) return '時間未知';
  const s = String(value).trim();
  if (/^-?\d{4}$/.test(s)) return `${s} 年`;
  if (/^-?\d{4}-\d{1,2}$/.test(s)) {
    const [y, m] = s.split('-');
    return `${y} 年 ${Number(m)} 月`;
  }
  const ms = parseTime(s);
  if (ms == null) return s;
  if (precision === 'circa') return `約 ${fmt({ year: 'numeric' }).format(ms)}`;
  if (precision === 'exact_day' || /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  }
  return fmt({ year: 'numeric', month: '2-digit' }).format(ms);
}

export function formatRange(start?: string | null, end?: string | null, precision?: string | null): string {
  if (!start && !end) return '時間未知';
  if (start && !end) return `${formatTime(start, precision)} 起`;
  if (!start && end) return `截至 ${formatTime(end, precision)}`;
  return `${formatTime(start, precision)} – ${formatTime(end, precision)}`;
}

export function formatTimestamp(iso?: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
}

export function isTimePrecisionSupported(p: string): boolean {
  return ['exact_day', 'month', 'year', 'range', 'circa', 'period', 'unknown'].includes(p);
}
