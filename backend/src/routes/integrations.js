// /integrations/mercadolivre — OAuth (conectar conta), callback, status,
// desconectar, e ferramentas de diagnóstico (sonda + explorador da API).
const express = require('express');
const { authenticate, requireManager, requireAdmin } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../lib/errors');
const config = require('../config');
const db = require('../db/knex');
const clientService = require('../services/clientService');
const meli = require('../services/meliService');

const router = express.Router();
const FRONT = config.frontendUrl;

function frontRedirect(res, status) {
  if (FRONT) return res.redirect(`${FRONT}/?meli=${status}`);
  return res.send(
    status === 'connected'
      ? '<h2>Mercado Livre conectado! ✅</h2><p>Pode fechar esta aba e voltar ao sistema.</p>'
      : '<h2>Não foi possível conectar.</h2><p>Feche esta aba e tente novamente.</p>'
  );
}

// ── CALLBACK (público — o Mercado Livre redireciona pra cá) ──────────────────
// Valida o "state" assinado (que diz qual conta), troca o code por tokens e
// guarda a conexão. Em qualquer falha, volta pro front com ?meli=error.
router.get(
  '/mercadolivre/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    if (error || !code || !state) return frontRedirect(res, 'error');
    let claims;
    try {
      claims = meli.verifyState(String(state));
    } catch (_e) {
      return frontRedirect(res, 'error');
    }
    const account = await db('accounts').where({ id: claims.accountId }).first();
    if (!account) return frontRedirect(res, 'error');
    try {
      const tok = await meli.exchangeCode(String(code));
      let nickname = null;
      try {
        const r = await fetch(`${config.meli.apiHost}/users/me`, {
          headers: { Authorization: `Bearer ${tok.access_token}` },
        });
        const me = await r.json().catch(() => ({}));
        nickname = me.nickname || null;
      } catch (_e) {}
      await meli.saveConnection(account.id, tok, { nickname });
      return frontRedirect(res, 'connected');
    } catch (_e) {
      return frontRedirect(res, 'error');
    }
  })
);

// ── Notificações / webhook (público) ─────────────────────────────────────────
// O Mercado Livre exige uma URL de notificações no app. Por ora apenas
// confirmamos o recebimento (200) para o ML não ficar reenviando; o
// processamento em tempo real (novos pedidos etc.) fica para uma fase futura.
router.post('/mercadolivre/notifications', (req, res) => {
  try {
    const b = req.body || {};
    // eslint-disable-next-line no-console
    console.log('[meli] notificação:', b.topic || '?', b.resource || '');
  } catch (_e) {}
  res.sendStatus(200);
});
router.get('/mercadolivre/notifications', (_req, res) => res.sendStatus(200));

// ── Rotas autenticadas ───────────────────────────────────────────────────────
router.use(authenticate);

const accId = (req) => String(req.query.accountId || '');

// Inicia a conexão: devolve a URL de autorização do Mercado Livre.
router.get(
  '/mercadolivre/connect',
  requireManager,
  asyncHandler(async (req, res) => {
    if (!meli.isConfigured()) {
      throw badRequest('Integração do Mercado Livre não configurada no servidor (faltam credenciais).');
    }
    const account = await clientService.getAccountForWrite(accId(req), req.user);
    if (account.marketplace !== 'Mercado Livre') {
      throw badRequest('Esta conta não é do Mercado Livre.');
    }
    const state = meli.signState({ accountId: account.id, by: req.user.id });
    res.json({ url: meli.buildAuthUrl(state) });
  })
);

// Status da conexão de uma conta.
router.get(
  '/mercadolivre/status',
  asyncHandler(async (req, res) => {
    await clientService.getAccountForRead(accId(req), req.user);
    const conn = await meli.getConnection(accId(req));
    res.json({
      configured: meli.isConfigured(),
      connected: !!conn,
      mlUserId: conn ? conn.ml_user_id : null,
      nickname: conn ? conn.nickname : null,
      expiresAt: conn ? conn.expires_at : null,
    });
  })
);

// Desconectar (remove os tokens).
router.delete(
  '/mercadolivre/connection',
  requireManager,
  asyncHandler(async (req, res) => {
    await clientService.getAccountForWrite(accId(req), req.user);
    await meli.disconnect(accId(req));
    res.json({ ok: true });
  })
);

// Sonda — resumo rápido pra validar a conexão: dados do vendedor + vendas dos
// últimos 7 dias (via API de Pedidos).
router.get(
  '/mercadolivre/probe',
  requireManager,
  asyncHandler(async (req, res) => {
    await clientService.getAccountForWrite(accId(req), req.user);
    const conn = await meli.getConnection(accId(req));
    if (!conn) throw badRequest('Conta não conectada.');

    const out = {};
    const me = await meli.apiGet(accId(req), '/users/me');
    out.usuario = me.ok
      ? { id: me.data.id, nickname: me.data.nickname, site: me.data.site_id }
      : { erro: me.status, data: me.data };

    const sellerId = (me.ok && me.data.id) || conn.ml_user_id;
    const to = new Date();
    const from = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const q =
      `/orders/search?seller=${encodeURIComponent(sellerId)}` +
      `&order.status=paid` +
      `&order.date_created.from=${encodeURIComponent(from.toISOString())}` +
      `&order.date_created.to=${encodeURIComponent(to.toISOString())}` +
      `&sort=date_desc&limit=50`;
    const orders = await meli.apiGet(accId(req), q);
    if (orders.ok) {
      const results = orders.data.results || [];
      const faturamento = results.reduce((a, o) => a + (o.total_amount || 0), 0);
      const unidades = results.reduce(
        (a, o) => a + (o.order_items || []).reduce((s, it) => s + (it.quantity || 0), 0),
        0
      );
      out.vendas7dias = {
        pedidos: orders.data.paging ? orders.data.paging.total : results.length,
        faturamento,
        unidades,
      };
    } else {
      out.vendas7dias = { erro: orders.status, data: orders.data };
    }
    res.json(out);
  })
);

// Explorador (admin) — chama qualquer GET da API do ML, pra descobrir endpoints
// (ex.: a API de Publicidade). Use ?path=/users/me (ou outro caminho).
router.get(
  '/mercadolivre/explore',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await clientService.getAccountForRead(accId(req), req.user);
    let path = String(req.query.path || '/users/me');
    if (!path.startsWith('/') && !path.startsWith('http')) path = '/' + path;
    const r = await meli.apiGet(accId(req), path);
    res.json(r);
  })
);

module.exports = router;
