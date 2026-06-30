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

// Lista de datas YYYY-MM-DD de `from` até `to` (inclusive). Itera ao meio-dia UTC
// para não escorregar de dia por fuso/DST.
function dateList(from, to) {
  const out = [];
  const cur = new Date(from + 'T12:00:00Z');
  const end = new Date(to + 'T12:00:00Z').getTime();
  let guard = 0;
  while (cur.getTime() <= end && guard < 400) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

// Faturamento + vendas BRUTAS do período via API de Pedidos. Vai dia a dia (o
// offset do /orders/search trava em 1000) e soma TODOS os pedidos criados no dia,
// sem filtrar status (bruto, sem descontar cancelamentos/devoluções). Fuso -03:00.
// faturamento = Σ total_amount · vendas = Σ unidades dos itens.
async function ordersTotals(accountId, sellerId, from, to) {
  let faturamento = 0;
  let vendas = 0;
  let pedidos = 0;
  let erro = null;
  for (const day of dateList(from, to)) {
    let offset = 0;
    for (let i = 0; i < 25 && offset < 1000; i++) {
      const q =
        `/orders/search?seller=${encodeURIComponent(sellerId)}` +
        `&order.date_created.from=${encodeURIComponent(day + 'T00:00:00.000-03:00')}` +
        `&order.date_created.to=${encodeURIComponent(day + 'T23:59:59.999-03:00')}` +
        `&sort=date_desc&limit=50&offset=${offset}`;
      const r = await apiGet(accountId, q);
      if (!r.ok) { erro = r.data; break; }
      const results = r.data.results || [];
      for (const o of results) {
        faturamento += o.total_amount || 0;
        vendas += (o.order_items || []).reduce((s, it) => s + (it.quantity || 0), 0);
      }
      pedidos += results.length;
      const total = r.data.paging ? r.data.paging.total : results.length;
      offset += 50;
      if (offset >= total || results.length === 0) break;
    }
    if (erro) break;
  }
  return { faturamento, vendas, pedidos, erro };
}

// Junta os dados do período (YYYY-MM-DD) para preencher o relatório:
//  - Faturamento e vendas BRUTAS (Pedidos, sem descontar cancelamentos/devoluções);
//  - Ads (investimento, receita e vendas de Ads, somando as campanhas).
// O painel "Métricas" do ML usa um agregado interno que pode divergir um pouco do
// bruto via Pedidos; os campos ficam editáveis para ajuste manual.
async function reportData(accountId, from, to) {
  const me = await apiGet(accountId, '/users/me');
  const sellerId = me.ok ? me.data.id : null;
  const siteId = (me.ok && me.data.site_id) || 'MLB';

  // ── Faturamento + vendas brutas (Pedidos, dia a dia) ──
  let faturamento = 0;
  let vendas = 0;
  let pedidos = 0;
  let ordersErro = null;
  if (sellerId) {
    const ot = await ordersTotals(accountId, sellerId, from, to);
    faturamento = ot.faturamento;
    vendas = ot.vendas;
    pedidos = ot.pedidos;
    ordersErro = ot.erro;
  } else {
    ordersErro = me.data;
  }

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
    faturamento,
    vendas,
    pedidos,
    ordersErro,
    investimento,
    receitaAds,
    vendasAds,
    ads: { clicks, prints, campanhas, erro: adsErro },
  };
}

// Reputação do vendedor: termômetro (cor), nível/MercadoLíder, % cancelamentos,
// % reclamações, % envios atrasados e vendas concluídas. Vem de /users/me
// (campo seller_reputation), reusando a conexão já existente.
const REP_LEVELS = {
  '5_green': { label: 'Verde', hex: '#00a650' },
  '4_light_green': { label: 'Verde claro', hex: '#7dd956' },
  '3_yellow': { label: 'Amarelo', hex: '#ffe600' },
  '2_orange': { label: 'Laranja', hex: '#ff7733' },
  '1_red': { label: 'Vermelho', hex: '#e53935' },
};
async function reputation(accountId) {
  const me = await apiGet(accountId, '/users/me');
  if (!me.ok) return { ok: false, status: me.status, data: me.data };
  const d = me.data || {};
  const rep = d.seller_reputation || {};
  const m = rep.metrics || {};
  const tx = rep.transactions || {};
  const lvl = REP_LEVELS[rep.level_id] || { label: '—', hex: '#9aa39d' };
  const metric = (x) => ({ rate: (x && x.rate) || 0, value: (x && x.value) || 0, period: (x && x.period) || null });
  return {
    ok: true,
    sellerId: d.id,
    nickname: d.nickname,
    site: d.site_id,
    levelId: rep.level_id || null,
    colorLabel: lvl.label,
    colorHex: lvl.hex,
    powerSeller: rep.power_seller_status || null,
    transactions: {
      total: tx.total || 0,
      completed: tx.completed || 0,
      canceled: tx.canceled || 0,
      ratings: tx.ratings || { positive: 0, neutral: 0, negative: 0 },
    },
    metrics: {
      sales: { completed: (m.sales && m.sales.completed) || 0, period: (m.sales && m.sales.period) || null },
      cancellations: metric(m.cancellations),
      claims: metric(m.claims),
      delayedHandling: metric(m.delayed_handling_time),
    },
  };
}

