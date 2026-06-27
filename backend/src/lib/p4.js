// p4.js — business logic ported 1:1 from the design prototypes
// (p4-data.jsx + report.jsx). This is the single source of truth for the rules
// the README calls "críticas para o backend": supported marketplaces, the send
// schedule, the overdue rule, weighted client ROAS and the metric formulas.
//
// Keeping these identical to the front-end helpers guarantees the API computes
// "atrasado", "ROAS médio", "Faturamento" etc. exactly like the screens expect.

// ── Marketplaces (ads run only on these five) ────────────────────────────────
const AD_MARKETPLACES = ['Mercado Livre', 'Shopee', 'Magalu', 'Amazon', 'Tiktok'];

const MK = {
  'Mercado Livre': { short: 'ML', brand: '#FFE600', ink: '#8A7400' },
  Shopee: { short: 'SHP', brand: '#EE4D2D', ink: '#CC3D1D' },
  Magalu: { short: 'MGL', brand: '#0E89FF', ink: '#0A6FCC' },
  Amazon: { short: 'AMZ', brand: '#232F3E', ink: '#232F3E' },
  Tiktok: { short: 'TT', brand: '#FE2858', ink: '#D6123F' },
};

function isSupportedMarketplace(name) {
  return AD_MARKETPLACES.includes(name);
}

// ── Default goals (BR strings with comma) ────────────────────────────────────
const DEFAULT_METAS = {
  metaInvestimento: '20,00',
  metaRoas: '4,00',
  metaAcos: '20,00',
  metaTacos: '15,00',
};

const OVERDUE_DAYS = 9; // "último relatório há mais de ~9 dias"

// ── Weekdays ─────────────────────────────────────────────────────────────────
const WEEKDAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const WD_FROM_IDX = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const JS_DOW = { Segunda: 1, Terça: 2, Quarta: 3, Quinta: 4, Sexta: 5, Sábado: 6, Domingo: 0 };

const FREQUENCIES = ['Semanal', 'Quinzenal', 'Mensal'];

