// p4-shell.jsx — top bar, screen router, users modal, tweaks, app mount.

const { useState, useEffect, useRef } = React;
const GENERATOR_HREF = 'gerador.html';

// ---------------------------------------------------------------- TopBar
function TopBar({ title, user, role, onBack, onLogout, onManageUsers }) {
  const I = window.Icons;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const isAdmin = role === 'admin';
  return (
    <div className="topbar">
      <div className="tb-brand">
        <img src="assets/p4-mark-white.png" alt="P4" />
        <div>
          <b>Método P4</b>
          <span className="mono">Relatórios</span>
        </div>
      </div>
      {onBack
        ? <button className="tb-back" onClick={onBack}><I.back size={16} /> Voltar</button>
        : null}
      <div className="tb-spacer"></div>
      <div className="tb-user" ref={ref} onClick={() => setOpen((o) => !o)}>
        <div className="avatar">{user.iniciais}</div>
        <div className="who">
          <div className="nm">{user.nome}</div>
          <div className="rl"><span className={'role-pill ' + role}>{role}</span></div>
        </div>
        {open
          ? (
            <div className="tb-menu" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setOpen(false); }}><I.user size={15} /> {user.email}</button>
              {isAdmin ? <button onClick={() => { setOpen(false); onManageUsers(); }}><I.users size={15} /> Gerenciar usuários</button> : null}
              <div className="sep"></div>
              <button className="danger" onClick={() => { setOpen(false); onLogout(); }}><I.logout size={15} /> Sair</button>
            </div>
          )
          : null}
      </div>
    </div>
  );
}
window.TopBar = TopBar;

