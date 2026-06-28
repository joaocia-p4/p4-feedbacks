// meliService — integração com o Mercado Livre (OAuth 2.0 + chamadas à API).
// Guarda os tokens por conta (account) e renova o access_token sozinho quando
// está perto de expirar. As credenciais do app vêm das variáveis de ambiente.
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const jwt = require('jsonwebtoken');
const db = require('../db/knex');
const config = require('../config');
const { badRequest } = require('../lib/errors');
const { encrypt, decrypt } = require('../lib/secrets');

const M = config.meli;

function isConfigured() {
  return !!(M.appId && M.secret && M.redirectUri);
}

// "state" assinado que viaja no fluxo OAuth — diz qual conta conectar e por quem.
function signState(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: '15m' });
}
function verifyState(state) {
  return jwt.verify(state, config.jwt.secret);
}

// Link compartilhável (enviado ao cliente/dono da conta para autorizar). Vale
// 7 dias e carrega só o id da conta, assinado — não exige login no sistema.
function signLink(accountId) {
  return jwt.sign({ accountId, t: 'meli-link' }, config.jwt.secret, { expiresIn: '7d' });
}
function verifyLink(token) {
  const p = jwt.verify(token, config.jwt.secret);
  if (p.t !== 'meli-link') throw new Error('tipo de token inválido');
  return p;
}
function authorizeLink(token) {
  let origin = '';
  try { origin = new URL(M.redirectUri).origin; } catch (_e) {}
  return `${origin}/integrations/mercadolivre/authorize?t=${encodeURIComponent(token)}`;
}

// PKCE (exigido pelo Mercado Livre): gera o verifier e o challenge (S256).
function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function buildAuthUrl(state, codeChallenge) {
  const u = new URLSearchParams({
    response_type: 'code',
    client_id: M.appId,
    redirect_uri: M.redirectUri,
    state,
  });
  if (codeChallenge) {
    u.set('code_challenge', codeChallenge);
    u.set('code_challenge_method', 'S256');
  }
  return `${M.authHost}/authorization?${u.toString()}`;
}

async function postToken(params) {
  const res = await fetch(`${M.apiHost}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = [data.error, data.message].filter(Boolean).join(' — ') || `HTTP ${res.status}`;
    throw badRequest(`Mercado Livre recusou o token: ${detail}`, data);
  }
  return data;
}

function exchangeCode(code, codeVerifier) {
  const params = {
    grant_type: 'authorization_code',
    client_id: M.appId,
    client_secret: M.secret,
    code,
    redirect_uri: M.redirectUri,
  };
  if (codeVerifier) params.code_verifier = codeVerifier;
  return postToken(params);
}

function refreshTokens(refreshToken) {
  return postToken({
    grant_type: 'refresh_token',
    client_id: M.appId,
    client_secret: M.secret,
    refresh_token: refreshToken,
  });
}

function expiryISO(expiresInSec) {
  return new Date(Date.now() + (Number(expiresInSec) || 0) * 1000).toISOString();
}

// Cria/atualiza a conexão da conta com os tokens recebidos do ML.
async function saveConnection(accountId, tok, extra = {}) {
  const now = new Date().toISOString();
  const patch = {
    access_token: encrypt(tok.access_token),
    refresh_token: tok.refresh_token ? encrypt(tok.refresh_token) : null,
    scope: tok.scope || null,
    expires_at: expiryISO(tok.expires_in),
    atualizado_em: now,
  };
  if (tok.user_id != null) patch.ml_user_id = String(tok.user_id);
  if (extra.nickname) patch.nickname = extra.nickname;

  const existing = await db('meli_connections').where({ account_id: accountId }).first();
  if (existing) {
    await db('meli_connections').where({ account_id: accountId }).update(patch);
    return { ...existing, ...patch };
  }
  const row = { id: uuid(), account_id: accountId, criado_em: now, ...patch };
  await db('meli_connections').insert(row);
  return row;
}

function getConnection(accountId) {
  return db('meli_connections').where({ account_id: accountId }).first();
}

async function disconnect(accountId) {
  await db('meli_connections').where({ account_id: accountId }).del();
}

// Devolve um access_token válido, renovando se estiver perto de expirar.
async function getValidAccessToken(accountId) {
  const conn = await getConnection(accountId);
  if (!conn) throw badRequest('Conta não conectada ao Mercado Livre.');
  const exp = conn.expires_at ? Date.parse(conn.expires_at) : 0;
  if (!exp || exp - Date.now() < 5 * 60 * 1000) {
    if (!conn.refresh_token) throw badRequest('Conexão expirada. Reconecte a conta do Mercado Livre.');
    const tok = await refreshTokens(decrypt(conn.refresh_token));
    await saveConnection(accountId, tok);
    return tok.access_token;
  }
  return decrypt(conn.access_token);
}

// GET na API do Mercado Livre com o token da conta. Não lança em erro HTTP:
// devolve { ok, status, data } para facilitar a exploração/diagnóstico.
async function apiGet(accountId, path, opts = {}) {
  const { headers = {}, retry = true } = opts;
  const token = await getValidAccessToken(accountId);
  const url = path.startsWith('http') ? path : `${M.apiHost}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && retry) {
    const conn = await getConnection(accountId);
    if (conn && conn.refresh_token) {
      const tok = await refreshTokens(decrypt(conn.refresh_token));
      await saveConnection(accountId, tok);
      return apiGet(accountId, path, { ...opts, retry: false });
    }
  }
  return { ok: res.ok, status: res.status, data };
}

