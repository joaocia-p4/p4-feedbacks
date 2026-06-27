// Seed — recreates the mock dataset from p4-data.jsx (4 users, 9 clients, their
// marketplace accounts and full report histories). Report metric series use the
// exact genReports() algorithm from the prototype, wrapped into complete
// generator payloads so each seeded report can be re-opened by the gerador.
const bcrypt = require('bcryptjs');
const config = require('../../config');
const p4 = require('../../lib/p4');

const { MK } = p4;

// ── formatting helpers (numbers → BR strings used by the generator payload) ──
function brMoney(n) {
  return Number(n).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function brDecimal(n) {
  return Number(n).toFixed(2).replace('.', ',');
}
function isoDate(dt) {
  return p4.localISO(dt);
}

// ── source mock (copied verbatim from p4-data.jsx) ──────────────────────────
const USERS = [
  { id: 'u1', nome: 'Diego Martins', email: 'diego@metodop4.com', papel: 'admin', iniciais: 'DM' },
  { id: 'u2', nome: 'Ana Prado', email: 'ana@metodop4.com', papel: 'analista', iniciais: 'AP' },
  { id: 'u3', nome: 'Bruno Reis', email: 'bruno@metodop4.com', papel: 'analista', iniciais: 'BR' },
  { id: 'u4', nome: 'Carla Nunes', email: 'carla@metodop4.com', papel: 'analista', iniciais: 'CN' },
];

const SAMPLE_AGENDAS = [
  { freq: 'Semanal', diaSemana: 'Segunda' },
  { freq: 'Semanal', diaSemana: 'Terça' },
  { freq: 'Quinzenal', diaSemana: 'Quarta' },
  { freq: 'Semanal', diaSemana: 'Sexta' },
  { freq: 'Mensal', diaMes: 5 },
  { freq: 'Semanal', diaSemana: 'Segunda' },
  { freq: 'Semanal', diaSemana: 'Quinta' },
  { freq: 'Mensal', diaMes: 1 },
  { freq: 'Semanal', diaSemana: 'Segunda' },
];

const RAW = [
  { id: 'c1', loja: 'Casa & Conforto', tipo: 'Loja', analista: 'Ana Prado', contas: [
    ['Mercado Livre', { fat: 184200, roas: 5.12, acos: 18.4, metaRoas: 4, last: '2026-06-22', n: 24 }],
    ['Shopee', { fat: 71400, roas: 4.05, acos: 22.1, metaRoas: 4, last: '2026-06-22', n: 16 }],
  ] },
  { id: 'c2', loja: 'TechNova Store', tipo: 'Loja', analista: 'Bruno Reis', contas: [
    ['Amazon', { fat: 312800, roas: 6.3, acos: 14.1, metaRoas: 4.5, last: '2026-06-21', n: 31 }],
    ['Mercado Livre', { fat: 198400, roas: 5.48, acos: 17.0, metaRoas: 4.5, last: '2026-06-21', n: 28 }],
    ['Tiktok', { fat: 64200, roas: 3.71, acos: 26.9, metaRoas: 4, last: '2026-06-08', n: 6 }],
  ] },
  { id: 'c3', loja: 'Moda Viva', tipo: 'Marca', analista: 'Carla Nunes', contas: [
    ['Shopee', { fat: 96400, roas: 3.42, acos: 26.7, metaRoas: 4, last: '2026-06-08', n: 12 }],
    ['Tiktok', { fat: 58300, roas: 4.88, acos: 19.4, metaRoas: 4, last: '2026-06-22', n: 9 }],
  ] },
  { id: 'c4', loja: 'Pet Família', tipo: 'Loja', analista: 'Ana Prado', contas: [
    ['Mercado Livre', { fat: 142600, roas: 4.78, acos: 19.9, metaRoas: 4, last: '2026-06-22', n: 18 }],
  ] },
  { id: 'c5', loja: 'Verde Folha Cosméticos', tipo: 'Marca', analista: 'Bruno Reis', contas: [
    ['Magalu', { fat: 78900, roas: 3.88, acos: 23.1, metaRoas: 4, last: '2026-06-09', n: 9 }],
    ['Amazon', { fat: 61200, roas: 4.42, acos: 20.0, metaRoas: 4, last: '2026-06-22', n: 11 }],
  ] },
  { id: 'c6', loja: 'Atlético Suplementos', tipo: 'Loja', analista: 'Carla Nunes', contas: [
    ['Amazon', { fat: 256300, roas: 5.64, acos: 16.2, metaRoas: 4.5, last: '2026-06-22', n: 27 }],
  ] },
  { id: 'c7', loja: 'Lar Doce Decor', tipo: 'Loja', analista: 'Ana Prado', contas: [
    ['Shopee', { fat: 64100, roas: 4.21, acos: 21.5, metaRoas: 4, last: '2026-06-22', n: 14 }],
    ['Magalu', { fat: 39800, roas: 3.64, acos: 24.8, metaRoas: 4, last: '2026-06-05', n: 8 }],
  ] },
  { id: 'c8', loja: 'Kids & Cia', tipo: 'Loja', analista: 'Bruno Reis', contas: [
    ['Tiktok', { fat: 51200, roas: 2.97, acos: 31.8, metaRoas: 4, last: '2026-06-01', n: 7 }],
  ] },
  { id: 'c9', loja: 'Gourmet Express', tipo: 'Marca', analista: 'Carla Nunes', contas: [
    ['Magalu', { fat: 173400, roas: 5.05, acos: 18.0, metaRoas: 4, last: '2026-06-22', n: 21 }],
    ['Mercado Livre', { fat: 121900, roas: 4.66, acos: 19.2, metaRoas: 4, last: '2026-06-22', n: 19 }],
  ] },
];

// ── report generation (genReports from p4-data.jsx, extended to full payload) ─
function buildAccountReports(client, mk, seed) {
  const short = MK[mk].short;
  const accountId = `${client.id}-${short.toLowerCase()}`;
  const metaRoasStr = brDecimal(seed.metaRoas);
  const reports = [];

  let fat = seed.fat;
  let roas = seed.roas;
  let acos = seed.acos;
  let end = new Date(seed.last + 'T00:00:00');

  for (let i = 0; i < seed.n; i++) {
    const fim = new Date(end);
    const ini = new Date(end);
    ini.setDate(ini.getDate() - 6);
    const periodoIni = isoDate(ini);
    const periodoFim = isoDate(fim);

    // Plausible, roughly-consistent supporting figures for this period.
    const receitaAds = Math.round(fat * 0.6);
    const investimento = Math.max(1, Math.round(receitaAds / (roas || 1)));
    const vendas = Math.max(1, Math.round(fat / 120));
    const vendasAds = Math.max(1, Math.round(vendas * 0.5));
    const tacos = (investimento / fat) * 100;

    // Full generator payload — metrics kept manual to preserve the exact
    // roas/acos series from the prototype (no auto-recalculation).
    const payload = {
      marketplace: mk,
      analista: client.analista,
      loja: client.loja,
      lojaTipo: client.tipo === 'Marca' ? 'Cliente' : 'Loja',
      periodicidade: 'Semanal',
      roasAuto: false,
      acosAuto: false,
      tacosAuto: false,
      periodoIni,
      periodoFim,
      faturamento: brMoney(fat),
      vendas: String(vendas),
      receitaAds: brMoney(receitaAds),
      vendasAds: String(vendasAds),
      investimento: brMoney(investimento),
      roas: brDecimal(roas),
      acos: brDecimal(acos),
      tacos: brDecimal(tacos),
      metaInvestimento: '20,00',
      metaRoas: metaRoasStr,
      metaAcos: '20,00',
      metaTacos: '15,00',
      obs: '',
      obsImages: [],
      status: {
        faturamento: 'pos', vendas: 'pos', receitaAds: 'pos', vendasAds: 'pos',
        investimento: 'pos', roas: 'pos', acos: 'pos', tacos: 'pos',
      },
      prev: [],
    };

    const nums = p4.deriveNumbers(payload);
    reports.push({
      id: `${client.id}-${short}-r${seed.n - i}`,
      account_id: accountId,
      periodo_ini: periodoIni,
      periodo_fim: periodoFim,
      criado_em: periodoFim, // sent date == period end (matches mock)
      faturamento: nums.faturamento,
      vendas: nums.vendas,
      receita_ads: nums.receitaAds,
      vendas_ads: nums.vendasAds,
      investimento: nums.investimento,
      roas: nums.roas,
      acos: nums.acos,
      tacos: nums.tacos,
      payload: JSON.stringify(payload),
    });

    // advance the series backwards in time (same factors as the prototype)
    fat = Math.round(fat * (0.86 + (i % 3) * 0.05));
    roas = +(roas * (0.94 + (i % 2) * 0.06)).toFixed(2);
    acos = +(acos * (1.04 - (i % 2) * 0.03)).toFixed(2);
    end.setDate(end.getDate() - 7);
  }

  return { accountId, reports };
}

exports.seed = async function seed(knex) {
  // Clear existing data (children first for FK safety).
  await knex('reports').del();
  await knex('accounts').del();
  await knex('clients').del();
  await knex('users').del();

  // Users — every mock user gets the same demo password (SEED_PASSWORD).
  const senha_hash = bcrypt.hashSync(config.seedPassword, 10);
  await knex('users').insert(
    USERS.map((u) => ({
      id: u.id,
      nome: u.nome,
      email: u.email.toLowerCase(),
      senha_hash,
      papel: u.papel,
      iniciais: u.iniciais,
    }))
  );

  const byName = Object.fromEntries(USERS.map((u) => [u.nome, u.id]));

  const clientRows = [];
  const accountRows = [];
  const reportRows = [];

  RAW.forEach((c, ci) => {
    const agenda = SAMPLE_AGENDAS[ci % SAMPLE_AGENDAS.length];
    clientRows.push({
      id: c.id,
      loja: c.loja,
      tipo: c.tipo,
      analista_id: byName[c.analista],
      agenda_freq: agenda.freq,
      agenda_dia_semana: agenda.diaSemana || null,
      agenda_dia_mes: agenda.diaMes || null,
    });

    c.contas.forEach(([mk, sd]) => {
      const { accountId, reports } = buildAccountReports(c, mk, sd);
      accountRows.push({
        id: accountId,
        client_id: c.id,
        marketplace: mk,
        apelido: sd.conta || '',
        meta_investimento: sd.metaInvestimento || '20,00',
        meta_roas: brDecimal(sd.metaRoas),
        meta_acos: sd.metaAcos || '20,00',
        meta_tacos: sd.metaTacos || '15,00',
      });
      reportRows.push(...reports);
    });
  });

  await knex('clients').insert(clientRows);
  await knex('accounts').insert(accountRows);
  // chunk report inserts so SQLite's variable limit is never exceeded
  for (let i = 0; i < reportRows.length; i += 200) {
    await knex('reports').insert(reportRows.slice(i, i + 200));
  }

  // eslint-disable-next-line no-console
  console.log(
    `[seed] ${USERS.length} usuários, ${clientRows.length} clientes, ` +
      `${accountRows.length} contas, ${reportRows.length} relatórios.`
  );
};
