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

function frontRedirect(res, status, reason) {
  if (FRONT) {
    const q = reason ? `?meli=${status}&reason=${encodeURIComponent(reason)}` : `?meli=${status}`;
    return res.redirect(`${FRONT}/${q}`);
  }
  return res.send(
    status === 'connected'
      ? '<h2>Mercado Livre conectado! ✅</h2><p>Pode fechar esta aba e voltar ao sistema.</p>'
      : `<h2>Não foi possível conectar.</h2><p>Motivo: ${reason || 'desconhecido'}.</p>`
  );
}

// Página simples (standalone) para quem abriu via LINK compartilhado (o cliente,
// que não é usuário do sistema). Quando não é via link, volta para o app.
function page(res, ok, title, msg) {
  return res.send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:460px;margin:60px auto;padding:0 20px;text-align:center;color:#1C242E">` +
    `<div style="font-size:40px">${ok ? '✅' : '⚠️'}</div>` +
    `<h2 style="color:${ok ? '#2f9a2b' : '#d8423a'};margin:10px 0">${title}</h2>` +
    `<p style="color:#5b6670;line-height:1.5">${msg}</p></div>`
  );
}
function finish(res, ok, viaLink, reason) {
  if (viaLink) {
    return ok
      ? page(res, true, 'Conexão concluída!', 'Sua conta do Mercado Livre foi conectada com sucesso. Você já pode fechar esta aba.')
      : page(res, false, 'Não foi possível conectar', (reason || 'Tente novamente') + '. Se persistir, peça um novo link à agência.');
  }
  return ok ? frontRedirect(res, 'connected') : frontRedirect(res, 'error', reason);
}

// ── CALLBACK (público — o Mercado Livre redireciona pra cá) ──────────────────
// Valida o "state" assinado (que diz qual conta), troca o code por tokens e
// guarda a conexão. Em qualquer falha, volta pro front com ?meli=error.
router.get(
  '/mercadolivre/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error, error_description } = req.query;
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[meli] callback: ML retornou erro:', error, error_description || '');
      return frontRedirect(res, 'error', String(error));
    }
    if (!code || !state) return frontRedirect(res, 'error', 'params');
    let claims;
    try {
      claims = meli.verifyState(String(state));
    } catch (_e) {
      return frontRedirect(res, 'error', 'state');
    }
    const viaLink = !!claims.viaLink;
    const account = await db('accounts').where({ id: claims.accountId }).first();
    if (!account) return finish(res, false, viaLink, 'conta não encontrada');
    let tok;
    try {
      tok = await meli.exchangeCode(String(code), claims.cv);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[meli] callback: troca de token falhou:', e.message, JSON.stringify(e.details || {}));
      const detail = String(e.message || 'token').replace('Mercado Livre recusou o token: ', '');
      return finish(res, false, viaLink, detail.slice(0, 120));
    }
    let nickname = null;
    try {
      const r = await fetch(`${config.meli.apiHost}/users/me`, {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      const me = await r.json().catch(() => ({}));
      nickname = me.nickname || null;
    } catch (_e) {}
    try {
      await meli.saveConnection(account.id, tok, { nickname });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[meli] callback: saveConnection falhou:', e.message);
      const msg = String(e.message || '');
      const reason = msg.includes(' - ') ? msg.split(' - ').pop() : msg.slice(-150);
      return finish(res, false, viaLink, 'db: ' + reason);
    }
    return finish(res, true, viaLink);
  })
);

