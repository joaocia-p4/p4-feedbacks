// Testes de lib/monthlyClosing — fechamento mensal. Puros, sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');

const { monthRange, accountInMonth, metaStatus, buildMonthlyClosing } = require('../src/lib/monthlyClosing');

// ── janela do mês ────────────────────────────────────────────────────────────
test('mês de 31 dias', () => {
  assert.deepEqual(monthRange('2026-07'), { ini: '2026-07-01', fim: '2026-07-31' });
});

test('mês de 30 dias', () => {
  assert.deepEqual(monthRange('2026-06'), { ini: '2026-06-01', fim: '2026-06-30' });
});

test('fevereiro de ano bissexto', () => {
  assert.deepEqual(monthRange('2028-02'), { ini: '2028-02-01', fim: '2028-02-29' });
});

// ── quem entra no mês ────────────────────────────────────────────────────────
const JUL = '2026-07';

test('conta com lançamento no mês entra, mesmo já encerrada hoje', () => {
  const conta = { dataEntrada: '2025-01-10', dataEncerramento: '2026-08-15' };
  assert.equal(accountInMonth(conta, JUL, true), true);
});

test('conta criada depois do mês não entra', () => {
  const conta = { dataEntrada: null, criadoEm: '2026-09-02', dataEncerramento: null };
  assert.equal(accountInMonth(conta, JUL, false), false);
});

test('conta encerrada antes do mês não entra', () => {
  const conta = { dataEntrada: '2025-03-01', dataEncerramento: '2026-06-30' };
  assert.equal(accountInMonth(conta, JUL, false), false);
});

test('conta encerrada no meio do mês entra', () => {
  const conta = { dataEntrada: '2025-03-01', dataEncerramento: '2026-07-15' };
  assert.equal(accountInMonth(conta, JUL, false), true);
});

test('conta que entrou no meio do mês entra', () => {
  const conta = { dataEntrada: '2026-07-20', dataEncerramento: null };
  assert.equal(accountInMonth(conta, JUL, false), true);
});

test('dataEntrada manda mais que criadoEm', () => {
  // cadastrada tarde no sistema, mas operando desde antes
  const conta = { dataEntrada: '2026-01-05', criadoEm: '2026-09-30', dataEncerramento: null };
  assert.equal(accountInMonth(conta, JUL, false), true);
});

test('sem nenhuma data de entrada, assume que sempre existiu', () => {
  assert.equal(accountInMonth({ dataEntrada: null, criadoEm: null }, JUL, false), true);
});

test('conta sem lançamento e fora da janela de datas não entra', () => {
  const conta = { dataEntrada: null, criadoEm: '2026-09-02', dataEncerramento: null };
  assert.equal(accountInMonth(conta, JUL, false), false);
});

// ── comparação com meta ──────────────────────────────────────────────────────
test('ROAS é piso: bateu quando alcança ou passa', () => {
  assert.equal(metaStatus(4.8, '4,00', 'piso'), true);
  assert.equal(metaStatus(4.0, '4,00', 'piso'), true);
  assert.equal(metaStatus(3.9, '4,00', 'piso'), false);
});

test('ACOS é teto: bateu quando fica abaixo', () => {
  assert.equal(metaStatus(18, '20,00', 'teto'), true);
  assert.equal(metaStatus(20, '20,00', 'teto'), true);
  assert.equal(metaStatus(22, '20,00', 'teto'), false);
});

test('meta vazia devolve null, nunca false', () => {
  // meta ausente não é meta não batida — a tela mostra "—", não "✗"
  assert.equal(metaStatus(4.8, '', 'piso'), null);
  assert.equal(metaStatus(4.8, null, 'piso'), null);
  assert.equal(metaStatus(4.8, '0', 'piso'), null);
});

test('valor ausente devolve null', () => {
  assert.equal(metaStatus(null, '4,00', 'piso'), null);
  assert.equal(metaStatus(undefined, '4,00', 'piso'), null);
});

test('meta em pt-BR com milhar é lida certo', () => {
  assert.equal(metaStatus(1500, '1.200,00', 'piso'), true);
});

