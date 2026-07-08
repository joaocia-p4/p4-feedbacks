// p4-data.jsx — mock data + shared helpers for the P4 shell screens.
// A CLIENT groups one or more marketplace accounts ("contas"); ads run only on
// the five supported marketplaces. Replace these arrays with DB reads later.

const AD_MARKETPLACES = ['Mercado Livre', 'Shopee', 'Magalu', 'Amazon', 'Tiktok'];

const MK = {
  'Mercado Livre': { short: 'ML',  brand: '#FFE600', ink: '#8A7400' },
  'Shopee':        { short: 'SHP', brand: '#EE4D2D', ink: '#CC3D1D' },
  'Magalu':        { short: 'MGL', brand: '#0E89FF', ink: '#0A6FCC' },
  'Amazon':        { short: 'AMZ', brand: '#232F3E', ink: '#232F3E' },
  'Tiktok':        { short: 'TT',  brand: '#FE2858', ink: '#D6123F' },
};

function hexToRgba(hex, a) {
  const h = (hex || '#888').replace('#', '');
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(f, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function mkBrand(name) { return (MK[name] || { brand: '#888' }).brand; }
function mkColor(name) { return (MK[name] || { ink: '#555' }).ink; }
function mkBg(name) { return hexToRgba(mkBrand(name), 0.13); }

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function brShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[(+m) - 1]} ${y.slice(2)}`;
}
function brRange(ini, fim) {
  if (!ini || !fim) return '—';
  const [, mi, di] = ini.split('-');
  const [yf, mf, df] = fim.split('-');
  return `${di}/${mi} – ${df}/${mf} ${yf.slice(2)}`;
}

const USERS = [
  { id: 'u1', nome: 'Diego Martins', email: 'diego@metodop4.com', papel: 'admin', iniciais: 'DM' },
  { id: 'u2', nome: 'Ana Prado', email: 'ana@metodop4.com', papel: 'analista', iniciais: 'AP' },
  { id: 'u3', nome: 'Bruno Reis', email: 'bruno@metodop4.com', papel: 'analista', iniciais: 'BR' },
  { id: 'u4', nome: 'Carla Nunes', email: 'carla@metodop4.com', papel: 'analista', iniciais: 'CN' },
];

const iso = (dt) => dt.toISOString().slice(0, 10);

// build a marketplace account's report history (newest-first)
function genReports(prefix, seed) {
  const out = [];
  let fat = seed.fat, roas = seed.roas, acos = seed.acos;
  let end = new Date(seed.last + 'T00:00:00');
  for (let i = 0; i < seed.n; i++) {
    const fim = new Date(end); const ini = new Date(end); ini.setDate(ini.getDate() - 6);
    out.push({
      id: `${prefix}-r${seed.n - i}`,
      periodoIni: iso(ini), periodoFim: iso(fim),
      faturamento: fat, roas: roas, acos: acos,
      ok: roas >= seed.metaRoas,
      criadoEm: iso(fim),
    });
    fat = Math.round(fat * (0.86 + (i % 3) * 0.05));
    roas = +(roas * (0.94 + (i % 2) * 0.06)).toFixed(2);
    acos = +(acos * (1.04 - (i % 2) * 0.03)).toFixed(2);
    end.setDate(end.getDate() - 7);
  }
  return out;
}

function conta(clientId, mk, seed) {
  return {
    id: `${clientId}-${MK[mk].short.toLowerCase()}`,
    marketplace: mk,
    conta: seed.conta || '',
    metaRoas: seed.metaRoas,
    metaInvestimento: seed.metaInvestimento || '20,00',
    metaAcos: seed.metaAcos || '20,00',
    metaTacos: seed.metaTacos || '15,00',
    dataEntrada: seed.dataEntrada || null,
    dataEncerramento: seed.dataEncerramento || null,
    ativo: seed.ativo !== false,
    pausado: seed.pausado === true,
    motivoPausa: seed.motivoPausa || '',
    last: seed.last,
    status: (new Date('2026-06-22') - new Date(seed.last + 'T00:00:00')) / 86400000 > 9 ? 'atrasado' : 'em-dia',
    reports: genReports(`${clientId}-${MK[mk].short}`, seed),
  };
}

// raw client definitions — contas defined inline
const RAW = [
  { id: 'c1', loja: 'Casa & Conforto', tipo: 'Loja', analista: 'Ana Prado', contas: [
    ['Mercado Livre', { fat: 184200, roas: 5.12, acos: 18.4, metaRoas: 4, last: '2026-06-22', n: 24, dataEntrada: '2024-08-01' }],
    ['Shopee',        { fat: 71400,  roas: 4.05, acos: 22.1, metaRoas: 4, last: '2026-06-22', n: 16, dataEntrada: '2025-01-10' }],
  ] },
  { id: 'c2', loja: 'TechNova Store', tipo: 'Loja', analista: 'Bruno Reis', contas: [
    ['Amazon',        { fat: 312800, roas: 6.30, acos: 14.1, metaRoas: 4.5, last: '2026-06-21', n: 31 }],
    ['Mercado Livre', { fat: 198400, roas: 5.48, acos: 17.0, metaRoas: 4.5, last: '2026-06-21', n: 28 }],
    ['Tiktok',        { fat: 64200,  roas: 3.71, acos: 26.9, metaRoas: 4,   last: '2026-06-08', n: 6 }],
  ] },
  { id: 'c3', loja: 'Moda Viva', tipo: 'Marca', analista: 'Carla Nunes', contas: [
    ['Shopee',        { fat: 96400,  roas: 3.42, acos: 26.7, metaRoas: 4, last: '2026-06-08', n: 12, dataEntrada: '2024-05-20' }],
    ['Tiktok',        { fat: 58300,  roas: 4.88, acos: 19.4, metaRoas: 4, last: '2026-06-22', n: 9, dataEntrada: '2025-02-01', dataEncerramento: '2026-04-20', ativo: false }],
  ] },
  { id: 'c4', loja: 'Pet Família', tipo: 'Loja', analista: 'Ana Prado', contas: [
    ['Mercado Livre', { fat: 142600, roas: 4.78, acos: 19.9, metaRoas: 4, last: '2026-06-22', n: 18 }],
  ] },
  { id: 'c5', loja: 'Verde Folha Cosméticos', tipo: 'Marca', analista: 'Bruno Reis', contas: [
    ['Magalu',        { fat: 78900,  roas: 3.88, acos: 23.1, metaRoas: 4, last: '2026-06-09', n: 9 }],
    ['Amazon',        { fat: 61200,  roas: 4.42, acos: 20.0, metaRoas: 4, last: '2026-06-22', n: 11 }],
  ] },
  { id: 'c6', loja: 'Atlético Suplementos', tipo: 'Loja', analista: 'Carla Nunes', contas: [
    ['Amazon',        { fat: 256300, roas: 5.64, acos: 16.2, metaRoas: 4.5, last: '2026-06-22', n: 27 }],
  ] },
  { id: 'c7', loja: 'Lar Doce Decor', tipo: 'Loja', analista: 'Ana Prado', contas: [
    ['Shopee',        { fat: 64100,  roas: 4.21, acos: 21.5, metaRoas: 4, last: '2026-06-22', n: 14 }],
    ['Magalu',        { fat: 39800,  roas: 3.64, acos: 24.8, metaRoas: 4, last: '2026-06-05', n: 8 }],
  ] },
  { id: 'c8', loja: 'Kids & Cia', tipo: 'Loja', analista: 'Bruno Reis', contas: [
    ['Tiktok',        { fat: 51200,  roas: 2.97, acos: 31.8, metaRoas: 4, last: '2026-06-01', n: 7, dataEntrada: '2024-03-10', dataEncerramento: '2026-05-15', ativo: false }],
  ] },
  { id: 'c9', loja: 'Gourmet Express', tipo: 'Marca', analista: 'Carla Nunes', contas: [
    ['Magalu',        { fat: 173400, roas: 5.05, acos: 18.0, metaRoas: 4, last: '2026-06-22', n: 21 }],
    ['Mercado Livre', { fat: 121900, roas: 4.66, acos: 19.2, metaRoas: 4, last: '2026-06-22', n: 19 }],
  ] },
  // Onboarding (manual): não é cobrado por atraso mesmo sem relatório no ciclo.
  { id: 'c10', loja: 'Aurora Skincare', tipo: 'Marca', analista: 'Ana Prado', situacao: 'onboarding', contas: [
    ['Mercado Livre', { fat: 8200, roas: 2.10, acos: 34.0, metaRoas: 4, last: '2026-05-30', n: 1, dataEntrada: '2026-06-15' }],
  ] },
  // Pausado (cliente): contrato em renegociação; fora da cobrança.
  { id: 'c11', loja: 'BellaCasa Enxovais', tipo: 'Loja', analista: 'Bruno Reis', situacao: 'pausado', motivoPausa: 'Contrato em renegociação — retomada prevista para agosto', contas: [
    ['Shopee',        { fat: 44100, roas: 3.10, acos: 28.0, metaRoas: 4, last: '2026-05-25', n: 10 }],
    ['Magalu',        { fat: 30500, roas: 2.85, acos: 30.2, metaRoas: 4, last: '2026-05-25', n: 8 }],
  ] },
  // Ativo com UMA conta pausada (verba pausada pelo cliente) — as demais cobram normal.
  { id: 'c12', loja: 'Trilha Outdoor', tipo: 'Loja', analista: 'Carla Nunes', contas: [
    ['Amazon',        { fat: 98700, roas: 4.90, acos: 18.7, metaRoas: 4, last: '2026-06-22', n: 15 }],
    ['Mercado Livre', { fat: 52300, roas: 3.40, acos: 27.5, metaRoas: 4, last: '2026-05-20', n: 9, pausado: true, motivoPausa: 'Verba pausada pelo cliente' }],
  ] },
];

// feedback send schedule helpers ------------------------------------------------
const WEEKDAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const WEEKDAYS_SHORT = { Segunda: 'Seg', 'Terça': 'Ter', Quarta: 'Qua', Quinta: 'Qui', Sexta: 'Sex', 'Sábado': 'Sáb', Domingo: 'Dom' };
function diaSemanaFull(wd) {
  const map = { Segunda: 'segunda-feira', 'Terça': 'terça-feira', Quarta: 'quarta-feira', Quinta: 'quinta-feira', Sexta: 'sexta-feira', 'Sábado': 'sábado', Domingo: 'domingo' };
  return map[wd] || (wd || '').toLowerCase();
}
function agendaLabel(a) {
  if (!a) return '—';
  if (a.freq === 'Mensal') return `Todo dia ${a.diaMes}`;
  const pre = (a.diaSemana === 'Sábado' || a.diaSemana === 'Domingo') ? 'Todo' : 'Toda';
  const d = diaSemanaFull(a.diaSemana);
  return `${pre} ${d}`;
}
function agendaShort(a) {
  if (!a) return '—';
  if (a.freq === 'Mensal') return `Dia ${a.diaMes}`;
  const plural = { Segunda: 'Segundas', 'Terça': 'Terças', Quarta: 'Quartas', Quinta: 'Quintas', Sexta: 'Sextas', 'Sábado': 'Sábados', Domingo: 'Domingos' }[a.diaSemana] || a.diaSemana;
  return plural;
}

// "is this client's feedback due on this date?" -----------------------------------
const WD_FROM_IDX = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
function localISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function weekdayName(isoStr) { return WD_FROM_IDX[new Date(isoStr + 'T00:00:00').getDay()]; }
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
function isDueOn(agenda, isoStr) {
  if (!agenda || !isoStr) return false;
  const d = new Date(isoStr + 'T00:00:00');
  if (agenda.freq === 'Mensal') return d.getDate() === agenda.diaMes;
  if (WD_FROM_IDX[d.getDay()] !== agenda.diaSemana) return false;
  return true; // Semanal
}
const P4_TODAY = localISO(new Date());

// schedule-aware overdue: did a scheduled send date pass without a newer report?
const JS_DOW = { Segunda: 1, 'Ter\u00e7a': 2, Quarta: 3, Quinta: 4, Sexta: 5, 'S\u00e1bado': 6, Domingo: 0 };
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function prevScheduled(agenda, ref) {
  if (!agenda) return null;
  let d = new Date(ref);
  if (agenda.freq === 'Mensal') {
    if (d.getDate() >= agenda.diaMes) d.setDate(agenda.diaMes);
    else { d.setMonth(d.getMonth() - 1); d.setDate(agenda.diaMes); }
    return d;
  }
  const target = JS_DOW[agenda.diaSemana];
  let guard = 0;
  while (d.getDay() !== target && guard < 8) { d = addDays(d, -1); guard++; }
  return d;
}
// overdue if the most recent scheduled date BEFORE asOf is newer than the last sent report
function isOverdueBySchedule(agenda, lastSentISO, asOfISO) {
  const asOf = asOfISO || P4_TODAY;
  const yesterday = addDays(new Date(asOf + 'T00:00:00'), -1);
  const ps = prevScheduled(agenda, yesterday);
  if (!ps) return false;
  return localISO(ps) > (lastSentISO || '0000-00-00');
}
// ── Regra por CICLO (espelho do backend lib/p4.js) ──
// Início do ciclo atual: dia seguinte ao penúltimo envio agendado.
function currentCycleStart(agenda, asOfISO) {
  if (!agenda) return null;
  const asOf = new Date((asOfISO || P4_TODAY) + 'T00:00:00');
  const lastSend = prevScheduled(agenda, asOf);
  if (!lastSend) return null;
  const prevSend = prevScheduled(agenda, addDays(lastSend, -1));
  if (!prevSend) return null;
  return localISO(addDays(prevSend, 1));
}
// em dia se há relatório GERADO dentro do ciclo atual (lastGenISO = data do relatório).
function isOverdueByCycle(agenda, lastGenISO, asOfISO) {
  const start = currentCycleStart(agenda, asOfISO);
  if (!start) return false;
  const gen = lastGenISO ? String(lastGenISO).slice(0, 10) : null;
  return !gen || gen < start;
}

const SAMPLE_AGENDAS = [
  { freq: 'Semanal', diaSemana: 'Segunda' },
  { freq: 'Semanal', diaSemana: 'Terça' },
  { freq: 'Semanal', diaSemana: 'Quarta' },
  { freq: 'Semanal', diaSemana: 'Sexta' },
  { freq: 'Mensal', diaMes: 5 },
  { freq: 'Semanal', diaSemana: 'Segunda' },
  { freq: 'Semanal', diaSemana: 'Quinta' },
  { freq: 'Mensal', diaMes: 1 },
  { freq: 'Semanal', diaSemana: 'Segunda' },
];

const CLIENTS = RAW.map((c, ci) => {
  const contas = c.contas.map(([mk, seed]) => conta(c.id, mk, seed));
  const fatLatest = contas.reduce((a, m) => a + (m.reports[0]?.faturamento || 0), 0);
  const roasW = contas.reduce((a, m) => a + (m.reports[0]?.roas || 0) * (m.reports[0]?.faturamento || 0), 0) / (fatLatest || 1);
  const n = contas.reduce((a, m) => a + m.reports.length, 0);
  const last = contas.reduce((a, m) => (m.last > a ? m.last : a), '0000-00-00');
  const agenda = c.agenda || SAMPLE_AGENDAS[ci % SAMPLE_AGENDAS.length];
  // status por CICLO (mesma regra do backend): usa a data do relatório (last) como
  // referência de geração; asOf = último dia completo (ontem).
  const asOfRef = localISO(addDays(new Date(P4_TODAY + 'T00:00:00'), -1));
  // conta pausada não cobra → status "pausado"; senão pela regra de ciclo
  contas.forEach((m) => { m.status = m.pausado ? 'pausado' : (isOverdueByCycle(agenda, m.last, asOfRef) ? 'atrasado' : 'em-dia'); });
  // ── situação e tag do cliente (espelho de lib/clientAggregate.js) ──
  const situacao = c.situacao || 'ativo';
  const encerrado = contas.length > 0 && contas.every((m) => m.ativo === false);
  const ativas = contas.filter((m) => m.ativo !== false);
  const cobraveis = ativas.filter((m) => !m.pausado); // cobram relatório
  const pausadoAll = ativas.length > 0 && ativas.every((m) => m.pausado);
  const pausado = situacao === 'pausado' || pausadoAll;
  const onboarding = situacao === 'onboarding';
  const atrasado = cobraveis.some((m) => isOverdueByCycle(agenda, m.last, asOfRef));
  const precisaHoje =
    !encerrado && !pausado && !onboarding &&
    isDueOn(agenda, P4_TODAY) &&
    cobraveis.some((m) => isOverdueByCycle(agenda, m.last, P4_TODAY));
  // precedência: Encerrado > Pausado > Onboarding > Atrasado > Enviar hoje > Em dia
  const statusTag = encerrado ? 'encerrado'
    : pausado ? 'pausado'
    : onboarding ? 'onboarding'
    : atrasado ? 'atrasado'
    : precisaHoje ? 'hoje'
    : 'em-dia';
  const status = atrasado ? 'atrasado' : 'em-dia'; // compat
  const overdueSched = atrasado; // compat com consumidores antigos
  const baseAtraso = cobraveis.length ? cobraveis : (ativas.length ? ativas : contas);
  const lastWorst = baseAtraso.reduce((a, m) => (m.last < a ? m.last : a), '9999-12-31');
  return {
    ...c, contas, agenda, lastWorst, overdueSched,
    marketplaces: contas.map((m) => m.marketplace),
    fatLatest, roasW: +roasW.toFixed(2), n, last,
    situacao, motivoPausa: c.motivoPausa || '',
    pausado, onboarding, precisaHoje, statusTag, status, encerrado,
  };
});

function fmtMoney(n) {
  return 'R$ ' + Math.round(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtMoneyShort(n) {
  if (n >= 1000) return 'R$ ' + (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace('.', ',') + 'k';
  return 'R$ ' + Math.round(n);
}

Object.assign(window, {
  P4_USERS: USERS, P4_CLIENTS: CLIENTS, P4_MK: MK, P4_AD_MARKETPLACES: AD_MARKETPLACES,
  P4_WEEKDAYS: WEEKDAYS, P4_WEEKDAYS_SHORT: WEEKDAYS_SHORT, P4_TODAY,
  mkColor, mkBg, mkBrand, brShort, brRange, fmtMoney, fmtMoneyShort, agendaLabel, agendaShort, isDueOn, weekdayName,
});