// ── Date helpers (local-time, matching the prototype) ────────────────────────
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
// Business timezone used to resolve "today"/"now". Keeps the overdue/schedule
// math aligned with the Brazilian screens even when the server runs in UTC
// (Render/Railway/Fly). Internal date-only arithmetic stays server-local and is
// unaffected; only the wall-clock → calendar-date mapping is pinned here.
function businessTimezone() {
  return process.env.BUSINESS_TZ || 'America/Sao_Paulo';
}
// Current calendar date (YYYY-MM-DD) in the business timezone.
function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
// Último dia COMPLETO (ontem). Referência do "atrasado": relatórios são
// retrospectivos e só contamos dias completos — hoje ainda está em aberto.
function lastCompleteDayISO() {
  const d = new Date(todayISO() + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return localISO(d);
}
function weekdayName(isoStr) {
  return WD_FROM_IDX[new Date(isoStr + 'T00:00:00').getDay()];
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
// ISO-8601 week number (Quinzenal = even ISO weeks).
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}

// "Is this client's feedback scheduled (due) on date isoStr?"
function isDueOn(agenda, isoStr) {
  if (!agenda || !isoStr) return false;
  const d = new Date(isoStr + 'T00:00:00');
  if (agenda.freq === 'Mensal') return d.getDate() === agenda.diaMes;
  if (WD_FROM_IDX[d.getDay()] !== agenda.diaSemana) return false;
  if (agenda.freq === 'Quinzenal') return isoWeek(d) % 2 === 0;
  return true; // Semanal
}

// Most recent scheduled occurrence on or before `ref` (a Date).
function prevScheduled(agenda, ref) {
  if (!agenda) return null;
  let d = new Date(ref);
  if (agenda.freq === 'Mensal') {
    if (d.getDate() >= agenda.diaMes) d.setDate(agenda.diaMes);
    else {
      d.setMonth(d.getMonth() - 1);
      d.setDate(agenda.diaMes);
    }
    return d;
  }
  const target = JS_DOW[agenda.diaSemana];
  let guard = 0;
  while (d.getDay() !== target && guard < 8) {
    d = addDays(d, -1);
    guard++;
  }
  if (agenda.freq === 'Quinzenal' && isoWeek(d) % 2 !== 0) d = addDays(d, -7);
  return d;
}

// Overdue-by-schedule: the most recent scheduled date that is already a COMPLETE
// past day (≤ asOf, where asOf = ontem) passed without a newer sent report?
// (lastSentISO = oldest "last" across accounts.)
function isOverdueBySchedule(agenda, lastSentISO, asOfISO) {
  const asOf = asOfISO || lastCompleteDayISO();
  const ps = prevScheduled(agenda, new Date(asOf + 'T00:00:00'));
  if (!ps) return false;
  return localISO(ps) > (lastSentISO || '0000-00-00');
}

// Days between two ISO dates (asOf - lastISO), used for the ~9-day rule.
function daysSince(lastISO, asOfISO) {
  if (!lastISO) return Infinity;
  const asOf = new Date((asOfISO || todayISO()) + 'T00:00:00');
  const last = new Date(lastISO + 'T00:00:00');
  return (asOf - last) / 86400000;
}

// Per-account status: overdue if its last report is older than ~9 complete days
// (reference = ontem; today is incomplete and doesn't count).
function accountStatus(lastISO, asOfISO) {
  return daysSince(lastISO, asOfISO || lastCompleteDayISO()) > OVERDUE_DAYS
    ? 'atrasado'
    : 'em-dia';
}

// ── Schedule labels (handy for responses) ────────────────────────────────────
function diaSemanaFull(wd) {
  const map = {
    Segunda: 'segunda-feira',
    Terça: 'terça-feira',
    Quarta: 'quarta-feira',
    Quinta: 'quinta-feira',
    Sexta: 'sexta-feira',
    Sábado: 'sábado',
    Domingo: 'domingo',
  };
  return map[wd] || (wd || '').toLowerCase();
}
function agendaLabel(a) {
  if (!a) return '—';
  if (a.freq === 'Mensal') return `Todo dia ${a.diaMes}`;
  const pre = a.diaSemana === 'Sábado' || a.diaSemana === 'Domingo' ? 'Todo' : 'Toda';
  const d = diaSemanaFull(a.diaSemana);
  return a.freq === 'Quinzenal' ? `Quinzenal · ${d}` : `${pre} ${d}`;
}

// ── Metric parsing & formulas (from report.jsx) ──────────────────────────────
// BR-formatted string ("1.234,56") → Number.
function parseNum(s) {
  if (s === null || s === undefined) return 0;
  if (typeof s === 'number') return isNaN(s) ? 0 : s;
  const n = parseFloat(String(s).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
// ACOS = investimento / receita via Ads · TACOS = investimento / faturamento.
function calcAcos(o) {
  const inv = parseNum(o.investimento);
  const rec = parseNum(o.receitaAds);
  return rec > 0 ? (inv / rec) * 100 : null;
}
function calcTacos(o) {
  const inv = parseNum(o.investimento);
  const fat = parseNum(o.faturamento);
  return fat > 0 ? (inv / fat) * 100 : null;
}
// ROAS = receita via Ads / investimento.
function calcRoas(o) {
  const inv = parseNum(o.investimento);
  const rec = parseNum(o.receitaAds);
  return inv > 0 ? rec / inv : null;
}
function fmtCalc(n) {
  return n == null ? '' : n.toFixed(2).replace('.', ',');
}
function metricIsAuto(o, k) {
  const f = o[k + 'Auto'];
  return f === undefined ? true : !!f;
}
// Copy of a period with roas/acos/tacos replaced by their computed values
// where the metric is in "auto" mode (default).
function withCalc(o) {
  const out = { ...o };
  if (metricIsAuto(o, 'roas')) {
    const r = calcRoas(o);
    if (r != null) out.roas = fmtCalc(r);
  }
  if (metricIsAuto(o, 'acos')) {
    const a = calcAcos(o);
    out.acos = a == null ? '' : fmtCalc(a);
  }
  if (metricIsAuto(o, 'tacos')) {
    const t = calcTacos(o);
    out.tacos = t == null ? '' : fmtCalc(t);
  }
  return out;
}

// Extract the eight stored numeric metrics from a generator payload, applying
// auto-calc first so derived metrics are persisted as numbers for querying/KPIs.
function deriveNumbers(payload) {
  const c = withCalc(payload || {});
  return {
    faturamento: parseNum(c.faturamento),
    vendas: parseNum(c.vendas),
    receitaAds: parseNum(c.receitaAds),
    vendasAds: parseNum(c.vendasAds),
    investimento: parseNum(c.investimento),
    roas: parseNum(c.roas),
    acos: parseNum(c.acos),
    tacos: parseNum(c.tacos),
  };
}

module.exports = {
  AD_MARKETPLACES,
  MK,
  DEFAULT_METAS,
  FREQUENCIES,
  WEEKDAYS,
  OVERDUE_DAYS,
  isSupportedMarketplace,
  localISO,
  todayISO,
  lastCompleteDayISO,
  businessTimezone,
  weekdayName,
  addDays,
  isoWeek,
  isDueOn,
  prevScheduled,
  isOverdueBySchedule,
  daysSince,
  accountStatus,
  agendaLabel,
  parseNum,
  calcAcos,
  calcTacos,
  calcRoas,
  fmtCalc,
  metricIsAuto,
  withCalc,
  deriveNumbers,
};