test('direcao desconhecida lança erro', () => {
  assert.throws(
    () => metaStatus(4.8, '4,00', 'invalido'),
    /direcao desconhecida/
  );
});

test('valor 0 é válido (falsy mas não null/undefined)', () => {
  // com teto, 0 < ceiling → true
  assert.equal(metaStatus(0, '20,00', 'teto'), true);
});

// ── montagem ─────────────────────────────────────────────────────────────────
function conta(id, extra) {
  return {
    id, marketplace: 'Mercado Livre', conta: '',
    metaInvestimento: '', metaRoas: '', metaAcos: '', metaTacos: '',
    dataEntrada: '2025-01-01', dataEncerramento: null, criadoEm: '2025-01-01',
    ...extra,
  };
}
function cliente(id, loja, contas, extra) {
  return { id, loja, analista: 'Ana', statusTag: 'em-dia', contas, ...extra };
}
function lanc(account_id, faturamento, investimento, receita_ads) {
  return { account_id, ym: '2026-07', faturamento, investimento, receita_ads };
}

test('conta sem lançamento vem com valores nulos e marcada como não lançada', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    figures: [], closings: [],
  });
  const a = out.clients[0].contas[0];
  assert.equal(a.lancado, false);
  assert.equal(a.totals.faturamento, null);
  assert.equal(a.totals.roas, null);
});

test('lançamento zerado é diferente de ausente', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    figures: [lanc('a1', 0, 0, 0)], closings: [],
  });
  const a = out.clients[0].contas[0];
  assert.equal(a.lancado, true);
  assert.equal(a.totals.faturamento, 0); // zero, não null
  assert.equal(a.totals.roas, null);     // divisor zero
  assert.equal(out.clients[0].incompleto, false);
});

test('razões saem dos valores lançados', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    figures: [lanc('a1', 10000, 1000, 5000)], closings: [],
  });
  const t = out.clients[0].contas[0].totals;
  assert.equal(t.roas, 5);    // 5000/1000
  assert.equal(t.acos, 20);   // 1000/5000
  assert.equal(t.tacos, 10);  // 1000/10000
});

test('lançamento de outro mês não conta', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    figures: [{ account_id: 'a1', ym: '2026-06', faturamento: 999, investimento: 9, receita_ads: 9 }],
    closings: [],
  });
  assert.equal(out.clients[0].contas[0].lancado, false);
  assert.equal(out.clients[0].totals.faturamento, null);
});

test('conta com lançamento entra mesmo fora da janela de datas', () => {
  const fora = conta('a1', { dataEntrada: '2026-09-01', criadoEm: '2026-09-01' });
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [fora])],
    figures: [lanc('a1', 100, 10, 40)], closings: [],
  });
  assert.equal(out.clients.length, 1);
  assert.equal(out.clients[0].contas[0].lancado, true);
});

test('cliente cujas contas não existiam no mês some da lista', () => {
  // sem lançamento e fora da janela de datas: nenhuma porta abre, a conta
  // não entra, o cliente fica sem contas e desaparece (if (!contas.length) continue)
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Novo', [conta('a1', { dataEntrada: '2026-09-01', criadoEm: '2026-09-01' })])],
    figures: [], closings: [],
  });
  assert.deepEqual(out.clients, []);
  assert.equal(out.resumo.clientes, 0);
});

test('totais do cliente somam só as contas lançadas e recalculam as razões', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1'), conta('a2', { marketplace: 'Shopee' })])],
    figures: [lanc('a1', 39100, 5200, 25000), lanc('a2', 9100, 1210, 5000)],
    closings: [],
  });
  const t = out.clients[0].totals;
  assert.equal(t.faturamento, 48200);
  assert.equal(t.investimento, 6410);
  assert.equal(t.roas, +((30000 / 6410).toFixed(2))); // da soma, não média das razões
  assert.equal(out.clients[0].incompleto, false);
});

