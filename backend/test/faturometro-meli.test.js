// ordersOfDay/fetchOrder do meliService, com a API do ML mockada.
// Nenhuma chamada de rede real: trocamos global.fetch por um stub.
//
// Por que um SQLite descartável em vez de trocar meli.getValidAccessToken por um
// stub: apiGet chama a função LOCAL do módulo, não a exportada — reatribuir
// meli.getValidAccessToken não teria efeito nenhum. Então damos a ele uma
// conexão de verdade no banco. Sem ENCRYPTION_KEY o token é gravado em texto
// puro (ver lib/secrets.js), o que serve perfeitamente ao teste.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-meli-'));
process.env.SQLITE_FILE = path.join(tmpDir, 'test.sqlite');
process.env.BUSINESS_TZ = 'America/Sao_Paulo';
process.env.MELI_APP_ID = 'app';
process.env.MELI_SECRET = 'segredo';
process.env.MELI_REDIRECT_URI = 'https://exemplo.test/integrations/mercadolivre/callback';
delete process.env.DATABASE_URL;
delete process.env.ENCRYPTION_KEY;

const db = require('../src/db/knex');
const meli = require('../src/services/meliService');

// Guarda as URLs chamadas e devolve as respostas na ordem em que foram enfileiradas.
function mockFetch(respostas) {
  const chamadas = [];
  global.fetch = async (url) => {
    chamadas.push(String(url));
    const body = respostas.shift() || { results: [], paging: { total: 0 } };
    return { ok: true, status: 200, json: async () => body };
  };
  return chamadas;
}

test.before(async () => {
  await db.migrate.latest();
  await db('users').insert({ id: 'u-1', nome: 'Ana', email: 'ana@meli.test', senha_hash: 'x', papel: 'analista' });
  await db('clients').insert({
    id: 'c-1', loja: 'Loja', tipo: 'Loja',
    analista_id: 'u-1', agenda_freq: 'Semanal', agenda_dia_semana: 'Segunda',
  });
  await db('accounts').insert({ id: 'acc-1', client_id: 'c-1', marketplace: 'Mercado Livre', apelido: 'conta', ativo: true });
  await db('meli_connections').insert({
    id: 'conn-1', account_id: 'acc-1', ml_user_id: '9',
    access_token: 'token-de-teste',
    expires_at: new Date(Date.now() + 3600e3).toISOString(),
  });
});

test.after(async () => {
  await db.destroy();
  global.fetch = undefined;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const pedido = (id, valor) => ({ id, date_created: '2026-08-06T13:00:00.000-03:00', total_amount: valor, order_items: [{ quantity: 1 }] });

test('ordersOfDay devolve os pedidos crus do dia', async () => {
  mockFetch([{ results: [pedido(1, 100), pedido(2, 50)], paging: { total: 2 } }]);

  const r = await meli.ordersOfDay('acc-1', 'seller-9', '2026-08-06');

  assert.equal(r.erro, null);
  assert.equal(r.pedidos.length, 2);
  assert.equal(r.pedidos[0].id, 1);
});

test('ordersOfDay pede a janela do dia no fuso -03:00', async () => {
  const chamadas = mockFetch([{ results: [], paging: { total: 0 } }]);

  await meli.ordersOfDay('acc-1', 'seller-9', '2026-08-06');

  assert.match(decodeURIComponent(chamadas[0]), /2026-08-06T00:00:00\.000-03:00/);
  assert.match(decodeURIComponent(chamadas[0]), /2026-08-06T23:59:59\.999-03:00/);
});

test('ordersOfDay pagina até trazer tudo', async () => {
  const pagina1 = { results: Array.from({ length: 50 }, (_, i) => pedido(i, 10)), paging: { total: 60 } };
  const pagina2 = { results: Array.from({ length: 10 }, (_, i) => pedido(100 + i, 10)), paging: { total: 60 } };
  mockFetch([pagina1, pagina2]);

  const r = await meli.ordersOfDay('acc-1', 'seller-9', '2026-08-06');

  assert.equal(r.pedidos.length, 60);
});

test('ordersOfDay devolve o erro do ML sem lançar', async () => {
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'invalid token' }) });

  const r = await meli.ordersOfDay('acc-1', 'seller-9', '2026-08-06');

  assert.equal(r.pedidos.length, 0);
  assert.ok(r.erro);
});

// ── erro no MEIO da paginação: a página que já tinha voltado continua contada ──
// (é o comportamento citado na restrição da tarefa — não pode regredir em silêncio)
test('ordersOfDay mantém os pedidos da página que já chegou quando a página seguinte falha', async () => {
  const pagina1 = { results: Array.from({ length: 50 }, (_, i) => pedido(i, 10)), paging: { total: 60 } };
  let chamada = 0;
  global.fetch = async () => {
    chamada += 1;
    if (chamada === 1) return { ok: true, status: 200, json: async () => pagina1 };
    return { ok: false, status: 500, json: async () => ({ message: 'erro no ML' }) };
  };

  const r = await meli.ordersOfDay('acc-1', 'seller-9', '2026-08-06');

  assert.equal(r.pedidos.length, 50);
  assert.ok(r.erro);
});

test('ordersTotals soma a página que voltou antes do erro e propaga o erro', async () => {
  const pagina1 = { results: Array.from({ length: 50 }, (_, i) => pedido(i, 10)), paging: { total: 60 } };
  let chamada = 0;
  global.fetch = async () => {
    chamada += 1;
    if (chamada === 1) return { ok: true, status: 200, json: async () => pagina1 };
    return { ok: false, status: 500, json: async () => ({ message: 'erro no ML' }) };
  };

  const r = await meli.ordersTotals('acc-1', 'seller-9', '2026-08-06', '2026-08-06');

  assert.equal(r.pedidos, 50);
  assert.equal(r.faturamento, 500);
  assert.equal(r.vendas, 50);
  assert.ok(r.erro);
});

test('ordersTotals continua somando o mesmo, agora em cima de ordersOfDay', async () => {
  mockFetch([{ results: [pedido(1, 100), pedido(2, 50)], paging: { total: 2 } }]);

  const r = await meli.ordersTotals('acc-1', 'seller-9', '2026-08-06', '2026-08-06');

  assert.equal(r.faturamento, 150);
  assert.equal(r.vendas, 2);
  assert.equal(r.pedidos, 2);
});

test('fetchOrder busca um pedido pelo id', async () => {
  const chamadas = mockFetch([pedido(2000003508419013, 219.9)]);

  const r = await meli.fetchOrder('acc-1', '2000003508419013');

  assert.equal(r.ok, true);
  assert.equal(r.data.total_amount, 219.9);
  assert.match(chamadas[0], /\/orders\/2000003508419013$/);
});
