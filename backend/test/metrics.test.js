// Testes de lib/metrics — regra do "mês do relatório" e cálculo de razões.
// Puros: nenhuma data vem do relógio.
const test = require('node:test');
const assert = require('node:assert/strict');

const { reportMonth, ratios } = require('../src/lib/metrics');

// ── mês do relatório ─────────────────────────────────────────────────────────
test('o mês do relatório é o do fim do período', () => {
  assert.equal(reportMonth({ periodo_ini: '2026-07-06', periodo_fim: '2026-07-12' }), '2026-07');
});

test('semana que atravessa a virada cai no mês do fim', () => {
  // 29/06 a 05/07 é relatório de julho — a semana é indivisível
  assert.equal(reportMonth({ periodo_ini: '2026-06-29', periodo_fim: '2026-07-05' }), '2026-07');
});

test('sem fim de período, usa o início', () => {
  assert.equal(reportMonth({ periodo_ini: '2026-05-04', periodo_fim: null }), '2026-05');
});

test('sem período nenhum, usa a data de criação', () => {
  assert.equal(reportMonth({ criado_em: '2026-03-19 22:40:11' }), '2026-03');
});

test('sem nenhuma data utilizável devolve null', () => {
  assert.equal(reportMonth({}), null);
  assert.equal(reportMonth({ periodo_fim: 'sem data' }), null);
});

// ── razões ───────────────────────────────────────────────────────────────────
test('roas é ponderado pelo investimento, não média das semanas', () => {
  // semana A: invest 10 → receita 100 (10x) · semana B: invest 990 → receita 990 (1x)
  // média simples das razões daria 5,5x. O certo é 1090/1000 = 1,09x.
  assert.equal(ratios(0, 1000, 1090).roas, 1.09);
});

test('acos e tacos vêm das somas', () => {
  const r = ratios(10000, 2000, 8000);
  assert.equal(r.acos, 25); // 2000/8000
  assert.equal(r.tacos, 20); // 2000/10000
});

test('denominador zero devolve null, nunca Infinity', () => {
  const r = ratios(0, 0, 0);
  assert.equal(r.roas, null);  // investimento é o divisor do roas
  assert.equal(r.acos, null);  // receita de Ads é o divisor do acos
  assert.equal(r.tacos, null); // faturamento é o divisor do tacos
});

test('numerador zero com divisor válido é zero, não null', () => {
  // mês sem receita de Ads mas com investimento: o roas É zero, e dizer "—" mentiria
  assert.equal(ratios(1000, 500, 0).roas, 0);
  assert.equal(ratios(1000, 500, 0).tacos, 50);
});
