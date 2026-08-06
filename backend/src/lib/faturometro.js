// faturometro — matemática pura do Faturômetro. Sem banco, sem rede.
// Um "pedido" aqui é sempre uma LINHA DO LIVRO (faturometro_orders); a resposta
// crua da API do Mercado Livre só aparece em orderRow(), que converte uma na outra.
const { businessDateISO, businessTimezone } = require('./p4');
const { monthRange } = require('./monthlyClosing');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Formatador de hora memoizado. Construir um Intl.DateTimeFormat é caro (medido:
// 9.000 construções = 225 ms; içado, 6 ms) e este está no caminho quente — um GET
// do Faturômetro formata hoje + ontem + o dia equivalente do mês anterior, duas
// vezes cada. Numa carteira com alguns milhares de pedidos/dia isso viravam
// centenas de ms de CPU SÍNCRONA por request, travando o event loop a cada 30 s e
// disputando espaço com o orçamento de resposta do webhook.
//
// A memo é CHAVEADA pelo fuso: os testes trocam BUSINESS_TZ em tempo de execução
// e uma memo de valor único devolveria o formatador do fuso antigo.
let fmtCache = null;
let fmtCacheTz = null;
function timeFormatter() {
  const tz = businessTimezone();
  if (!fmtCache || fmtCacheTz !== tz) {
    fmtCacheTz = tz;
    fmtCache = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23', // garante 00 (e não 24) à meia-noite; hour12:false varia entre versões do ICU
    });
  }
  return fmtCache;
}

// 'HH:MM:SS' de um instante no fuso do negócio.
function businessTimeOf(value) {
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d)) return '00:00:00';
  return timeFormatter().format(d);
}

function businessHourOf(value) {
  return Number(businessTimeOf(value).slice(0, 2)) || 0;
}

// Anda dias numa data pura. Meio-dia UTC para não escorregar por fuso/DST.
function addDaysISO(iso, n) {
  const d = new Date(String(iso) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}

function sumOrders(orders) {
  const list = orders || [];
  let faturamento = 0;
  let unidades = 0;
  const compradores = new Set();
  for (const o of list) {
    faturamento += Number(o.total_amount) || 0;
    unidades += Number(o.unidades) || 0;
    if (o.comprador_id) compradores.add(String(o.comprador_id));
  }
  faturamento = round2(faturamento);
  return {
    faturamento,
    pedidos: list.length,
    unidades,
    compradores: compradores.size,
    // Preço médio é por UNIDADE, não por pedido — é assim que o painel do ML mostra.
    precoMedio: unidades > 0 ? round2(faturamento / unidades) : 0,
  };
}

// Recorte "até o mesmo horário": o que impede a tela de acusar queda toda manhã
// por comparar meio dia contra um dia inteiro.
function untilTimeOfDay(orders, hhmmss) {
  const limite = String(hhmmss || '23:59:59');
  return (orders || []).filter((o) => businessTimeOf(o.criado_em_ml) <= limite);
}

function hourlySeries(hoje, ontem) {
  const zeros = () => Array.from({ length: 24 }, () => 0);
  const a = zeros();
  const b = zeros();
  for (const o of hoje || []) a[businessHourOf(o.criado_em_ml)] += Number(o.total_amount) || 0;
  for (const o of ontem || []) b[businessHourOf(o.criado_em_ml)] += Number(o.total_amount) || 0;
  return a.map((_, h) => ({ h, hoje: round2(a[h]), ontem: round2(b[h]) }));
}

// null quando não há base de comparação — a tela mostra "—", nunca "+∞".
function variacao(atual, anterior) {
  const base = Number(anterior) || 0;
  if (base === 0) return null;
  return Math.round(((Number(atual) || 0) - base) / base * 10000) / 10000;
}

// Janela equivalente do mês anterior. `parcial:false` sinaliza a borda em que o
// mês anterior não tem o dia de hoje (hoje é 31, ele tem 30) — aí compara-se com
// o mês INTEIRO e a tela troca o rótulo.
function previousMonthWindow(hojeISO) {
  const [y, m, d] = String(hojeISO).split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const ym = `${py}-${String(pm).padStart(2, '0')}`;

  const range = monthRange(ym);
  const ultimoDia = Number(range.fim.split('-')[2]);
  const dd = (n) => `${ym}-${String(n).padStart(2, '0')}`;

  if (d > ultimoDia) {
    return { ym, completosAte: range.fim, diaParcial: null, parcial: false };
  }
  return { ym, completosAte: d === 1 ? null : dd(d - 1), diaParcial: dd(d), parcial: true };
}

// Resposta crua de GET /orders/{id} → linha do livro. null quando o pedido não
// tem o mínimo (id + data de criação) para ser contado.
function orderRow(raw, accountId) {
  if (!raw || raw.id == null || !raw.date_created) return null;
  const unidades = (raw.order_items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  return {
    order_id: String(raw.id),
    account_id: accountId,
    dia: businessDateISO(raw.date_created),
    criado_em_ml: String(raw.date_created),
    total_amount: round2(raw.total_amount),
    unidades,
    comprador_id: raw.buyer && raw.buyer.id != null ? String(raw.buyer.id) : null,
  };
}

module.exports = {
  round2, businessTimeOf, businessHourOf, addDaysISO, sumOrders,
  untilTimeOfDay, hourlySeries, variacao, previousMonthWindow, orderRow,
};
