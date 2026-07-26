// dashboardAggregates — agregações puras do Painel CS.
// Todas recebem clientes já enriquecidos (com statusTag/contas) e não tocam o
// banco, então são testáveis direto.
//
// byManager: uma linha por gestor, com a carteira viva quebrada por situação.
// Recebe a lista COMPLETA (com encerrados) — é o único ponto do painel que os
// conta; todo o resto segue usando só a carteira viva.

const SEM_GESTOR = '—';

function novaLinha(analista) {
  return { analista, emDia: 0, atrasado: 0, onboarding: 0, pausado: 0, encerrado: 0 };
}

// statusTag → fatia. A precedência (Encerrado > Pausado > Onboarding > Atrasado >
// Enviar hoje > Em dia) já foi resolvida por lib/clientAggregate; aqui só se
// escolhe o balde. "Enviar hoje" é um cliente em dia que vence hoje.
function fatiaDe(statusTag) {
  switch (statusTag) {
    case 'encerrado': return 'encerrado';
    case 'pausado': return 'pausado';
    case 'onboarding': return 'onboarding';
    case 'atrasado': return 'atrasado';
    default: return 'emDia'; // 'em-dia' e 'hoje'
  }
}

function byManager(clients) {
  const grupos = new Map();

  for (const c of clients || []) {
    const k = c.analista || SEM_GESTOR;
    if (!grupos.has(k)) grupos.set(k, novaLinha(k));
    grupos.get(k)[fatiaDe(c.statusTag)]++;
  }

  return [...grupos.values()]
    .map((g) => {
      // "ativo" = cliente rodando, atrasado ou não. emDia/atrasado seguem no
      // payload para a tela dedicada que vai detalhar a composição.
      const ativos = g.emDia + g.atrasado;
      const carteira = ativos + g.onboarding + g.pausado;
      return {
        ...g,
        ativos,
        carteira,
        total: carteira + g.encerrado,
        // compat: o payload já expunha estes dois e eles seguem valendo o mesmo
        clients: carteira,
        overdue: g.atrasado,
      };
    })
    .sort((a, b) =>
      b.carteira - a.carteira ||
      b.total - a.total ||
      a.analista.localeCompare(b.analista, 'pt-BR')
    );
}

// Nº de contas em operação nos clientes recebidos. Conta encerrada (`ativo:false`)
// sai; conta pausada fica — ela existe e é gerenciada, só não cobra relatório.
// Quem chama decide o recorte passando a lista certa (o painel passa a carteira
// viva, sem clientes encerrados).
function countActiveAccounts(clients) {
  return (clients || []).reduce(
    (sum, c) => sum + (c.contas || []).filter((a) => a.ativo !== false).length,
    0
  );
}

module.exports = { byManager, countActiveAccounts, SEM_GESTOR };
