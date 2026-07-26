// monthlyClosing — regras do fechamento mensal. Puras: sem banco, sem relógio.

const { ratios, reportMonth } = require('./metrics');
const p4 = require('./p4');

// Primeiro e último dia de 'YYYY-MM'. Date.UTC(y, m, 0) = último dia do mês m
// (índice m já é o mês seguinte em base 0), então cobre bissexto de graça.
function monthRange(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { ini: `${ym}-01`, fim: `${ym}-${String(ultimo).padStart(2, '0')}` };
}

// Uma conta entra no mês por duas portas independentes:
//  1. teve relatório no mês — evidência direta de operação, vale mesmo que a
//     conta esteja encerrada hoje;
//  2. a janela de datas cobre o mês.
// A porta 2 é o que evita listar conta cadastrada em setembro no fechamento de
// julho; a porta 1 é o que mantém conta encerrada em agosto no fechamento de julho.
function accountInMonth(conta, ym, temRelatorio) {
  if (temRelatorio) return true;
  const { ini, fim } = monthRange(ym);
  const entrada = conta.dataEntrada || conta.criadoEm || null;
  if (entrada && String(entrada).slice(0, 10) > fim) return false;
  const saida = conta.dataEncerramento || null;
  if (saida && String(saida).slice(0, 10) < ini) return false;
  return true; // sem data de entrada conhecida: assume que já existia
}

const num = (v) => (Number(v) || 0);

// Soma os relatórios do período e deriva as razões DA SOMA. Média de razões
// daria peso igual a uma semana de R$100 e a uma de R$100.000.
function consolidate(rows) {
  const t = (rows || []).reduce(
    (a, r) => ({
      faturamento: a.faturamento + num(r.faturamento),
      vendas: a.vendas + num(r.vendas),
      receitaAds: a.receitaAds + num(r.receita_ads),
      vendasAds: a.vendasAds + num(r.vendas_ads),
      investimento: a.investimento + num(r.investimento),
    }),
    { faturamento: 0, vendas: 0, receitaAds: 0, vendasAds: 0, investimento: 0 }
  );
  return { ...t, ...ratios(t.faturamento, t.investimento, t.receitaAds) };
}

// Compara um valor consolidado com a meta cadastrada da conta.
// direcao: 'piso' (ROAS — quanto mais alto melhor) | 'teto' (ACOS/TACOS).
// Devolve null quando não há meta ou não há valor: meta ausente NÃO é meta
// não batida, e a tela precisa distinguir "—" de "✗".
function metaStatus(valor, metaRaw, direcao) {
  const meta = p4.parseNum(metaRaw);
  if (!(meta > 0)) return null;
  if (valor === null || valor === undefined) return null;
  if (direcao === 'piso') return valor >= meta;
  if (direcao === 'teto') return valor <= meta;
  throw new Error(`direcao desconhecida: "${direcao}". Use 'piso' ou 'teto'.`);
}

// Monta a tela inteira: uma linha por cliente que operou no mês, cada uma com
// as contas detalhadas. Recebe tudo pronto do service e não toca o banco.
function buildMonthlyClosing({ clients, reports, closings, ym }) {
  // relatórios DO MÊS, agrupados por conta
  const porConta = new Map();
  for (const r of reports || []) {
    if (reportMonth(r) !== ym) continue;
    if (!porConta.has(r.account_id)) porConta.set(r.account_id, []);
    porConta.get(r.account_id).push(r);
  }
  const fechamentos = new Map((closings || []).map((c) => [c.client_id, c]));

  const linhas = [];
  for (const c of clients || []) {
    const contas = [];
    for (const a of c.contas || []) {
      const rows = porConta.get(a.id) || [];
      if (!accountInMonth(a, ym, rows.length > 0)) continue;
      const totals = consolidate(rows);
      contas.push({
        accountId: a.id,
        marketplace: a.marketplace,
        conta: a.conta || '',
        nReports: rows.length,
        totals,
        metas: {
          investimento: a.metaInvestimento || '',
          roas: a.metaRoas || '',
          acos: a.metaAcos || '',
          tacos: a.metaTacos || '',
        },
        atingiu: {
          roas: metaStatus(totals.roas, a.metaRoas, 'piso'),
          acos: metaStatus(totals.acos, a.metaAcos, 'teto'),
          tacos: metaStatus(totals.tacos, a.metaTacos, 'teto'),
        },
      });
    }
    if (!contas.length) continue; // nenhuma conta operou no mês → cliente fora

    // total do cliente: soma as somas das contas e recalcula as razões
    const soma = contas.reduce(
      (a, x) => ({
        faturamento: a.faturamento + x.totals.faturamento,
        vendas: a.vendas + x.totals.vendas,
        receitaAds: a.receitaAds + x.totals.receitaAds,
        vendasAds: a.vendasAds + x.totals.vendasAds,
        investimento: a.investimento + x.totals.investimento,
      }),
      { faturamento: 0, vendas: 0, receitaAds: 0, vendasAds: 0, investimento: 0 }
    );
    const f = fechamentos.get(c.id) || null;
    linhas.push({
      clientId: c.id,
      loja: c.loja,
      analista: c.analista || '—',
      statusTag: c.statusTag,
      nReports: contas.reduce((n, x) => n + x.nReports, 0),
      totals: { ...soma, ...ratios(soma.faturamento, soma.investimento, soma.receitaAds) },
      contas,
      closing: f
        ? { observacoes: f.observacoes || '', fechadoEm: f.fechado_em || null, fechadoPor: f.fechado_por || null }
        : null,
    });
  }

  // pendentes primeiro (é o que falta fazer), depois faturamento desc, depois nome
  linhas.sort((a, b) => {
    const fa = a.closing && a.closing.fechadoEm ? 1 : 0;
    const fb = b.closing && b.closing.fechadoEm ? 1 : 0;
    return fa - fb
      || b.totals.faturamento - a.totals.faturamento
      || String(a.loja).localeCompare(String(b.loja), 'pt-BR');
  });

  const fechados = linhas.filter((l) => l.closing && l.closing.fechadoEm).length;
  return {
    ym,
    resumo: {
      clientes: linhas.length,
      fechados,
      pendentes: linhas.length - fechados,
      semRelatorio: linhas.filter((l) => l.nReports === 0).length,
    },
    clients: linhas,
  };
}

module.exports = { monthRange, accountInMonth, consolidate, metaStatus, buildMonthlyClosing };
