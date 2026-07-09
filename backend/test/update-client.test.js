// updateClient com contas SEM id (payload legado / importação) não pode apagar
// as contas existentes e o histórico em cascata — deve ADOTAR a conta do mesmo
// marketplace. Roda contra um SQLite descartável (SQLITE_FILE aponta p/ temp).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-test-'));
process.env.SQLITE_FILE = path.join(tmpDir, 'test.sqlite');
process.env.BUSINESS_TZ = 'America/Sao_Paulo';
delete process.env.DATABASE_URL; // garante SQLite mesmo com .env de produção

const db = require('../src/db/knex');
const clientService = require('../src/services/clientService');
const reportService = require('../src/services/reportService');

let analista;

test.before(async () => {
  await db.migrate.latest();
  await db('users').insert({
    id: 'u-test', nome: 'Ana Teste', email: 'ana@test.dev',
    senha_hash: 'x', papel: 'analista',
  });
  analista = { id: 'u-test', papel: 'analista' };
});

test.after(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('updateClient com contas sem id preserva as contas e o histórico', async () => {
  const created = await clientService.createClient({
    loja: 'Loja X',
    tipo: 'Loja',
    agenda: { freq: 'Semanal', diaSemana: 'Sexta' },
    contas: [
      { marketplace: 'Mercado Livre', apelido: 'ml-principal' },
      { marketplace: 'Shopee', apelido: '' },
    ],
  }, analista);
  const contaML = created.contas.find((m) => m.marketplace === 'Mercado Livre');

  // um relatório no histórico da conta ML
  const accRow = await db('accounts').where({ id: contaML.id }).first();
  await reportService.createReport(accRow, {
    marketplace: 'Mercado Livre',
    periodoIni: '2026-06-27', periodoFim: '2026-07-03',
    faturamento: '1000,00', investimento: '100,00', receitaAds: '400,00',
  });
  assert.equal((await db('reports').where({ account_id: contaML.id })).length, 1);

  // edição "re-montada" SEM ids (como a importação em massa manda)
  const updated = await clientService.updateClient(created.id, {
    contas: [
      { marketplace: 'Mercado Livre', apelido: 'ml-principal', metaRoas: '5,00' },
      { marketplace: 'Shopee', apelido: '' },
    ],
  }, analista);

  const mlDepois = updated.contas.find((m) => m.marketplace === 'Mercado Livre');
  assert.equal(mlDepois.id, contaML.id, 'conta ML deve ser ADOTADA, não recriada');
  assert.equal(mlDepois.metaRoas, '5,00', 'edição ainda aplica os novos valores');
  assert.equal(
    (await db('reports').where({ account_id: contaML.id })).length, 1,
    'histórico de relatórios deve sobreviver à edição'
  );
  assert.equal((await db('accounts').where({ client_id: created.id })).length, 2);
});

test('payload legado "marketplaces" também adota as contas existentes', async () => {
  const created = await clientService.createClient({
    loja: 'Loja Y',
    tipo: 'Loja',
    agenda: { freq: 'Semanal', diaSemana: 'Segunda' },
    contas: [{ marketplace: 'Amazon', apelido: 'amz-1' }],
  }, analista);
  const contaAmz = created.contas[0];

  const updated = await clientService.updateClient(created.id, {
    marketplaces: ['Amazon'],
  }, analista);

  assert.equal(updated.contas.length, 1);
  assert.equal(updated.contas[0].id, contaAmz.id, 'conta deve ser adotada por marketplace');
});

test('remover uma conta explicitamente (com ids) continua funcionando', async () => {
  const created = await clientService.createClient({
    loja: 'Loja Z',
    tipo: 'Loja',
    agenda: { freq: 'Semanal', diaSemana: 'Terça' },
    contas: [
      { marketplace: 'Mercado Livre', apelido: '' },
      { marketplace: 'Magalu', apelido: '' },
    ],
  }, analista);
  const ml = created.contas.find((m) => m.marketplace === 'Mercado Livre');

  const updated = await clientService.updateClient(created.id, {
    contas: [{ id: ml.id, marketplace: 'Mercado Livre', apelido: '' }],
  }, analista);
  assert.equal(updated.contas.length, 1);
  assert.equal(updated.contas[0].marketplace, 'Mercado Livre');
});

test('trocar a agenda registra agendaDesde (graça até o 1º envio novo)', async () => {
  const created = await clientService.createClient({
    loja: 'Loja W',
    tipo: 'Loja',
    agenda: { freq: 'Mensal', diaMes: 28 },
    contas: [{ marketplace: 'Mercado Livre', apelido: '' }],
  }, analista);

  const updated = await clientService.updateClient(created.id, {
    agenda: { freq: 'Semanal', diaSemana: 'Segunda' },
  }, analista);
  const row = await db('clients').where({ id: created.id }).first();
  assert.ok(row.agenda_alterada_em, 'troca de agenda deve registrar a data');
  assert.equal(updated.agendaDesde, row.agenda_alterada_em);

  // atualizar SEM mudar a agenda não re-marca a data
  await db('clients').where({ id: created.id }).update({ agenda_alterada_em: '2026-01-01' });
  await clientService.updateClient(created.id, {
    agenda: { freq: 'Semanal', diaSemana: 'Segunda' },
    observacoes: 'só uma nota',
  }, analista);
  const row2 = await db('clients').where({ id: created.id }).first();
  assert.equal(row2.agenda_alterada_em, '2026-01-01', 'mesma agenda não re-baseia a graça');
});
