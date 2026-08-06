// faturometroService — a LEITURA do Faturômetro. Monta o payload da tela a
// partir do banco, sem tocar no Mercado Livre: o GET tem de responder rápido
// porque a tela consulta a cada 30s. Quem fala com o ML é lib/faturometroSync,
// em segundo plano.
//
// De onde vem cada número:
//   - hoje e a curva por hora → do LIVRO (hoje e ontem estão sempre na janela);
//   - totais do mês → do CONSOLIDADO (faturometro_daily).
const db = require('../db/knex');
const { todayISO } = require('../lib/p4');
const {
  addDaysISO, sumOrders, untilTimeOfDay, hourlySeries, variacao,
  previousMonthWindow, businessTimeOf, round2,
} = require('../lib/faturometro');
const sync = require('../lib/faturometroSync');

// Contas no escopo + a que cliente pertencem. Conta encerrada (ativo=false) sai:
// é o que implementa "cliente Encerrado fora da soma" e ainda descarta contas
// encerradas de clientes que seguem ativos.
function scopedRows() {
  return db('meli_connections')
    .join('accounts', 'accounts.id', 'meli_connections.account_id')
    .join('clients', 'clients.id', 'accounts.client_id')
    .whereNot('accounts.ativo', false)
    .select(
      'accounts.id as accountId',
      'clients.id as clienteId',
      'clients.loja as cliente'
    );
}

// Agrupa uma lista por uma coluna, numa passada. A alternativa — filtrar a lista
// inteira por conta, dentro do laço de contas — é O(contas × pedidos): na escala
// da carteira dá centenas de milhares de iterações por request, e o GET responde
// a cada 30 s.
function agrupar(lista, campo) {
  const m = new Map();
  for (const r of lista) {
    const chave = r[campo];
    const atual = m.get(chave);
    if (atual) atual.push(r);
    else m.set(chave, [r]);
  }
  return m;
}
const vazio = [];
const de = (mapa, chave) => mapa.get(chave) || vazio;

function somaDaily(rows) {
  return round2(rows.reduce((s, r) => s + (Number(r.faturamento) || 0), 0));
}

