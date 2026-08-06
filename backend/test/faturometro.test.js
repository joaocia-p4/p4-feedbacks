// Testes de lib/faturometro — matemática do Faturômetro. Puros, sem banco.
// Roda com `npm test` (node --test).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BUSINESS_TZ = 'America/Sao_Paulo';

const {
  businessTimeOf, businessHourOf, round2, addDaysISO, sumOrders,
  untilTimeOfDay, hourlySeries, variacao, previousMonthWindow, orderRow,
} = require('../src/lib/faturometro');

// Pedido do livro (não a resposta crua do ML).
function ped(criado, valor, unidades, comprador) {
  return { criado_em_ml: criado, total_amount: valor, unidades, comprador_id: comprador };
}

// ── fuso ─────────────────────────────────────────────────────────────────────
test('horário sai no fuso de São Paulo, não em UTC', () => {
  // 2026-08-06T13:45:28Z = 10:45:28 em São Paulo (-03:00)
  assert.equal(businessTimeOf('2026-08-06T13:45:28.000Z'), '10:45:28');
});

test('meia-noite em São Paulo vira 00, não 24', () => {
  assert.equal(businessTimeOf('2026-08-06T03:00:00.000Z'), '00:00:00');
  assert.equal(businessHourOf('2026-08-06T03:00:00.000Z'), 0);
});

// ── revisão final da branch: o formatador é caro e estava no caminho quente ──
// Construir um Intl.DateTimeFormat por pedido custava centenas de ms de CPU
// SÍNCRONA por request (medido: 9.000 construções = 225 ms), travando o event
// loop a cada 30 s. A memo tem uma armadilha: os testes trocam BUSINESS_TZ em
// tempo de execução, e uma memo de valor único devolveria o fuso antigo.
test('o formatador de hora é construído uma vez, não uma vez por pedido', () => {
  businessTimeOf('2026-08-06T13:45:28.000Z'); // aquece a memo do fuso atual

  const original = Intl.DateTimeFormat;
  let construcoes = 0;
  Intl.DateTimeFormat = function (...args) { construcoes += 1; return new original(...args); };
  Intl.DateTimeFormat.supportedLocalesOf = original.supportedLocalesOf;
  try {
    for (let i = 0; i < 500; i++) businessTimeOf('2026-08-06T13:45:28.000Z');
  } finally { Intl.DateTimeFormat = original; }

  assert.equal(construcoes, 0, `500 formatações não podem construir 500 formatadores; construiu ${construcoes}`);
});

test('businessTimeOf continua respeitando uma troca de BUSINESS_TZ depois da memoização', () => {
  const original = process.env.BUSINESS_TZ;
  const instante = '2026-08-06T13:45:28.000Z';
  try {
    process.env.BUSINESS_TZ = 'America/Sao_Paulo';
    assert.equal(businessTimeOf(instante), '10:45:28');

    process.env.BUSINESS_TZ = 'UTC';
    assert.equal(businessTimeOf(instante), '13:45:28', 'a memo não pode prender o fuso antigo');

    process.env.BUSINESS_TZ = 'America/Sao_Paulo';
    assert.equal(businessTimeOf(instante), '10:45:28', 'nem o novo');
  } finally { process.env.BUSINESS_TZ = original; }
});

test('hora sai como número de 0 a 23', () => {
  assert.equal(businessHourOf('2026-08-06T13:45:28.000Z'), 10);
  assert.equal(businessHourOf('2026-08-07T02:59:00.000Z'), 23); // 23h59 do dia 6 em SP
});

test('pedido às 23h50 de São Paulo fica no dia de São Paulo', () => {
  // 2026-08-07T02:50:00Z = 23:50 do dia 06 em SP
  const row = orderRow(
    { id: 1, date_created: '2026-08-07T02:50:00.000Z', total_amount: 100, order_items: [] },
    'acc-1'
  );
  assert.equal(row.dia, '2026-08-06');
});

// ── arredondamento e datas ───────────────────────────────────────────────────
test('round2 corta na segunda casa', () => {
  assert.equal(round2(219.8586), 219.86);
  assert.equal(round2(null), 0);
});

test('addDaysISO anda para frente e para trás atravessando o mês', () => {
  assert.equal(addDaysISO('2026-08-01', -1), '2026-07-31');
  assert.equal(addDaysISO('2026-08-06', 1), '2026-08-07');
  assert.equal(addDaysISO('2026-02-28', 1), '2026-03-01');
});

// ── soma ─────────────────────────────────────────────────────────────────────
test('soma faturamento, pedidos, unidades e compradores distintos', () => {
  const r = sumOrders([
    ped('2026-08-06T12:00:00Z', 100.5, 2, 'b1'),
    ped('2026-08-06T13:00:00Z', 200.25, 3, 'b2'),
    ped('2026-08-06T14:00:00Z', 50, 1, 'b1'), // comprador repetido
  ]);
  assert.equal(r.faturamento, 350.75);
  assert.equal(r.pedidos, 3);
  assert.equal(r.unidades, 6);
  assert.equal(r.compradores, 2);
});

