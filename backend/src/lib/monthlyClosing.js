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

module.exports = { monthRange, accountInMonth, consolidate, metaStatus };