// Lista as campanhas de Product Ads do período (nome, status, orçamento, ACOS alvo
// e métricas). Serve para registrar nas observações quais campanhas estão ativas.
// Obs.: a API pública do ML não expõe um histórico de alterações das campanhas —
// só o estado atual; comparar "o que mudou" exige guardar snapshots ao longo do tempo.
async function campaigns(accountId, from, to) {
  const me = await apiGet(accountId, '/users/me');
  const siteId = (me.ok && me.data.site_id) || 'MLB';
  const adv = await apiGet(accountId, '/advertising/advertisers?product_id=PADS', { headers: { 'Api-Version': '1' } });
  const list = (adv.ok && adv.data.advertisers) || [];
  const advertiser = list.find((a) => a.site_id === siteId) || list[0];
  if (!advertiser) return { ok: false, erro: adv.ok ? 'nenhum advertiser de Product Ads' : adv.data, campanhas: [] };
  const out = [];
  let offset = 0;
  for (let i = 0; i < 20 && offset < 1000; i++) {
    const q =
      `/marketplace/advertising/${advertiser.site_id}/advertisers/${advertiser.advertiser_id}` +
      `/product_ads/campaigns/search?limit=50&offset=${offset}` +
      `&date_from=${from}&date_to=${to}` +
      `&metrics=cost,total_amount,units_quantity,clicks,prints`;
    const r = await apiGet(accountId, q, { headers: { 'Api-Version': '1' } });
    if (!r.ok) return { ok: false, erro: r.data, campanhas: out };
    const results = r.data.results || [];
    for (const c of results) {
      const m = c.metrics || {};
      const cost = m.cost || 0;
      const rec = m.total_amount || 0;
      out.push({
        id: c.id,
        nome: c.name || c.campaign_name || `Campanha ${c.id}`,
        status: c.status || null,
        orcamento: c.budget != null ? c.budget : (c.daily_budget != null ? c.daily_budget : null),
        acosAlvo: c.acos_target != null ? c.acos_target : (c.target_acos != null ? c.target_acos : null),
        estrategia: c.strategy || null,
        investimento: cost,
        receitaAds: rec,
        acos: rec > 0 ? +((cost / rec) * 100).toFixed(1) : null,
        unidades: m.units_quantity || 0,
      });
    }
    const total = r.data.paging ? r.data.paging.total : results.length;
    offset += 50;
    if (offset >= total || results.length === 0) break;
  }
  return { ok: true, campanhas: out };
}

// ── Comparação de campanhas (histórico construído a partir dos snapshots) ──
// Chave de identidade de uma campanha: o id do ML quando existe; senão, o nome.
function campKey(c) {
  const id = c && c.id != null ? String(c.id).trim() : '';
  return id ? 'id:' + id : 'nm:' + String((c && c.nome) || '').trim().toLowerCase();
}
// Lê um número que pode vir como número (atual) ou string pt-BR "1.234,56" (snapshot salvo).
function asNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}
// Detecta mudança num campo numérico. Ignora quando o valor ATUAL é desconhecido
// (a API às vezes não devolve orçamento/ACOS-alvo) para não gerar falso positivo.
function diffField(prevVal, curVal, dp) {
  if (curVal == null) return null;
  const b = +Number(curVal).toFixed(dp);
  if (prevVal == null) return { de: null, para: b };
  const a = +Number(prevVal).toFixed(dp);
  return a === b ? null : { de: a, para: b };
}
function isActiveCampaign(c) {
  const s = String((c && c.status) || '').toLowerCase();
  return !s || s === 'active' || s === 'enabled' || s === 'ativo';
}
// Recebe TODAS as campanhas atuais + a lista do snapshot anterior. Devolve só as
// ATIVAS (anotadas com novo/mudancas), a contagem de inativas e as removidas.
function annotateCampaigns(currentAll, prevList, comparar) {
  const all = currentAll || [];
  const active = all.filter(isActiveCampaign);
  const pausadasCount = all.length - active.length;
  if (!comparar) {
    return { ativas: active.map((c) => ({ ...c, novo: false })), pausadasCount, removidas: [] };
  }
  const prevByKey = new Map();
  for (const p of prevList || []) prevByKey.set(campKey(p), p);
  const curKeys = new Set(active.map(campKey));
  const ativas = active.map((c) => {
    const prev = prevByKey.get(campKey(c));
    if (!prev) return { ...c, novo: true };
    const mud = {};
    const o = diffField(asNum(prev.orcamento), c.orcamento, 2);
    if (o) mud.orcamento = o;
    const a = diffField(asNum(prev.acosAlvo), c.acosAlvo, 1);
    if (a) mud.acosAlvo = a;
    return { ...c, novo: false, ...(Object.keys(mud).length ? { mudancas: mud } : {}) };
  });
  const removidas = (prevList || [])
    .filter((p) => !curKeys.has(campKey(p)))
    .map((p) => ({ nome: p.nome || '', investimento: p.investimento != null ? p.investimento : '' }));
  return { ativas, pausadasCount, removidas };
}

module.exports = {
  isConfigured,
  pkcePair,
  reportData,
  reputation,
  campaigns,
  annotateCampaigns,
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