test('preço médio é faturamento dividido por UNIDADES', () => {
  const r = sumOrders([ped('2026-08-06T12:00:00Z', 4836.89, 22, 'b1')]);
  assert.equal(r.precoMedio, 219.86);
});

test('sem unidades o preço médio é zero, não infinito', () => {
  const r = sumOrders([ped('2026-08-06T12:00:00Z', 100, 0, 'b1')]);
  assert.equal(r.precoMedio, 0);
});

test('lista vazia soma zero', () => {
  const r = sumOrders([]);
  assert.deepEqual(
    { f: r.faturamento, p: r.pedidos, u: r.unidades, c: r.compradores },
    { f: 0, p: 0, u: 0, c: 0 }
  );
});

// ── corte "até o mesmo horário" ──────────────────────────────────────────────
test('corte por horário mantém o que veio antes e descarta o resto', () => {
  const pedidos = [
    ped('2026-08-05T12:00:00Z', 10, 1, 'b1'), // 09:00 SP
    ped('2026-08-05T16:00:00Z', 20, 1, 'b2'), // 13:00 SP
  ];
  assert.equal(untilTimeOfDay(pedidos, '10:45:28').length, 1);
  assert.equal(untilTimeOfDay(pedidos, '23:59:59').length, 2);
  assert.equal(untilTimeOfDay(pedidos, '00:00:01').length, 0);
});

// ── curva por hora ───────────────────────────────────────────────────────────
test('curva por hora tem 24 baldes e soma bate com o dia', () => {
  const hoje = [ped('2026-08-06T13:00:00Z', 100, 1, 'b1'), ped('2026-08-06T13:30:00Z', 50, 1, 'b2')];
  const ontem = [ped('2026-08-05T15:00:00Z', 80, 1, 'b3')];
  const serie = hourlySeries(hoje, ontem);

  assert.equal(serie.length, 24);
  assert.equal(serie[10].hoje, 150); // 13Z = 10h SP
  assert.equal(serie[12].ontem, 80); // 15Z = 12h SP
  assert.equal(serie.reduce((s, x) => s + x.hoje, 0), 150);
  assert.equal(serie.reduce((s, x) => s + x.ontem, 0), 80);
});

test('curva por hora com listas vazias devolve 24 zeros', () => {
  const serie = hourlySeries([], []);
  assert.equal(serie.length, 24);
  assert.equal(serie.every((x) => x.hoje === 0 && x.ontem === 0), true);
});

// ── variação ─────────────────────────────────────────────────────────────
test('variação é a diferença relativa', () => {
  assert.equal(variacao(118, 100), 0.18);
  assert.equal(variacao(90, 100), -0.1);
});

test('anterior zerado devolve null, não infinito', () => {
  assert.equal(variacao(100, 0), null);
  assert.equal(variacao(0, 0), null);
});

// ── janela do mês anterior ───────────────────────────────────────────────────
test('mês anterior: dias completos até D-1 mais o dia D parcial', () => {
  assert.deepEqual(previousMonthWindow('2026-08-06'), {
    ym: '2026-07', completosAte: '2026-07-05', diaParcial: '2026-07-06', parcial: true,
  });
});

test('no dia 1 não há dias completos, só o parcial', () => {
  assert.deepEqual(previousMonthWindow('2026-08-01'), {
    ym: '2026-07', completosAte: null, diaParcial: '2026-07-01', parcial: true,
  });
});

test('mês anterior sem o dia equivalente compara com o mês inteiro', () => {
  // 31 de agosto: julho tem 31, mas junho (visto de 31/07) não teria.
  assert.deepEqual(previousMonthWindow('2026-07-31'), {
    ym: '2026-06', completosAte: '2026-06-30', diaParcial: null, parcial: false,
  });
});

test('janeiro compara com dezembro do ano anterior', () => {
  assert.equal(previousMonthWindow('2026-01-10').ym, '2025-12');
});

// ── normalização do pedido do ML ─────────────────────────────────────────────
test('orderRow extrai valor, unidades e comprador da resposta do ML', () => {
  const row = orderRow({
    id: 2000003508419013,
    date_created: '2026-08-06T13:45:28.000-03:00',
    total_amount: 219.9,
    order_items: [{ quantity: 2 }, { quantity: 1 }],
    buyer: { id: 987654 },
  }, 'acc-1');

  assert.equal(row.order_id, '2000003508419013');
  assert.equal(row.account_id, 'acc-1');
  assert.equal(row.total_amount, 219.9);
  assert.equal(row.unidades, 3);
  assert.equal(row.comprador_id, '987654');
});

test('orderRow devolve null quando falta id ou data', () => {
  assert.equal(orderRow({ total_amount: 10 }, 'acc-1'), null);
  assert.equal(orderRow({ id: 1 }, 'acc-1'), null);
  assert.equal(orderRow(null, 'acc-1'), null);
});

test('orderRow aguenta pedido sem itens e sem comprador', () => {
  const row = orderRow({ id: 5, date_created: '2026-08-06T13:00:00Z', total_amount: 10 }, 'acc-1');
  assert.equal(row.unidades, 0);
  assert.equal(row.comprador_id, null);
});