// Autorização via LINK compartilhado (PÚBLICO — o cliente/dono da conta abre).
// Valida o link assinado, gera o PKCE e redireciona para o login do Mercado Livre.
router.get(
  '/mercadolivre/authorize',
  asyncHandler(async (req, res) => {
    if (!meli.isConfigured()) return page(res, false, 'Integração indisponível', 'A integração não está configurada. Avise a agência.');
    let claims;
    try {
      claims = meli.verifyLink(String(req.query.t || ''));
    } catch (_e) {
      return page(res, false, 'Link inválido ou expirado', 'Peça um novo link de conexão à agência.');
    }
    const account = await db('accounts').where({ id: claims.accountId }).first();
    if (!account || account.marketplace !== 'Mercado Livre') {
      return page(res, false, 'Conta não encontrada', 'Peça um novo link à agência.');
    }
    const { verifier, challenge } = meli.pkcePair();
    const state = meli.signState({ accountId: account.id, cv: verifier, viaLink: true });
    return res.redirect(meli.buildAuthUrl(state, challenge));
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
    const { verifier, challenge } = meli.pkcePair();
    const state = meli.signState({ accountId: account.id, by: req.user.id, cv: verifier });
    res.json({ url: meli.buildAuthUrl(state, challenge) });
  })
);

// Gera um LINK compartilhável para enviar ao cliente (dono da conta master)
// autorizar a conexão — sem precisar ser usuário do sistema.
router.get(
  '/mercadolivre/connect-link',
  requireManager,
  asyncHandler(async (req, res) => {
    if (!meli.isConfigured()) {
      throw badRequest('Integração do Mercado Livre não configurada no servidor.');
    }
    const account = await clientService.getAccountForWrite(accId(req), req.user);
    if (account.marketplace !== 'Mercado Livre') {
      throw badRequest('Esta conta não é do Mercado Livre.');
    }
    const token = meli.signLink(account.id);
    res.json({ url: meli.authorizeLink(token), expiresInDays: 7 });
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

// Reputação do vendedor (cor/termômetro, nível, cancelamentos, reclamações,
// envios atrasados, vendas concluídas). Leitura — analista também vê.
router.get(
  '/mercadolivre/reputation',
  asyncHandler(async (req, res) => {
    await clientService.getAccountForRead(accId(req), req.user);
    const conn = await meli.getConnection(accId(req));
    if (!conn) throw badRequest('Conta não conectada ao Mercado Livre.');
    const rep = await meli.reputation(accId(req));
    res.json(rep);
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

// Dados para preencher um relatório de um período (Pedidos + Ads agregados).
router.get(
  '/mercadolivre/report-data',
  requireManager,
  asyncHandler(async (req, res) => {
    const account = await clientService.getAccountForWrite(accId(req), req.user);
    if (account.marketplace !== 'Mercado Livre') {
      throw badRequest('Esta conta não é do Mercado Livre.');
    }
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw badRequest('Informe "from" e "to" no formato AAAA-MM-DD.');
    }
    const conn = await meli.getConnection(accId(req));
    if (!conn) throw badRequest('Conta não conectada ao Mercado Livre.');
    const data = await meli.reportData(accId(req), from, to);
    res.json(data);
  })
);

// Campanhas de Product Ads do período (nome, status, orçamento, ACOS alvo,
// métricas) — para registrar nas observações quais campanhas estão ativas.
router.get(
  '/mercadolivre/campaigns',
  requireManager,
  asyncHandler(async (req, res) => {
    const account = await clientService.getAccountForWrite(accId(req), req.user);
    if (account.marketplace !== 'Mercado Livre') throw badRequest('Esta conta não é do Mercado Livre.');
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw badRequest('Informe "from" e "to" no formato AAAA-MM-DD.');
    }
    const conn = await meli.getConnection(accId(req));
    if (!conn) throw badRequest('Conta não conectada ao Mercado Livre.');
    res.json(await meli.campaigns(accId(req), from, to));
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
    // Endpoints de Publicidade (Mercado Ads) exigem o cabeçalho Api-Version.
    const headers = {};
    if (/advertising/.test(path)) headers['Api-Version'] = String(req.query.v || '1');
    else if (req.query.v) headers['Api-Version'] = String(req.query.v);
    const r = await meli.apiGet(accId(req), path, { headers });
    res.json(r);
  })
);

module.exports = router;
