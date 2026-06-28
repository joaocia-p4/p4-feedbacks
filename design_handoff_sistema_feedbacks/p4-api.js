// p4-api.js — cliente HTTP do backend P4 (API + banco + auth).
// As telas usam isto para autenticar e gerenciar usuários de verdade.
// Se o backend estiver offline, o login cai para o modo protótipo (dados mock).
(function () {
  const DEFAULT_BASE = 'http://localhost:4000';

  function base() {
    const b = window.P4_API_BASE || localStorage.getItem('p4-api-base') || DEFAULT_BASE;
    return String(b).replace(/\/$/, '');
  }
  function token() {
    try { return localStorage.getItem('p4-token') || null; } catch (e) { return null; }
  }
  function setToken(t) {
    try { t ? localStorage.setItem('p4-token', t) : localStorage.removeItem('p4-token'); } catch (e) {}
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const tk = token();
    if (tk) headers.Authorization = 'Bearer ' + tk;
    const res = await fetch(base() + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || ('Erro ' + res.status));
      err.status = res.status;
      err.details = data && data.details;
      throw err;
    }
    return data;
  }

  function qs(params) {
    const u = new URLSearchParams();
    Object.keys(params || {}).forEach((k) => {
      const v = params[k];
      if (v != null && v !== '') u.append(k, v);
    });
    const s = u.toString();
    return s ? '?' + s : '';
  }

  async function login(email, senha) {
    const data = await apiFetch('/auth/login', { method: 'POST', body: { email, senha } });
    setToken(data.token);
    return data.user;
  }
  function logout() { setToken(null); }
  async function me() { return (await apiFetch('/auth/me')).user; }

  // usuários
  async function listUsers() { return (await apiFetch('/users')).users; }
  async function createUser(payload) { return (await apiFetch('/users', { method: 'POST', body: payload })).user; }
  async function updateUser(id, payload) { return (await apiFetch('/users/' + encodeURIComponent(id), { method: 'PUT', body: payload })).user; }
  async function deleteUser(id) { return apiFetch('/users/' + encodeURIComponent(id), { method: 'DELETE' }); }

  // clientes
  async function listClients(filters) {
    return (await apiFetch('/clients' + qs(filters))).clients;
  }
  async function getClient(id) { return (await apiFetch('/clients/' + encodeURIComponent(id))).client; }
  async function createClient(payload) { return (await apiFetch('/clients', { method: 'POST', body: payload })).client; }
  async function updateClient(id, payload) { return (await apiFetch('/clients/' + encodeURIComponent(id), { method: 'PUT', body: payload })).client; }
  async function deleteClient(id) { return apiFetch('/clients/' + encodeURIComponent(id), { method: 'DELETE' }); }

  // painel (admin / cs)
  async function getDashboard() { return apiFetch('/dashboard'); }

  // relatórios
  async function listReports(clientId, accId) {
    return (await apiFetch('/clients/' + encodeURIComponent(clientId) + '/accounts/' + encodeURIComponent(accId) + '/reports')).reports;
  }
  async function createReport(accId, payload) {
    // retorna { reports, created, updated } — um relatório por período (+ comparativos atualizados)
    return apiFetch('/accounts/' + encodeURIComponent(accId) + '/reports', { method: 'POST', body: payload });
  }
  async function deleteReport(id) { return apiFetch('/reports/' + encodeURIComponent(id), { method: 'DELETE' }); }

  // integração Mercado Livre (OAuth + dados)
  async function meliStatus(accId) { return apiFetch('/integrations/mercadolivre/status' + qs({ accountId: accId })); }
  async function meliConnect(accId) { return apiFetch('/integrations/mercadolivre/connect' + qs({ accountId: accId })); }
  async function meliConnectLink(accId) { return apiFetch('/integrations/mercadolivre/connect-link' + qs({ accountId: accId })); }
  async function meliDisconnect(accId) { return apiFetch('/integrations/mercadolivre/connection' + qs({ accountId: accId }), { method: 'DELETE' }); }
  async function meliProbe(accId) { return apiFetch('/integrations/mercadolivre/probe' + qs({ accountId: accId })); }
  async function meliExplore(accId, path) { return apiFetch('/integrations/mercadolivre/explore' + qs({ accountId: accId, path })); }
  async function meliReportData(accId, from, to) { return apiFetch('/integrations/mercadolivre/report-data' + qs({ accountId: accId, from, to })); }

  function isLogged() { return !!token(); }

  // backend disponível? (checagem curta, não trava a UI)
  async function available() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(base() + '/health', { signal: ctrl.signal });
      clearTimeout(t);
      return res.ok;
    } catch (e) { return false; }
  }

  window.P4_API = {
    base, token, setToken, isLogged, available, fetch: apiFetch,
    login, logout, me,
    listUsers, createUser, updateUser, deleteUser,
    listClients, getClient, createClient, updateClient, deleteClient,
    listReports, createReport, deleteReport,
    getDashboard,
    meliStatus, meliConnect, meliConnectLink, meliDisconnect, meliProbe, meliExplore, meliReportData,
  };
})();
