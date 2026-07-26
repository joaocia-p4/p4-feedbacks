// monthlyClosing — regras do fechamento mensal. Puras: sem banco, sem relógio.

const { ratios } = require('./metrics');
const p4 = require('./p4');

// Primeiro e último dia de 'YYYY-MM'. Date.UTC(y, m, 0) = último dia do mês m
// (índice m já é o mês seguinte em base 0), então cobre bissexto de graça.
function monthRange(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { ini: `${ym}-01`, fim: `${ym}-${String(ultimo).padStart(2, '0')}` };
}

// Uma conta entra no mês por duas portas independentes:
//  1. tem lançamento naquele mês — se alguém registrou número ali, a conta
//     aparece, mesmo que a janela de datas diga o contrário;
//  2. a janela de datas cobre o mês.
// A porta 2 é o que evita listar conta cadastrada em setembro no fechamento de
// julho; a porta 1 é o que mantém conta encerrada em agosto no fechamento de
// julho, se julho foi lançado.
function accountInMonth(conta, ym, temLancamento) {
  if (temLancamento) return true;
  const { ini, fim } = monthRange(ym);
  const entrada = conta.dataEntrada || conta.criadoEm || null;
  if (entrada && String(entrada).slice(0, 10) > fim) return false;
  const saida = conta.dataEncerramento || null;
  if (saida && String(saida).slice(0, 10) < ini) return false;
  return true; // sem data de entrada conhecida: assume que já existia
}

const num = (v) => (Number(v) || 0);

// Compara um valor consolidado com a meta cadastrada da conta.
// direcao: 'piso' (ROAS — quanto mais alto melhor) | 'teto' (ACOS/TACOS).
// Devolve null quando não há meta ou não há valor: meta ausente NÃO é meta
// não batida, e a tela precisa distinguir "—" de "✗".
// Duplicada de propósito em `mcMetaStatus()`
// (design_handoff_sistema_feedbacks/p4-closing.jsx), que dá a prévia ao
// digitar sem esperar o backend. Esta aqui é a versão testada e é o que vai
// em `atingiu` no payload; a outra não tem cobertura de teste. Mudou a regra
// aqui, muda lá também — as duas têm que ficar em sincronia.
function metaStatus(valor, metaRaw, direcao) {
  const meta = p4.parseNum(metaRaw);
  if (!(meta > 0)) return null;
  if (valor === null || valor === undefined) return null;
  if (direcao === 'piso') return valor >= meta;
  if (direcao === 'teto') return valor <= meta;
  throw new Error(`direcao desconhecida: "${direcao}". Use 'piso' ou 'teto'.`);
}

// Conta sem lançamento: tudo nulo, para a tela mostrar "—". Nunca zero — zero
// seria afirmar que não faturou, e ninguém afirmou nada.
const SEM_LANCAMENTO = {
  faturamento: null, investimento: null, receitaAds: null,
  roas: null, acos: null, tacos: null,
};

// Números de um lançamento, com as razões derivadas deles.
function totaisDoLancamento(fig) {
  const faturamento = num(fig.faturamento);
  const investimento = num(fig.investimento);
  const receitaAds = num(fig.receita_ads);
  return { faturamento, investimento, receitaAds, ...ratios(faturamento, investimento, receitaAds) };
}

// Monta a tela: uma linha por cliente com conta no mês, cada uma detalhada por
// conta. Recebe tudo pronto do service e não toca o banco.
function buildMonthlyClosing({ clients, figures, closings, ym }) {
  const porConta = new Map();
  for (const f of figures || []) {
    if (f.ym !== ym) continue;
    porConta.set(f.account_id, f);
  }
  const fechamentos = new Map((closings || []).map((c) => [c.client_id, c]));

  const linhas = [];
  for (const c of clients || []) {
    const contas = [];
    for (const a of c.contas || []) {
      const fig = porConta.get(a.id) || null;
      if (!accountInMonth(a, ym, !!fig)) continue;
      const totals = fig ? totaisDoLancamento(fig) : SEM_LANCAMENTO;
      contas.push({
        accountId: a.id,
        marketplace: a.marketplace,
        conta: a.conta || '',
        lancado: !!fig,
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
    if (!contas.length) continue; // nenhuma conta no mês → cliente fora

    // total do cliente: soma só as contas lançadas e recalcula as razões DA
    // SOMA. Nenhuma lançada → tudo nulo, mesmo critério da conta.
    const lancadas = contas.filter((x) => x.lancado);
    const soma = lancadas.reduce(
      (a, x) => ({
        faturamento: a.faturamento + x.totals.faturamento,
        investimento: a.investimento + x.totals.investimento,
        receitaAds: a.receitaAds + x.totals.receitaAds,
      }),
      { faturamento: 0, investimento: 0, receitaAds: 0 }
    );
    const totals = lancadas.length
      ? { ...soma, ...ratios(soma.faturamento, soma.investimento, soma.receitaAds) }
      : SEM_LANCAMENTO;

    const f = fechamentos.get(c.id) || null;
    linhas.push({
      clientId: c.id,
      loja: c.loja,
      analista: c.analista || '—',
      statusTag: c.statusTag,
      incompleto: contas.some((x) => !x.lancado),
      totals,
      contas,
      closing: f
        ? { observacoes: f.observacoes || '', fechadoEm: f.fechado_em || null, fechadoPor: f.fechado_por || null }
        : null,
    });
  }

  // pendentes primeiro (é o que falta fazer), depois faturamento desc, depois
  // nome. Faturamento nulo entra como 0 na comparação, senão a subtração vira NaN.
  const fat = (l) => l.totals.faturamento || 0;
  linhas.sort((a, b) => {
    const fa = a.closing && a.closing.fechadoEm ? 1 : 0;
    const fb = b.closing && b.closing.fechadoEm ? 1 : 0;
    return fa - fb
      || fat(b) - fat(a)
      || String(a.loja).localeCompare(String(b.loja), 'pt-BR');
  });

  const fechados = linhas.filter((l) => l.closing && l.closing.fechadoEm).length;
  return {
    ym,
    resumo: {
      clientes: linhas.length,
      fechados,
      pendentes: linhas.length - fechados,
      incompletos: linhas.filter((l) => l.incompleto).length,
    },
    clients: linhas,
  };
}

module.exports = { monthRange, accountInMonth, metaStatus, buildMonthlyClosing };
