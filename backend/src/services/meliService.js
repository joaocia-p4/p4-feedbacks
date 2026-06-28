// meliService — integração com o Mercado Livre (OAuth 2.0 + chamadas à API).
// Guarda os tokens por conta (account) e renova o access_token sozinho quando
// está perto de expirar. As credenciais do app vêm das variáveis de ambiente.
const { v4: uuid } = require('uuid');
const jwt = require('jsonwebtoken');
const db = require('../db/knex');
const config = require('../config');
const { badRequest } = require('../lib/errors');

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

function buildAuthUrl(state) {
  const u = new URLSearchParams({
    response_type: 'code',
    client_id: M.appId,
    redirect_uri: M.redirectUri,
    state,
  });
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
    throw badRequest(`Mercado Livre recusou o token: ${data.message || data.error || res.status}`);
  }
  return data;
}

function exchangeCode(code) {
  return postToken({
    grant_type: 'authorization_code',
    client_id: M.appId,
    client_secret: M.secret,
    code,
    redirect_uri: M.redirectUri,
  });
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
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || null,
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
    const tok = await refreshTokens(conn.refresh_token);
    const saved = await saveConnection(accountId, tok);
    return saved.access_token;
  }
  return conn.access_token;
}

// GET na API do Mercado Livre com o token da conta. Não lança em erro HTTP:
// devolve { ok, status, data } para facilitar a exploração/diagnóstico.
async function apiGet(accountId, path, retry = true) {
  const token = await getValidAccessToken(accountId);
  const url = path.startsWith('http') ? path : `${M.apiHost}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && retry) {
    const conn = await getConnection(accountId);
    if (conn && conn.refresh_token) {
      const tok = await refreshTokens(conn.refresh_token);
      await saveConnection(accountId, tok);
      return apiGet(accountId, path, false);
    }
  }
  return { ok: res.ok, status: res.status, data };
}

module.exports = {
  isConfigured,
  signState,
  verifyState,
  buildAuthUrl,
  exchangeCode,
  refreshTokens,
  saveConnection,
  getConnection,
  disconnect,
  getValidAccessToken,
  apiGet,
};
