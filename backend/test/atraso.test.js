// Testes da regra de atraso por ciclo (lib/p4 + lib/clientAggregate).
// Roda com `npm test` (node --test). Datas fixas: asOf explícito em cada caso —
// nada aqui depende do relógio real.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BUSINESS_TZ = 'America/Sao_Paulo';

const p4 = require('../src/lib/p4');
const { enrichClient } = require('../src/lib/clientAggregate');

// Julho/2026: 01=Qua 02=Qui 03=Sex 04=Sáb 05=Dom 06=Seg 07=Ter 08=Qua 09=Qui
const ASOF = '2026-07-08'; // "ontem" visto de 2026-07-09

function clienteSemanal(dia, reports, extraConta) {
  const contas = [
    { id: 'a1', marketplace: 'Mercado Livre', ativo: true, pausado: false, reports },
  ];
  if (extraConta) contas.push({ id: 'a2', marketplace: 'Shopee', ativo: true, pausado: false, ...extraConta });
  return enrichClient(
    { id: 'c1', loja: 'Teste', tipo: 'Loja', analista_id: 'u1', agenda: { freq: 'Semanal', diaSemana: dia } },
    contas,
    { asOf: ASOF }
  );
}

// ── fuso: salvo_em é UTC; a data que vale é a de São Paulo ───────────────────
test('salvo_em noturno (UTC do dia seguinte) não pula para o ciclo seguinte', () => {
  // Agenda Quarta: envios 01/07 e 08/07; ciclo atual começa 02/07.
  // Único relatório gerado 01/07 às 22h30 em SP = 02/07T01:30Z em UTC.
  // É a entrega do envio de 01/07 — o cliente PULOU o envio de 08/07: atrasado.
  const c = clienteSemanal('Quarta', [
    { salvoEm: '2026-07-02T01:30:00.000Z', periodoFim: '2026-06-30' },
  ]);
  assert.equal(c.status, 'atrasado');
});

test('salvo_em noturno no próprio dia do envio continua em dia', () => {
  // Gerado 08/07 (dia do envio, Quarta) às 22h30 SP = 09/07T01:30Z.
  const c = clienteSemanal('Quarta', [
    { salvoEm: '2026-07-09T01:30:00.000Z', periodoFim: '2026-07-07' },
  ]);
  assert.equal(c.status, 'em-dia');
});

test('maxGen compara datas de negócio, não strings mistas (backfill × UTC)', () => {
  // Agenda Sábado, asOf 11/07: envios 04/07 e 11/07; ciclo começa 05/07.
  // Relatório backfilled salvo_em='2026-07-05' (em dia) convive com um timestamp
  // UTC '2026-07-05T01:30Z' (= 04/07 SP, fora do ciclo). O maior por STRING é o
  // timestamp; a data efetiva correta é 05/07 (backfill) → em dia.
  const c = enrichClient(
    { id: 'c1', loja: 'T', tipo: 'Loja', analista_id: 'u1', agenda: { freq: 'Semanal', diaSemana: 'Sábado' } },
    [{
      id: 'a1', marketplace: 'Mercado Livre', ativo: true, pausado: false,
      reports: [
        { salvoEm: '2026-07-05T01:30:00.000Z', periodoFim: '2026-06-27' },
        { salvoEm: '2026-07-05', periodoFim: '2026-07-04' },
      ],
    }],
    { asOf: '2026-07-11' }
  );
  assert.equal(c.status, 'em-dia');
});

// ── comportamentos que já funcionam e não podem regredir ────────────────────
test('gera no próprio dia do envio → em dia', () => {
  const c = clienteSemanal('Quarta', [
    { salvoEm: '2026-07-08T13:00:00.000Z', periodoFim: '2026-07-07' },
  ]);
  assert.equal(c.status, 'em-dia');
});

test('monta na segunda para envio na sexta → em dia', () => {
  // Agenda Sexta: envios 26/06 e 03/07; ciclo começa 27/06.
  // Montado segunda 29/06 15h SP para o envio de 03/07.
  const c = clienteSemanal('Sexta', [
    { salvoEm: '2026-06-29T18:00:00.000Z', periodoFim: '2026-06-28' },
  ]);
  assert.equal(c.status, 'em-dia');
});

test('pulou o último envio → atrasado', () => {
  // Agenda Segunda: envios 29/06 e 06/07; ciclo começa 30/06.
  // Último relatório gerado 29/06 de manhã (envio anterior).
  const c = clienteSemanal('Segunda', [
    { salvoEm: '2026-06-29T14:00:00.000Z', periodoFim: '2026-06-28' },
  ]);
  assert.equal(c.status, 'atrasado');
});