// hojeISO (opcional): mesmo padrão de backfillProgress/backfillStep em
// lib/faturometroSync.js — usado pelos testes para fixar o dia sem depender do
// relógio real (ex.: a borda do dia 31, em que o mês anterior não tem o dia
// equivalente). A rota chama sem argumento e usa o dia real do negócio.
async function getFaturometro(hojeISO) {
  const hoje = hojeISO || todayISO();
  const ontem = addDaysISO(hoje, -1);
  const agoraHHMMSS = businessTimeOf(new Date());
  const janela = previousMonthWindow(hoje);
  const mesYm = hoje.slice(0, 7);

  const contas = await scopedRows();
  const ids = contas.map((c) => c.accountId);

  // Sem nenhuma conta conectada a tela mostra o estado vazio.
  if (!ids.length) {
    sync.kick();
    return {
      agora: new Date().toISOString(),
      hoje: { faturamento: 0, pedidos: 0, unidades: 0, compradores: 0, precoMedio: 0, ontemAteAgora: 0, variacao: null },
      mes: { ym: mesYm, faturamento: 0, anteriorAteAgora: 0, variacao: null, anteriorParcial: janela.parcial },
      porHora: hourlySeries([], []),
      contas: { conectadas: 0, comErro: 0 },
      backfill: { pronto: true, progresso: 1, etapa: null },
      clientes: [],
    };
  }

  const [livro, daily, syncs] = await Promise.all([
    db('faturometro_orders').whereIn('account_id', ids)
      .whereIn('dia', [hoje, ontem, janela.diaParcial].filter(Boolean)),
    db('faturometro_daily').whereIn('account_id', ids)
      .where((q) => q.whereBetween('dia', [`${mesYm}-01`, hoje])
        .orWhereBetween('dia', [`${janela.ym}-01`, janela.completosAte || `${janela.ym}-01`])),
    db('faturometro_sync').whereIn('account_id', ids),
  ]);

  const erroPorConta = new Map(syncs.filter((s) => s.erro).map((s) => [s.account_id, s.erro]));

  const livroPorDia = agrupar(livro, 'dia');
  const doDia = (dia) => de(livroPorDia, dia);
  const hojePedidos = doDia(hoje);
  const ontemPedidos = doDia(ontem);

  const totHoje = sumOrders(hojePedidos);
  const ontemAteAgora = sumOrders(untilTimeOfDay(ontemPedidos, agoraHHMMSS)).faturamento;

  // Mês atual: consolidado do dia 1 até hoje (hoje incluso e parcial).
  const mesRows = daily.filter((r) => r.dia >= `${mesYm}-01` && r.dia <= hoje);
  const mesFaturamento = somaDaily(mesRows);

  // Mês anterior: dias completos + o dia equivalente cortado pelo horário. Quando
  // o mês anterior não tem o dia de hoje, compara-se com ele inteiro.
  const antCompletos = janela.completosAte
    ? daily.filter((r) => r.dia >= `${janela.ym}-01` && r.dia <= janela.completosAte)
    : [];
  // O corte pelo horário sai UMA vez, aqui, e não uma vez por conta: é ele que
  // paga businessTimeOf por pedido.
  const antParcialPedidos = janela.diaParcial
    ? untilTimeOfDay(doDia(janela.diaParcial), agoraHHMMSS)
    : [];
  const antParcial = sumOrders(antParcialPedidos).faturamento;
  const mesAnterior = round2(somaDaily(antCompletos) + antParcial);

  // Uma linha por CLIENTE, somando as contas dele. Cada lista é indexada por
  // conta uma vez só — reencontrar as linhas de cada conta varrendo a lista
  // inteira custava O(contas × pedidos) por request.
  const hojePorConta = agrupar(hojePedidos, 'account_id');
  const mesPorConta = agrupar(mesRows, 'account_id');
  const antPorConta = agrupar(antCompletos, 'account_id');
  const antParcialPorConta = agrupar(antParcialPedidos, 'account_id');

  const porCliente = new Map();
  for (const c of contas) {
    if (!porCliente.has(c.clienteId)) {
      porCliente.set(c.clienteId, {
        clienteId: c.clienteId, cliente: c.cliente, contas: 0,
        hoje: 0, mes: 0, anterior: 0, erro: null,
      });
    }
    const linha = porCliente.get(c.clienteId);
    linha.contas += 1;
    linha.hoje = round2(linha.hoje + sumOrders(de(hojePorConta, c.accountId)).faturamento);
    linha.mes = round2(linha.mes + somaDaily(de(mesPorConta, c.accountId)));
    linha.anterior = round2(
      linha.anterior +
      somaDaily(de(antPorConta, c.accountId)) +
      sumOrders(de(antParcialPorConta, c.accountId)).faturamento
    );
    if (erroPorConta.has(c.accountId)) linha.erro = erroPorConta.get(c.accountId);
  }

  const clientes = [...porCliente.values()]
    .map((l) => ({
      clienteId: l.clienteId, cliente: l.cliente, contas: l.contas,
      hoje: l.hoje, mes: l.mes, variacaoMes: variacao(l.mes, l.anterior), erro: l.erro,
    }))
    .sort((a, b) => b.hoje - a.hoje || a.cliente.localeCompare(b.cliente, 'pt-BR'));

  const backfill = await sync.backfillProgress(hoje);

  // Dispara o trabalho de segundo plano DEPOIS de ter tudo em mãos: a resposta
  // não espera o Mercado Livre; a correção entra no polling seguinte.
  sync.kick();

  return {
    agora: new Date().toISOString(),
    hoje: {
      faturamento: totHoje.faturamento,
      pedidos: totHoje.pedidos,
      unidades: totHoje.unidades,
      compradores: totHoje.compradores,
      precoMedio: totHoje.precoMedio,
      ontemAteAgora,
      variacao: variacao(totHoje.faturamento, ontemAteAgora),
    },
    mes: {
      ym: mesYm,
      faturamento: mesFaturamento,
      anteriorAteAgora: mesAnterior,
      variacao: variacao(mesFaturamento, mesAnterior),
      anteriorParcial: janela.parcial,
    },
    porHora: hourlySeries(hojePedidos, ontemPedidos),
    contas: { conectadas: contas.length, comErro: erroPorConta.size },
    backfill,
    clientes,
  };
}

module.exports = { getFaturometro };
