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

module.exports = router;
