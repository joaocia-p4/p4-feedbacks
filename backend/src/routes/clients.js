// /clients — list (scoped, filtered), detail, and create/update/delete.
// Admins manage all clients; analysts manage only the clients they own
// (ownership is enforced in clientService). Also hosts the nested reports list.
const express = require('express');
const { validate } = require('../middleware/validate');
const { authenticate, requireManager } = require('../middleware/auth');
const {
  listClientsQuery,
  createClientSchema,
  updateClientSchema,
} = require('../validators/schemas');
const { asyncHandler, notFound } = require('../lib/errors');
const clientService = require('../services/clientService');
const reportService = require('../services/reportService');
const p4 = require('../lib/p4');

const router = express.Router();

router.use(authenticate);

// GET /clients?due=YYYY-MM-DD&q=&marketplace=&status=
router.get(
  '/',
  validate(listClientsQuery, 'query'),
  asyncHandler(async (req, res) => {
    const { clients, meta } = await clientService.listClients(req.user, req.valid.query);
    res.json({ clients, meta });
  })
);

// GET /clients/:id  → client + contas + agenda (+ reports per conta)
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const client = await clientService.getClientDetail(req.params.id, req.user);
    res.json({ client });
  })
);

// POST /clients  (admin: qualquer analista · analista: para si mesmo · CS: bloqueado)
router.post(
  '/',
  requireManager,
  validate(createClientSchema),
  asyncHandler(async (req, res) => {
    const client = await clientService.createClient(req.valid.body, req.user);
    res.status(201).json({ client });
  })
);

// PUT /clients/:id  (admin: todos · analista: só os seus · CS: bloqueado)
router.put(
  '/:id',
  requireManager,
  validate(updateClientSchema),
  asyncHandler(async (req, res) => {
    const client = await clientService.updateClient(req.params.id, req.valid.body, req.user);
    res.json({ client });
  })
);

// DELETE /clients/:id  (admin: todos · analista: só os seus · CS: bloqueado)
router.delete(
  '/:id',
  requireManager,
  asyncHandler(async (req, res) => {
    const result = await clientService.deleteClient(req.params.id, req.user);
    res.json({ ok: true, ...result });
  })
);

// GET /clients/:id/accounts/:accId/reports
router.get(
  '/:id/accounts/:accId/reports',
  asyncHandler(async (req, res) => {
    const account = await clientService.getAccountForRead(req.params.accId, req.user);
    if (account.client_id !== req.params.id) {
      throw notFound('Conta não pertence a este cliente.');
    }
    const reports = await reportService.listForAccount(
      account.id,
      p4.parseNum(account.meta_roas)
    );
    res.json({ reports });
  })
);

module.exports = router;
