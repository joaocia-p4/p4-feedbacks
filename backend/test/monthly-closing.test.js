// Testes de lib/monthlyClosing — fechamento mensal. Puros, sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');

const { monthRange, accountInMonth, consolidate } = require('../src/lib/monthlyClosing');

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

test('conta com relatório no mês entra, mesmo já encerrada hoje', () => {
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

// ── consolidação ─────────────────────────────────────────────────────────────
function rel(faturamento, investimento, receita_ads, vendas, vendas_ads) {
  return { faturamento, investimento, receita_ads, vendas: vendas || 0, vendas_ads: vendas_ads || 0 };
}

test('soma os valores absolutos de todos os relatórios', () => {
  const t = consolidate([rel(1000, 100, 400, 10, 4), rel(2000, 300, 900, 20, 9)]);
  assert.equal(t.faturamento, 3000);
  assert.equal(t.investimento, 400);
  assert.equal(t.receitaAds, 1300);
  assert.equal(t.vendas, 30);
  assert.equal(t.vendasAds, 13);
});

test('roas do mês é ponderado, não média das semanas', () => {
  // A: 100 → 1000 (10x) · B: 900 → 900 (1x). Média simples = 5,5x. Ponderado = 1,9x.
  const t = consolidate([rel(0, 100, 1000), rel(0, 900, 900)]);
  assert.equal(t.roas, 1.9);
});

test('lista vazia devolve tudo zerado e razões nulas', () => {
  const t = consolidate([]);
  assert.equal(t.faturamento, 0);
  assert.equal(t.investimento, 0);
  assert.equal(t.roas, null);
  assert.equal(t.acos, null);
  assert.equal(t.tacos, null);
});

test('campos ausentes ou textuais não viram NaN', () => {
  const t = consolidate([{ faturamento: null, investimento: undefined }, rel(500, 50, 200)]);
  assert.equal(t.faturamento, 500);
  assert.equal(t.investimento, 50);
});
