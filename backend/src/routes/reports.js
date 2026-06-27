// /accounts/:accId/reports (create) and /reports/:id (delete).
const express = require('express');
const { validate } = require('../middleware/validate');
const { authenticate, requireAdmin, requireManager } = require('../middleware/auth');
const { reportPayloadSchema } = require('../validators/schemas');
const { asyncHandler, badRequest, notFound } = require('../lib/errors');
const db = require('../db/knex');
const clientService = require('../services/clientService');
const reportService = require('../services/reportService');

const router = express.Router();

router.use(authenticate);

// POST /accounts/:accId/reports  → create a report from the generator payload.
// Allowed for an admin or the owning analyst (CS é somente leitura).
router.post(
  '/accounts/:accId/reports',
  requireManager,
  validate(reportPayloadSchema),
  asyncHandler(async (req, res) => {
    const account = await clientService.getAccountForWrite(req.params.accId, req.user);
    const payload = req.valid.body;

    // If the payload names a marketplace, it must match the account's.
    if (payload.marketplace && payload.marketplace !== account.marketplace) {
      throw badRequest(
        `O marketplace do relatório (${payload.marketplace}) não corresponde ao da conta (${account.marketplace}).`
      );
    }

    const { reports, overwritten } = await reportService.createReport(account, payload);
    res.status(201).json({ reports, created: reports.length, overwritten });
  })
);

// DELETE /reports/:id  (admin)
router.delete(
  '/reports/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    // Confirm the report exists (and surface a clean 404 otherwise).
    const row = await db('reports').where({ id: req.params.id }).first();
    if (!row) throw notFound('Relatório não encontrado.');
    await reportService.deleteReport(req.params.id);
    res.json({ ok: true, id: req.params.id });
  })
);

module.exports = router;