test('entregou com 1 dia de atraso (recuperou) → em dia', () => {
  // Agenda Segunda: envio 06/07 entregue 07/07 de manhã.
  const c = clienteSemanal('Segunda', [
    { salvoEm: '2026-07-07T14:00:00.000Z', periodoFim: '2026-07-05' },
  ]);
  assert.equal(c.status, 'em-dia');
});

test('mensal: gera no dia do envio → em dia; pulou o envio → atrasado', () => {
  const agenda = { freq: 'Mensal', diaMes: 5 };
  const base = { id: 'c1', loja: 'T', tipo: 'Loja', analista_id: 'u1', agenda };
  const conta = (reports) => [{ id: 'a1', marketplace: 'Mercado Livre', ativo: true, pausado: false, reports }];
  const emDia = enrichClient(base, conta([{ salvoEm: '2026-07-05T14:00:00.000Z', periodoFim: '2026-06-30' }]), { asOf: ASOF });
  assert.equal(emDia.status, 'em-dia');
  const pulou = enrichClient(base, conta([{ salvoEm: '2026-06-05T14:00:00.000Z', periodoFim: '2026-05-31' }]), { asOf: ASOF });
  assert.equal(pulou.status, 'atrasado');
});

// ── conta nova sem relatório: graça até o primeiro envio agendado passar ─────
test('conta nova sem envio agendado desde a entrada não nasce atrasada', () => {
  // Agenda Sexta: último envio passado = 03/07. Conta Shopee entrou 05/07 (depois
  // do envio) sem relatório — nenhum envio passou em branco desde a entrada.
  const c = clienteSemanal(
    'Sexta',
    [{ salvoEm: '2026-07-03T13:00:00.000Z', periodoFim: '2026-07-02' }],
    { dataEntrada: '2026-07-05', reports: [] }
  );
  assert.equal(c.status, 'em-dia');
});

test('conta sem relatório com envio agendado já perdido → atrasado', () => {
  // Mensal dia 28: conta entrou 01/06, envio de 28/06 passou em branco.
  const c = enrichClient(
    { id: 'c1', loja: 'T', tipo: 'Loja', analista_id: 'u1', agenda: { freq: 'Mensal', diaMes: 28 } },
    [{ id: 'a1', marketplace: 'Mercado Livre', ativo: true, pausado: false,
       dataEntrada: '2026-06-01', reports: [] }],
    { asOf: ASOF }
  );
  assert.equal(c.status, 'atrasado');
});

test('cliente antigo cadastrado hoje (dataEntrada retroativa) tem graça pela criação do registro', () => {
  // dataEntrada retroativa (01/03) mas o registro foi criado ontem — a equipe
  // ainda não teve nenhum envio agendado desde o cadastro.
  const c = clienteSemanal(
    'Sexta',
    [{ salvoEm: '2026-07-03T13:00:00.000Z', periodoFim: '2026-07-02' }],
    { dataEntrada: '2026-03-01', criadoEm: '2026-07-07 18:00:00', reports: [] }
  );
  assert.equal(c.status, 'em-dia');
});

// ── reeditar relatório ANTIGO não pode zerar o atraso do ciclo atual ─────────
test('salvar de novo um relatório de período velho não deixa o cliente em dia', () => {
  // Agenda Sexta: ciclo atual começa 27/06 (asOf 08/07). Cliente parou de reportar
  // em 19/06; em 08/07 o analista reabre esse relatório antigo só para corrigir um
  // número → salvo_em vira 08/07, mas o período coberto continua sendo 13–19/06.
  const c = clienteSemanal('Sexta', [
    { salvoEm: '2026-07-08T15:00:00.000Z', periodoIni: '2026-06-13', periodoFim: '2026-06-19' },
  ]);
  assert.equal(c.status, 'atrasado');
});

test('relatório sem período informado ainda conta pela data de geração', () => {
  const c = clienteSemanal('Sexta', [
    { salvoEm: '2026-07-03T15:00:00.000Z', periodoIni: null, periodoFim: null },
  ]);
  assert.equal(c.status, 'em-dia');
});

// ── conta encerrada não exibe "atrasado" ─────────────────────────────────────
test('conta encerrada tem status próprio (não pinta atrasado) e não cobra o cliente', () => {
  const c = clienteSemanal(
    'Quarta',
    [{ salvoEm: '2026-07-08T13:00:00.000Z', periodoFim: '2026-07-07' }],
    { ativo: false, dataEncerramento: '2026-05-01', reports: [] }
  );
  assert.equal(c.status, 'em-dia');
  const encerrada = c.contas.find((m) => m.marketplace === 'Shopee');
  assert.equal(encerrada.status, 'encerrada');
});