// ---------------------------------------------------------------- Users modal (admin)
function initialsOf(nome) {
  const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function UsersModal({ me, onClose, toast }) {
  const I = window.Icons;
  // Conectado ao backend? (há token salvo). Senão, opera sobre os dados mock.
  const live = !!(window.P4_API && window.P4_API.isLogged());

  const [users, setUsers] = useState(window.P4_USERS || []);
  const [loading, setLoading] = useState(live);
  const [loadErr, setLoadErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nome: '', email: '', senha: '', papel: 'analista' });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [backendUp, setBackendUp] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Detecta se o backend está acessível (para avisar quando se está em modo demo).
  useEffect(() => {
    let c = false;
    if (window.P4_API) window.P4_API.available().then((v) => { if (!c) setBackendUp(v); });
    return () => { c = true; };
  }, []);

  const reload = React.useCallback(async () => {
    if (!live) { setUsers(window.P4_USERS || []); return; }
    setLoading(true); setLoadErr('');
    try { setUsers(await window.P4_API.listUsers()); }
    catch (e) { setLoadErr(e.message || 'Falha ao carregar usuários.'); }
    finally { setLoading(false); }
  }, [live]);

  useEffect(() => { reload(); }, [reload]);

  const setF = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setFormErr('');
    if (!form.nome.trim()) { setFormErr('Informe o nome.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { setFormErr('E-mail inválido.'); return; }
    if (!editingId && form.senha.length < 6) { setFormErr('A senha deve ter ao menos 6 caracteres.'); return; }
    if (editingId && form.senha && form.senha.length < 6) { setFormErr('A nova senha deve ter ao menos 6 caracteres.'); return; }
    setSaving(true);
    try {
      if (editingId) {
        // editar: senha só vai se foi preenchida
        const payload = { nome: form.nome.trim(), email: form.email.trim(), papel: form.papel };
        if (form.senha) payload.senha = form.senha;
        if (live) {
          const u = await window.P4_API.updateUser(editingId, payload);
          await reload();
          toast(`Usuário “${u.nome}” atualizado`);
        } else {
          window.P4_USERS = (window.P4_USERS || []).map((x) => (x.id === editingId
            ? { ...x, nome: payload.nome, email: payload.email.toLowerCase(), papel: payload.papel, iniciais: initialsOf(payload.nome) }
            : x));
          setUsers(window.P4_USERS);
          toast(`Usuário “${payload.nome}” atualizado (protótipo)`);
        }
      } else {
        const payload = { nome: form.nome.trim(), email: form.email.trim(), senha: form.senha, papel: form.papel };
        if (live) {
          const u = await window.P4_API.createUser(payload);
          await reload();
          toast(`Usuário “${u.nome}” criado`);
        } else {
          const u = { id: 'u' + Date.now(), nome: payload.nome, email: payload.email.toLowerCase(), papel: payload.papel, iniciais: initialsOf(payload.nome) };
          window.P4_USERS = [...(window.P4_USERS || []), u];
          setUsers(window.P4_USERS);
          toast(`Usuário “${u.nome}” criado (protótipo)`);
        }
      }
      setForm({ nome: '', email: '', senha: '', papel: 'analista' });
      setShowForm(false);
      setEditingId(null);
    } catch (err) {
      setFormErr(err.message || 'Não foi possível salvar o usuário.');
    } finally {
      setSaving(false);
    }
  };

  const startCreate = () => {
    if (showForm && !editingId) { setShowForm(false); return; } // toggle fecha
    setEditingId(null);
    setForm({ nome: '', email: '', senha: '', papel: 'analista' });
    setFormErr('');
    setShowForm(true);
  };
  const openEdit = (u) => {
    setEditingId(u.id);
    setForm({ nome: u.nome, email: u.email, senha: '', papel: u.papel });
    setFormErr('');
    setShowForm(true);
  };
  const cancelForm = () => { setShowForm(false); setEditingId(null); setFormErr(''); };

  const removeUser = async (u) => {
    if (!window.confirm(`Excluir o usuário “${u.nome}”? Esta ação não pode ser desfeita.`)) return;
    if (live) {
      try { await window.P4_API.deleteUser(u.id); await reload(); toast(`Usuário “${u.nome}” excluído`); }
      catch (e) { toast(e.message || 'Não foi possível excluir o usuário'); }
    } else {
      window.P4_USERS = (window.P4_USERS || []).filter((x) => x.id !== u.id);
      setUsers(window.P4_USERS);
      toast(`Usuário “${u.nome}” excluído (protótipo)`);
    }
  };

  const inp = { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--line)', fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'inherit', boxSizing: 'border-box' };
  const lab = { fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 5, display: 'block' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,20,16,.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div style={{ background: 'var(--paper)', borderRadius: 16, width: '100%', maxWidth: 540, overflow: 'hidden', boxShadow: '0 30px 70px -24px rgba(0,0,0,.5)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Usuários</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
              Contas criadas pelo administrador{live ? '' : ' · modo protótipo (backend offline)'}
            </div>
          </div>
          <button className="btn-accent" onClick={startCreate}>
            <I.plus size={16} /> {showForm && !editingId ? 'Fechar' : 'Novo usuário'}
          </button>
        </div>

        {!live ? (
          <div style={{ padding: '12px 22px', background: '#fff7ed', borderBottom: '1px solid var(--line)', fontSize: 12.5, color: '#9a3412', lineHeight: 1.5 }}>
            {backendUp
              ? <>⚠ Sessão em <b>modo demonstração</b> — o que você criar aqui <b>não é salvo no banco</b>. Saia (avatar → Sair) e entre novamente com seu e-mail e senha (admin: <b>diego@metodop4.com</b> / <b>metodop4</b>) para gravar de verdade.</>
              : <>⚠ <b>Backend offline</b> — alterações ficam só em memória (modo protótipo). Inicie a API (<code>npm start</code>) para salvar no banco.</>}
          </div>
        ) : null}

        {showForm ? (
          <form onSubmit={submit} style={{ padding: '16px 22px', borderBottom: '1px solid var(--line)', background: '#f6f8f6' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{editingId ? 'Editar usuário' : 'Novo usuário'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={lab}>Nome</label>
                <input style={inp} value={form.nome} onChange={setF('nome')} placeholder="Ex.: Marina Souza" />
              </div>
              <div>
                <label style={lab}>E-mail</label>
                <input style={inp} type="email" value={form.email} onChange={setF('email')} placeholder="marina@metodop4.com" />
              </div>
              <div>
                <label style={lab}>{editingId ? 'Nova senha' : 'Senha'}</label>
                <input style={inp} type="password" value={form.senha} onChange={setF('senha')} placeholder={editingId ? 'deixe em branco para manter' : 'mín. 6 caracteres'} />
              </div>
              <div>
                <label style={lab}>Papel</label>
                <select style={inp} value={form.papel} onChange={setF('papel')}>
                  <option value="analista">analista</option>
                  <option value="admin">admin</option>
                  <option value="cs">cs (somente leitura)</option>
                </select>
              </div>
            </div>
            {formErr ? <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>⚠ {formErr}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn-line" onClick={cancelForm}>Cancelar</button>
              <button type="submit" className="btn-accent" disabled={saving}>{saving ? 'Salvando…' : (editingId ? 'Salvar alterações' : 'Criar usuário')}</button>
            </div>
          </form>
        ) : null}

        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '24px 22px', fontSize: 13, color: 'var(--muted)' }}>Carregando usuários…</div>
          ) : loadErr ? (
            <div style={{ padding: '24px 22px', fontSize: 13, color: 'var(--red)' }}>⚠ {loadErr}</div>
          ) : (
            users.map((u) => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 22px', borderBottom: '1px solid var(--line)' }}>
                <div className="avatar" style={{ borderRadius: 10 }}>{u.iniciais || initialsOf(u.nome)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{u.nome}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{u.email}</div>
                </div>
                <span className={'role-pill ' + u.papel}>{u.papel}</span>
                <button title="Editar usuário" onClick={() => openEdit(u)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted)', padding: 6, borderRadius: 8, display: 'inline-flex' }}><I.edit size={15} /></button>
                {me && me.id === u.id
                  ? <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, width: 28, textAlign: 'center' }}>você</span>
                  : <button title="Excluir usuário" onClick={() => removeUser(u)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#d8423a', padding: 6, borderRadius: 8, display: 'inline-flex' }}><I.trash size={15} /></button>}
              </div>
            ))
          )}
        </div>
        <div style={{ padding: '14px 22px', textAlign: 'right' }}>
          <button className="btn-line" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Loading
function LoadingScreen({ label }) {
  return (
    <div className="shell">
      <div className="page">
        <div className="page-inner" style={{ padding: '70px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
          {label || 'Carregando…'}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- App
function App() {
  const [t, setTweak] = window.useTweaks({
    roleOverride: 'auto',   // auto | admin | analista
    layout: 'grade',        // grade | lista
    accent: '#56D54F',
  });

  const [user, setUser] = useState(() => {
    try { const s = localStorage.getItem('p4-shell-user'); if (s) return JSON.parse(s); } catch (e) {}
    return null;
  });
  const [screen, setScreen] = useState(() => {
    // CS começa no painel; demais, na lista de clientes.
    try { const s = localStorage.getItem('p4-shell-user'); if (s && JSON.parse(s).papel === 'cs') return 'dashboard'; } catch (e) {}
    return 'clients';
  }); // dashboard | clients | history | new | edit
  const [clientId, setClientId] = useState(null);
  const [usersOpen, setUsersOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  // Conectado ao backend? (há token). Senão, usa os dados mock (window.P4_*).
  const live = !!(window.P4_API && window.P4_API.isLogged());
  const [clients, setClients] = useState(window.P4_CLIENTS || []);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [usersList, setUsersList] = useState(window.P4_USERS || []);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // accent applied globally
  useEffect(() => {
    const a = t.accent || '#56D54F';
    document.documentElement.style.setProperty('--accent', a);
    document.documentElement.style.setProperty('--green', a);
    const m = a.replace('#', '').match(/.{2}/g);
    if (m) document.documentElement.style.setProperty('--accent-rgb', m.map((h) => parseInt(h, 16)).join(','));
  }, [t.accent]);

  useEffect(() => {
    if (user) localStorage.setItem('p4-shell-user', JSON.stringify(user));
  }, [user]);

  // Reconcilia a sessão com o backend no boot:
  // - com token: valida em /auth/me e atualiza o usuário (desloga se expirou);
  // - sem token mas com sessão salva e backend no ar: exige login real (evita
  //   uma sessão "protótipo" antiga que cria usuários só em memória).
  useEffect(() => {
    if (!window.P4_API) return;
    let cancelled = false;
    (async () => {
      if (window.P4_API.isLogged()) {
        try {
          const u = await window.P4_API.me();
          if (!cancelled) setUser(u);
        } catch (e) {
          // só desloga se o token foi REJEITADO (401); erro de rede mantém a sessão
          if (!cancelled && e && e.status === 401) { window.P4_API.logout(); setUser(null); localStorage.removeItem('p4-shell-user'); }
        }
      } else if (localStorage.getItem('p4-shell-user')) {
        const up = await window.P4_API.available();
        if (up && !cancelled) { setUser(null); localStorage.removeItem('p4-shell-user'); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toast = (msg) => { setToastMsg(msg); window.clearTimeout(toast._t); toast._t = window.setTimeout(() => setToastMsg(null), 2200); };

  // Retorno do OAuth do Mercado Livre (?meli=connected|error) → avisa e limpa a URL.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const m = p.get('meli');
      if (!m) return;
      const reason = p.get('reason');
      toast(m === 'connected'
        ? 'Mercado Livre conectado ✅'
        : 'Não foi possível conectar ao Mercado Livre' + (reason ? ` (${reason})` : ''));
      p.delete('meli');
      p.delete('reason');
      const qs = p.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : ''));
    } catch (e) {}
  }, []);

  const role = t.roleOverride !== 'auto' ? t.roleOverride : (user ? user.papel : 'analista');

  // ---- carga de dados (banco quando logado; senão, mock window.P4_*) ----
  const loadClients = React.useCallback(async () => {
    if (!live) { setClients(window.P4_CLIENTS || []); return; }
    setClientsLoading(true);
    try { setClients(await window.P4_API.listClients()); }
    catch (e) { toast(e.message || 'Falha ao carregar clientes'); }
    finally { setClientsLoading(false); }
  }, [live]);

  const loadUsers = React.useCallback(async () => {
    if (!live) { setUsersList(window.P4_USERS || []); return; }
    try { setUsersList(await window.P4_API.listUsers()); } catch (e) {}
  }, [live]);

  const loadDetail = React.useCallback(async (id, opts = {}) => {
    if (!live) { setDetail((window.P4_CLIENTS || []).find((c) => c.id === id) || null); return; }
    // refresh "silencioso": mantém a tela visível enquanto rebusca (sem flicker)
    if (!opts.silent) { setDetailLoading(true); setDetail(null); }
    try { setDetail(await window.P4_API.getClient(id)); }
    catch (e) { toast(e.message || 'Falha ao carregar cliente'); }
    finally { if (!opts.silent) setDetailLoading(false); }
  }, [live]);

  // carrega lista + usuários ao entrar
  useEffect(() => {
    if (!user) return;
    loadClients();
    loadUsers();
  }, [user, loadClients, loadUsers]);

  const login = (u) => { setUser(u); setScreen(u && u.papel === 'cs' ? 'dashboard' : 'clients'); setClientId(null); };
  const logout = () => { setUser(null); localStorage.removeItem('p4-shell-user'); if (window.P4_API) window.P4_API.logout(); setClients(window.P4_CLIENTS || []); setDetail(null); };
  const openClient = (id) => { setClientId(id); setScreen('history'); loadDetail(id); };
  const back = () => { setScreen('clients'); setClientId(null); setDetail(null); loadClients(); };
  const newClient = () => { setClientId(null); setDetail(null); setScreen('new'); };
  const editClient = (id) => { setClientId(id); setScreen('edit'); loadDetail(id); };

  const saveClient = async (payload) => {
    if (live) {
      try {
        const saved = payload.id
          ? await window.P4_API.updateClient(payload.id, payload)
          : await window.P4_API.createClient(payload);
        await loadClients();
        if (payload.id) {
          setDetail(saved); setClientId(saved.id); setScreen('history');
          toast(`Cliente “${saved.loja}” atualizado`);
        } else {
          setScreen('clients');
          toast(`Cliente “${saved.loja}” cadastrado · ${saved.contas.length} marketplace(s)`);
        }
      } catch (e) { toast(e.message || 'Erro ao salvar cliente'); }
      return;
    }
    // fallback protótipo (backend offline)
    if (payload.id) { setScreen('history'); setClientId(payload.id); toast(`Cliente “${payload.loja}” atualizado`); }
    else { setScreen('clients'); toast(`Cliente “${payload.loja}” cadastrado · ${(payload.marketplaces || []).length} marketplace(s)`); }
  };

  const deleteClient = async (c) => {
    if (live) {
      try {
        await window.P4_API.deleteClient(c.id);
        await loadClients();
        setScreen('clients'); setClientId(null); setDetail(null);
        toast(`Cliente “${c.loja}” excluído`);
      } catch (e) { toast(e.message || 'Erro ao excluir cliente'); }
      return;
    }
    setScreen('clients'); setClientId(null); toast(`Cliente “${c.loja}” excluído`);
  };

  // Cliente selecionado (history/edit): estado quando live; senão, do mock.
  const resolvedDetail = live ? detail : (window.P4_CLIENTS || []).find((c) => c.id === clientId) || null;
  const resolvedDetailLoading = live && detailLoading;

  let content;
  if (!user) {
    content = <window.Login onLogin={login} />;
  } else if (screen === 'dashboard') {
    content = <window.CSDashboard user={user} role={role} onLogout={logout} onManageUsers={() => setUsersOpen(true)} onOpenClient={openClient} onGotoClients={() => setScreen('clients')} toast={toast} />;
  } else if (screen === 'new') {
    content = <window.NewClient user={user} role={role} users={usersList} onBack={back} onLogout={logout} onManageUsers={() => setUsersOpen(true)} onSave={saveClient} toast={toast} />;
  } else if (screen === 'edit') {
    content = resolvedDetailLoading
      ? <LoadingScreen label="Carregando cliente…" />
      : resolvedDetail
        ? <window.NewClient user={user} role={role} users={usersList} client={resolvedDetail} onBack={() => openClient(resolvedDetail.id)} onLogout={logout} onManageUsers={() => setUsersOpen(true)} onSave={saveClient} onDelete={deleteClient} toast={toast} />
        : <LoadingScreen label="Cliente não encontrado." />;
  } else if (screen === 'history') {
    content = resolvedDetailLoading
      ? <LoadingScreen label="Carregando histórico…" />
      : resolvedDetail
        ? <window.History client={resolvedDetail} user={user} role={role} onBack={back} onEdit={() => editClient(resolvedDetail.id)} onLogout={logout} onManageUsers={() => setUsersOpen(true)} generatorHref={GENERATOR_HREF} onRefresh={() => loadDetail(resolvedDetail.id, { silent: true })} toast={toast} />
        : <LoadingScreen label="Cliente não encontrado." />;
  } else {
    content = <window.Clients user={user} role={role} layout={t.layout} clients={clients} loading={clientsLoading} onOpenClient={openClient} onEditClient={editClient} onLogout={logout} onManageUsers={() => setUsersOpen(true)} onNewClient={newClient} onGotoDashboard={() => setScreen('dashboard')} toast={toast} />;
  }

  return (
    <>
      {content}
      {user && usersOpen ? <UsersModal me={user} onClose={() => setUsersOpen(false)} toast={toast} /> : null}
      {toastMsg ? <div className="toast"><span className="d"></span>{toastMsg}</div> : null}

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection label="Demonstração" />
        <window.TweakRadio label="Ver como" value={t.roleOverride}
          options={['auto', 'admin', 'analista']} onChange={(v) => setTweak('roleOverride', v)} />
        <window.TweakSection label="Layout" />
        <window.TweakRadio label="Lista de clientes" value={t.layout}
          options={['grade', 'lista']} onChange={(v) => setTweak('layout', v)} />
        <window.TweakSection label="Marca" />
        <window.TweakColor label="Cor de destaque" value={t.accent}
          options={['#56D54F', '#2A6FDB', '#E0922F', '#7A5AE0']} onChange={(v) => setTweak('accent', v)} />
      </window.TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
