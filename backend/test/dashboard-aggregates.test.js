// Testes das agregações do Painel CS (lib/dashboardAggregates).
// Roda com `npm test` (node --test). Funções puras: recebem a lista de clientes
// já enriquecida (statusTag + contas) e não tocam o banco.
const test = require('node:test');
const assert = require('node:assert/strict');

const { byManager, countActiveAccounts } = require('../src/lib/dashboardAggregates');

// Cliente mínimo para a agregação: só analista + statusTag importam.
function cli(analista, statusTag) {
  return { analista, statusTag };
}

function linhaDe(rows, analista) {
  const r = rows.find((x) => x.analista === analista);
  assert.ok(r, `esperava uma linha para "${analista}"`);
  return r;
}

// ── fatias ────────────────────────────────────────────────────────────────────
test('cada statusTag cai na sua fatia', () => {
  const rows = byManager([
    cli('Ana', 'em-dia'),
    cli('Ana', 'atrasado'),
    cli('Ana', 'onboarding'),
    cli('Ana', 'pausado'),
    cli('Ana', 'encerrado'),
  ]);

  const ana = linhaDe(rows, 'Ana');
  assert.equal(ana.emDia, 1);
  assert.equal(ana.atrasado, 1);
  assert.equal(ana.onboarding, 1);
  assert.equal(ana.pausado, 1);
  assert.equal(ana.encerrado, 1);
});

test('cliente "enviar hoje" conta como em dia', () => {
  const rows = byManager([cli('Ana', 'hoje'), cli('Ana', 'em-dia')]);

  assert.equal(linhaDe(rows, 'Ana').emDia, 2);
});

// ── ativos ───────────────────────────────────────────────────────────────────
test('ativos junta em dia, enviar hoje e atrasado', () => {
  const rows = byManager([cli('Ana', 'em-dia'), cli('Ana', 'hoje'), cli('Ana', 'atrasado')]);

  assert.equal(linhaDe(rows, 'Ana').ativos, 3);
});

test('ativos não inclui onboarding, pausado nem encerrado', () => {
  const rows = byManager([
    cli('Ana', 'em-dia'),
    cli('Ana', 'onboarding'),
    cli('Ana', 'pausado'),
    cli('Ana', 'encerrado'),
  ]);

  assert.equal(linhaDe(rows, 'Ana').ativos, 1);
});

test('ativos continua detalhado em emDia e atrasado para a tela dedicada', () => {
  const rows = byManager([cli('Ana', 'em-dia'), cli('Ana', 'atrasado'), cli('Ana', 'atrasado')]);

  const ana = linhaDe(rows, 'Ana');
  assert.equal(ana.ativos, 3);
  assert.equal(ana.emDia, 1);
  assert.equal(ana.atrasado, 2);
});

// ── carteira e total ─────────────────────────────────────────────────────────
test('carteira soma as quatro situações vivas e total inclui os encerrados', () => {
  const rows = byManager([
    ...Array.from({ length: 9 }, () => cli('Ana', 'em-dia')),
    ...Array.from({ length: 3 }, () => cli('Ana', 'atrasado')),
    cli('Ana', 'onboarding'),
    cli('Ana', 'pausado'),
    ...Array.from({ length: 4 }, () => cli('Ana', 'encerrado')),
  ]);

  const ana = linhaDe(rows, 'Ana');
  assert.equal(ana.carteira, 14);
  assert.equal(ana.total, 18);
  assert.equal(ana.emDia + ana.atrasado + ana.onboarding + ana.pausado, ana.carteira);
  assert.equal(ana.carteira + ana.encerrado, ana.total);
});

test('cliente encerrado não entra na carteira', () => {
  const rows = byManager([cli('Ana', 'em-dia'), cli('Ana', 'encerrado')]);

  const ana = linhaDe(rows, 'Ana');
  assert.equal(ana.carteira, 1);
  assert.equal(ana.encerrado, 1);
});

test('gestor só com encerrados aparece com carteira zerada', () => {
  const rows = byManager([cli('Ana', 'em-dia'), cli('Bruno', 'encerrado')]);

  const bruno = linhaDe(rows, 'Bruno');
  assert.equal(bruno.carteira, 0);
  assert.equal(bruno.encerrado, 1);
});

// ── agrupamento ──────────────────────────────────────────────────────────────
test('cliente sem analista cai no grupo "—"', () => {
  const rows = byManager([cli(null, 'em-dia'), cli('', 'atrasado'), cli(undefined, 'pausado')]);

  const sem = linhaDe(rows, '—');
  assert.equal(sem.carteira, 3);
  assert.equal(rows.length, 1);
});

// ── ordenação ────────────────────────────────────────────────────────────────
test('ordena por carteira decrescente, com encerrados fora do critério', () => {
  const rows = byManager([
    ...Array.from({ length: 20 }, () => cli('Churn', 'encerrado')),
    cli('Churn', 'em-dia'),
    ...Array.from({ length: 5 }, () => cli('Ana', 'em-dia')),
    ...Array.from({ length: 3 }, () => cli('Bruno', 'em-dia')),
  ]);

  assert.deepEqual(rows.map((r) => r.analista), ['Ana', 'Bruno', 'Churn']);
});

test('empate na carteira desempata por total e depois por nome', () => {
  const rows = byManager([
    cli('Zeca', 'em-dia'),
    cli('Ana', 'em-dia'),
    cli('Bruno', 'em-dia'),
    cli('Bruno', 'encerrado'),
  ]);

  assert.deepEqual(rows.map((r) => r.analista), ['Bruno', 'Ana', 'Zeca']);
});

// ── compatibilidade com o payload atual ──────────────────────────────────────
test('mantém os campos clients/overdue que o payload já expunha', () => {
  const rows = byManager([
    cli('Ana', 'em-dia'),
    cli('Ana', 'atrasado'),
    cli('Ana', 'encerrado'),
  ]);

  const ana = linhaDe(rows, 'Ana');
  assert.equal(ana.clients, 2); // carteira viva, como antes (encerrado ficava de fora)
  assert.equal(ana.overdue, 1);
});

// ── borda ────────────────────────────────────────────────────────────────────
test('lista vazia devolve nenhuma linha', () => {
  assert.deepEqual(byManager([]), []);
});

// ── contagem de contas (KPI "Contas") ────────────────────────────────────────
// Cliente só com as contas: é o que countActiveAccounts olha.
function comContas(...contas) {
  return { contas };
}

test('conta as contas de todos os clientes da lista', () => {
  const n = countActiveAccounts([
    comContas({ ativo: true }, { ativo: true }),
    comContas({ ativo: true }),
  ]);

  assert.equal(n, 3);
});

test('conta encerrada não entra', () => {
  const n = countActiveAccounts([comContas({ ativo: true }, { ativo: false })]);

  assert.equal(n, 1);
});

test('conta pausada continua contando — ela existe, só não cobra relatório', () => {
  const n = countActiveAccounts([comContas({ ativo: true, pausado: true }, { ativo: true })]);

  assert.equal(n, 2);
});

test('cliente sem contas não quebra nem soma', () => {
  assert.equal(countActiveAccounts([comContas(), { loja: 'sem campo contas' }]), 0);
});

test('lista vazia devolve zero contas', () => {
  assert.equal(countActiveAccounts([]), 0);
});
