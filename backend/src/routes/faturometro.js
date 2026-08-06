// /faturometro — faturamento da carteira ao vivo. Exclusivo de admin: é o número
// da agência inteira.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, forbidden } = require('../lib/errors');
const db = require('../db/knex');
const faturometroService = require('../services/faturometroService');
const sync = require('../lib/faturometroSync');

const router = express.Router();

function somenteAdmin(req) {
  if (req.user.papel !== 'admin') {
    throw forbidden('Faturômetro disponível apenas para administradores.');
  }
}

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    somenteAdmin(req);
    res.json(await faturometroService.getFaturometro());
  })
);

// Força a conferência de todas as contas. Enfileira e responde na hora: com 40+
// contas, esperar a fila terminar estouraria o tempo da requisição. O resultado
// aparece no polling seguinte.
router.post(
  '/reconciliar',
  authenticate,
  asyncHandler(async (req, res) => {
    somenteAdmin(req);
    await db('faturometro_sync').update({ reconciliado_em: null });
    sync.kick();
    res.json({ ok: true });
  })
);

module.exports = router;
