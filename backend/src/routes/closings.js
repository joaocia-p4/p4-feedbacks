// /closings — fechamento mensal dos clientes.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../lib/errors');
const closingService = require('../services/closingService');
const { todayISO } = require('../lib/p4');

const router = express.Router();
router.use(authenticate);

const mesCorrente = () => todayISO().slice(0, 7);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ym = req.query.ym || mesCorrente();
    if (!closingService.isValidYm(ym)) throw badRequest('Mês inválido. Use o formato AAAA-MM.');
    res.json(await closingService.getMonthlyClosing(req.user, ym));
  })
);

router.put(
  '/:clientId/:ym',
  asyncHandler(async (req, res) => {
    const { clientId, ym } = req.params;
    if (!closingService.isValidYm(ym)) throw badRequest('Mês inválido. Use o formato AAAA-MM.');
    const { observacoes, fechado } = req.body || {};
    if (observacoes === undefined && fechado === undefined) {
      throw badRequest('Nada para salvar: informe observacoes e/ou fechado.');
    }
    if (observacoes !== undefined && typeof observacoes !== 'string') {
      throw badRequest('observacoes deve ser texto.');
    }
    if (fechado !== undefined && typeof fechado !== 'boolean') {
      throw badRequest('fechado deve ser true ou false.');
    }
    const closing = await closingService.saveClosing(req.user, clientId, ym, { observacoes, fechado });
    res.json({ closing });
  })
);

// Valor de lançamento: número finito e não negativo, ou null (campo em branco).
function valorValido(v) {
  return v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
}

router.put(
  '/:clientId/:ym/figures',
  asyncHandler(async (req, res) => {
    const { clientId, ym } = req.params;
    if (!closingService.isValidYm(ym)) throw badRequest('Mês inválido. Use o formato AAAA-MM.');
    const contas = (req.body || {}).contas;
    if (!Array.isArray(contas)) throw badRequest('Informe contas como uma lista.');
    for (const c of contas) {
      if (!c || typeof c.accountId !== 'string' || !c.accountId) {
        throw badRequest('Cada conta precisa de um accountId.');
      }
      if (!valorValido(c.faturamento) || !valorValido(c.investimento) || !valorValido(c.receitaAds)) {
        throw badRequest('Faturamento, investimento e receita de Ads devem ser números não negativos ou vazios.');
      }
    }
    res.json(await closingService.saveFigures(req.user, clientId, ym, contas));
  })
);

module.exports = router;
