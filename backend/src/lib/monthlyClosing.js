// monthlyClosing — regras do fechamento mensal. Puras: sem banco, sem relógio.

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

module.exports = { monthRange, accountInMonth };
