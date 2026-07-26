// metrics — regras de métrica compartilhadas entre o Painel CS e o Fechamento
// mensal. Puras: sem banco, sem relógio.

// A que mês pertence um relatório. O fim do período manda: uma semana que
// atravessa a virada (29/06–05/07) é relatório de julho, inteira. Ratear entre
// dois meses seria mais fiel e bem mais complexo — o relatório é indivisível.
// Recebe a linha crua do banco (snake_case).
function reportMonth(row) {
  const raw = String((row && (row.periodo_fim || row.periodo_ini || row.criado_em)) || '');
  const m = raw.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? m : null;
}

// ROAS/ACOS/TACOS a partir de valores JÁ SOMADOS — nunca média de razões.
// Denominador zero devolve null (não dá para afirmar a razão), nunca 0 nem Infinity.
function ratios(faturamento, investimento, receitaAds) {
  return {
    roas: investimento > 0 ? +(receitaAds / investimento).toFixed(2) : null,
    acos: receitaAds > 0 ? +((investimento / receitaAds) * 100).toFixed(1) : null,
    tacos: faturamento > 0 ? +((investimento / faturamento) * 100).toFixed(1) : null,
  };
}

module.exports = { reportMonth, ratios };