// ── entrega atrasada do ciclo ANTERIOR não cobre o ciclo atual ───────────────
test('entrega atrasada do envio anterior não conta como relatório do ciclo atual', () => {
  // Agenda Segunda: envios 29/06 (anterior) e 06/07 (último). Único relatório:
  // gerado 30/06 (1 dia depois do envio de 29/06) cobrindo a semana que termina
  // 28/06 — é a entrega ATRASADA do envio de 29/06. O envio de 06/07 passou em
  // branco → atrasado.
  const c = clienteSemanal('Segunda', [
    { salvoEm: '2026-06-30T14:00:00.000Z', periodoIni: '2026-06-22', periodoFim: '2026-06-28' },
  ]);
  assert.equal(c.status, 'atrasado');
});

test('monta na segunda para envio no domingo continua em dia (borda do período)', () => {
  // Agenda Domingo: envios 28/06 e 05/07. Montado segunda 29/06 cobrindo a semana
  // que termina 28/06 (mesmo dia do envio anterior) para o envio de 05/07.
  const c = clienteSemanal('Domingo', [
    { salvoEm: '2026-06-29T18:00:00.000Z', periodoIni: '2026-06-22', periodoFim: '2026-06-28' },
  ]);
  assert.equal(c.status, 'em-dia');
});

// ── troca de agenda não re-baseia o ciclo retroativamente ────────────────────
test('agenda recém-trocada dá graça até o primeiro envio novo passar', () => {
  // Cliente era Mensal dia 28 (em dia: gerou 28/06); em 07/07 virou Semanal
  // Segunda. O último envio da agenda nova (06/07) é ANTERIOR à troca — não pode
  // cobrar um envio que não existia.
  const c = enrichClient(
    { id: 'c1', loja: 'T', tipo: 'Loja', analista_id: 'u1', agendaDesde: '2026-07-07',
      agenda: { freq: 'Semanal', diaSemana: 'Segunda' } },
    [{ id: 'a1', marketplace: 'Mercado Livre', ativo: true, pausado: false,
       reports: [{ salvoEm: '2026-06-28T14:00:00.000Z', periodoFim: '2026-06-27' }] }],
    { asOf: ASOF }
  );
  assert.equal(c.status, 'em-dia');
});

test('agenda trocada há tempo cobra normalmente', () => {
  const c = enrichClient(
    { id: 'c1', loja: 'T', tipo: 'Loja', analista_id: 'u1', agendaDesde: '2026-06-20',
      agenda: { freq: 'Semanal', diaSemana: 'Segunda' } },
    [{ id: 'a1', marketplace: 'Mercado Livre', ativo: true, pausado: false,
       reports: [{ salvoEm: '2026-06-28T14:00:00.000Z', periodoFim: '2026-06-27' }] }],
    { asOf: ASOF }
  );
  assert.equal(c.status, 'atrasado');
});

// ── cliente pausado/onboarding não exporta status legado "atrasado" ──────────
test('cliente onboarding sem relatórios: statusTag e status legado coerentes', () => {
  const c = enrichClient(
    { id: 'c1', loja: 'T', tipo: 'Loja', analista_id: 'u1', situacao: 'onboarding',
      agenda: { freq: 'Semanal', diaSemana: 'Quarta' } },
    [{ id: 'a1', marketplace: 'Mercado Livre', ativo: true, pausado: false, reports: [] }],
    { asOf: ASOF }
  );
  assert.equal(c.statusTag, 'onboarding');
  assert.equal(c.status, 'em-dia');
});

// ── conta expõe a data de criação (fallback de entrada no fechamento mensal) ──
test('conta enriquecida repassa criadoEm como string', () => {
  const c = enrichClient(
    { id: 'c1', loja: 'Teste', agenda: { freq: 'Semanal', diaSemana: 'Quarta' } },
    [{ id: 'a1', marketplace: 'Shopee', ativo: true, criadoEm: '2026-02-10', reports: [] }],
    { asOf: ASOF }
  );
  assert.equal(c.contas[0].criadoEm, '2026-02-10');
});

test('conta enriquecida normaliza criadoEm como Date (Postgres)', () => {
  const c = enrichClient(
    { id: 'c1', loja: 'Teste', agenda: { freq: 'Semanal', diaSemana: 'Quarta' } },
    [{ id: 'a1', marketplace: 'Shopee', ativo: true, criadoEm: new Date('2026-02-10T12:00:00Z'), reports: [] }],
    { asOf: ASOF }
  );
  assert.equal(c.contas[0].criadoEm, '2026-02-10');
});

test('conta enriquecida retorna null quando criadoEm ausente', () => {
  const c = enrichClient(
    { id: 'c1', loja: 'Teste', agenda: { freq: 'Semanal', diaSemana: 'Quarta' } },
    [{ id: 'a1', marketplace: 'Shopee', ativo: true, reports: [] }],
    { asOf: ASOF }
  );
  assert.equal(c.contas[0].criadoEm, null);
});