// Junta os dados de Publicidade (Product Ads) de um período (YYYY-MM-DD) para
// preencher o relatório: investimento, receita e vendas de Ads (somando todas as
// campanhas). Faturamento/Vendas totais NÃO vêm daqui — o painel "Métricas" do ML
// usa um agregado interno não reproduzível pela API pública; esses 2 ficam manuais.
async function reportData(accountId, from, to) {
  const me = await apiGet(accountId, '/users/me');
  const sellerId = me.ok ? me.data.id : null;
  const siteId = (me.ok && me.data.site_id) || 'MLB';

  // ── Anúncios (Product Ads), somando as campanhas ──
  let investimento = 0;
  let receitaAds = 0;
  let vendasAds = 0;
  let clicks = 0;
  let prints = 0;
  let campanhas = 0;
  let adsErro = null;
  const adv = await apiGet(accountId, '/advertising/advertisers?product_id=PADS', {
    headers: { 'Api-Version': '1' },
  });
  const list = (adv.ok && adv.data.advertisers) || [];
  const advertiser = list.find((a) => a.site_id === siteId) || list[0];
  if (advertiser) {
    let offset = 0;
    for (let i = 0; i < 20 && offset < 1000; i++) {
      const q =
        `/marketplace/advertising/${advertiser.site_id}/advertisers/${advertiser.advertiser_id}` +
        `/product_ads/campaigns/search?limit=50&offset=${offset}` +
        `&date_from=${from}&date_to=${to}` +
        `&metrics=cost,total_amount,units_quantity,clicks,prints`;
      const r = await apiGet(accountId, q, { headers: { 'Api-Version': '1' } });
      if (!r.ok) { adsErro = r.data; break; }
      const results = r.data.results || [];
      for (const c of results) {
        const m = c.metrics || {};
        investimento += m.cost || 0;
        receitaAds += m.total_amount || 0;
        vendasAds += m.units_quantity || 0;
        clicks += m.clicks || 0;
        prints += m.prints || 0;
      }
      const total = r.data.paging ? r.data.paging.total : results.length;
      campanhas = total;
      offset += 50;
      if (offset >= total || results.length === 0) break;
    }
  } else {
    adsErro = adv.ok ? 'nenhum advertiser de Product Ads' : adv.data;
  }

  return {
    periodo: { from, to },
    vendedor: { id: sellerId, site: siteId, nickname: me.ok ? me.data.nickname : null },
    investimento,
    receitaAds,
    vendasAds,
    ads: { clicks, prints, campanhas, erro: adsErro },
  };
}

module.exports = {
  isConfigured,
  pkcePair,
  reportData,
  signState,
  verifyState,
  signLink,
  verifyLink,
  authorizeLink,
  buildAuthUrl,
  exchangeCode,
  refreshTokens,
  saveConnection,
  getConnection,
  disconnect,
  getValidAccessToken,
  apiGet,
};