test('valores de monthly_figures vêm como string do Postgres (decimal) e não concatenam', () => {
  // pg devolve coluna decimal como string ('39100.00'), sqlite devolve number;
  // num() precisa coagir os dois igual. Forma crua do pg, sem formatação BR
  // (isso é só nas metas, caminho de código diferente).
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1'), conta('a2', { marketplace: 'Shopee' })])],
    figures: [
      { account_id: 'a1', ym: '2026-07', faturamento: '39100.00', investimento: '5200.00', receita_ads: '25000.00' },
      { account_id: 'a2', ym: '2026-07', faturamento: '9100.00', investimento: '1210.00', receita_ads: '5000.00' },
    ],
    closings: [],
  });
  const t = out.clients[0].totals;
  assert.equal(typeof t.faturamento, 'number');
  assert.equal(typeof t.investimento, 'number');
  assert.equal(t.faturamento, 48200); // se concatenasse string, não bateria com o número
  assert.equal(t.investimento, 6410);
  // a razão é onde a concatenação vira erro inequívoco: com strings coladas em
  // vez de somadas, este valor sairia completamente diferente de 4,68
  assert.equal(t.roas, +((30000 / 6410).toFixed(2)));
});

test('cliente sem nenhuma conta lançada tem totais nulos e fica incompleto', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    figures: [], closings: [],
  });
  assert.equal(out.clients[0].totals.faturamento, null);
  assert.equal(out.clients[0].totals.roas, null);
  assert.equal(out.clients[0].incompleto, true);
});

test('uma conta lançada e outra não deixa o cliente incompleto', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1'), conta('a2', { marketplace: 'Shopee' })])],
    figures: [lanc('a1', 100, 10, 40)], closings: [],
  });
  assert.equal(out.clients[0].incompleto, true);
  assert.equal(out.clients[0].totals.faturamento, 100); // soma só a lançada
});

test('atingiu vem resolvido por conta, com null para meta ausente', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1', { metaRoas: '4,00', metaAcos: '20,00' })])],
    figures: [lanc('a1', 10000, 1000, 5000)], closings: [],
  });
  const a = out.clients[0].contas[0];
  assert.equal(a.atingiu.roas, true);
  assert.equal(a.atingiu.acos, true);
  assert.equal(a.atingiu.tacos, null);
});

test('resumo conta incompletos, que cruzam com pendentes', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'A', [conta('a1')]), cliente('c2', 'B', [conta('a2')])],
    figures: [lanc('a1', 100, 10, 40)],
    closings: [{ client_id: 'c1', ym: '2026-07', observacoes: 'ok', fechado_em: '2026-08-01', fechado_por: 'u1' }],
  });
  assert.equal(out.resumo.clientes, 2);
  assert.equal(out.resumo.fechados, 1);
  assert.equal(out.resumo.pendentes, 1);
  assert.equal(out.resumo.incompletos, 1); // c2, que também é pendente
});

test('cliente fechado pode estar incompleto', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'A', [conta('a1')])],
    figures: [],
    closings: [{ client_id: 'c1', ym: '2026-07', observacoes: '', fechado_em: '2026-08-01', fechado_por: 'u1' }],
  });
  assert.equal(out.resumo.fechados, 1);
  assert.equal(out.resumo.incompletos, 1);
});

test('ordena pendentes antes de fechados, depois por faturamento desc', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [
      cliente('c1', 'Fechado grande', [conta('a1')]),
      cliente('c2', 'Pendente pequeno', [conta('a2')]),
      cliente('c3', 'Pendente grande', [conta('a3')]),
    ],
    figures: [lanc('a1', 90000, 1, 1), lanc('a2', 100, 1, 1), lanc('a3', 5000, 1, 1)],
    closings: [{ client_id: 'c1', ym: '2026-07', observacoes: '', fechado_em: '2026-08-01', fechado_por: 'u1' }],
  });
  assert.deepEqual(out.clients.map((c) => c.loja), ['Pendente grande', 'Pendente pequeno', 'Fechado grande']);
});

test('cliente sem lançamento não quebra a ordenação por faturamento', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Sem nada', [conta('a1')]), cliente('c2', 'Com valor', [conta('a2')])],
    figures: [lanc('a2', 500, 1, 1)], closings: [],
  });
  assert.deepEqual(out.clients.map((c) => c.loja), ['Com valor', 'Sem nada']);
});
