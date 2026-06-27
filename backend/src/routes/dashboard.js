// /dashboard — painel de acompanhamento (admin e CS).
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, forbidden } = require('../lib/errors');
const dashboardService = require('../services/dashboardService');

const router = express.Router();

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    if (req.user.papel !== 'admin' && req.user.papel !== 'cs') {
      throw forbidden('Painel disponível para administradores e CS.');
    }
    res.json(await dashboardService.getDashboard(req.user));
  })
);

module.exports = router;
