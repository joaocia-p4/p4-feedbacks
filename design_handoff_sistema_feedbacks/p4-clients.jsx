// p4-clients.jsx — client picker (grid only; list layout removed).
// Analysts see only their own clients; admins see all + management actions.

function MkBadge({ name }) {
  const meta = (window.P4_MK || {})[name] || { short: '?' };
  return (
    <span className="mk-badge" style={{ color: window.mkColor(name), background: window.mkBg(name) }}>
      {meta.short}
    </span>
  );
}

// Metadados de cada tag de status: classe CSS (cor) + rótulo exibido.
const STATUS_META = {
  'em-dia': { cls: 'ok', label: 'Em dia' },
  hoje: { cls: 'today', label: 'Enviar hoje' },
  atrasado: { cls: 'late', label: 'Atrasado' },
  pausado: { cls: 'paused', label: 'Pausado' },
  onboarding: { cls: 'onboarding', label: 'Onboarding' },
  encerrado: { cls: 'closed', label: 'Encerrado' },
};
window.P4_STATUS_META = STATUS_META;

// tag = statusTag do backend (precedência já resolvida). Sem tag, deriva do legado
// (status em-dia/atrasado + encerrado) para manter compatibilidade com o histórico.
function StatusTag({ status, encerrado, tag, motivo }) {
  const key = tag || (encerrado ? 'encerrado' : status === 'em-dia' ? 'em-dia' : 'atrasado');
  const m = STATUS_META[key] || STATUS_META['em-dia'];
  return (
    <span className={'status-tag ' + m.cls} title={motivo || undefined}>
      <span className="d"></span>{m.label}
    </span>
  );
}

function MkRow({ contas }) {
  return (
    <div className="mk-row">
      {contas.map((m) => {
        const sub = m.ativo === false ? ' · encerrado' : m.pausado ? (' · pausado' + (m.motivoPausa ? ': ' + m.motivoPausa : '')) : (m.status === 'atrasado' ? ' · atrasado' : ' · em dia');
        const dot = m.ativo === false ? 'var(--muted)' : m.pausado ? 'var(--amber)' : (m.status === 'atrasado' ? 'var(--red)' : window.mkBrand(m.marketplace));
        return (
          <span key={m.id} className="mk-chip" title={m.marketplace + sub}
                style={{ color: window.mkColor(m.marketplace), background: window.mkBg(m.marketplace) }}>
            <span className="d" style={{ background: dot }}></span>
            {m.marketplace}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- reputação (Mercado Livre)
// Cache de sessão + fila com concorrência limitada: cada card busca a própria
// reputação quando entra na viewport (IntersectionObserver), no máx. 3 de cada vez.
const REP_LEVELS_UI = [
  { id: '1_red', hex: '#e53935' },
  { id: '2_orange', hex: '#ff7733' },
  { id: '3_yellow', hex: '#ffe600' },
  { id: '4_light_green', hex: '#7dd956' },
  { id: '5_green', hex: '#00a650' },
];
const REP_MEDALS = { platinum: 'MercadoLíder Platinum', gold: 'MercadoLíder Gold', silver: 'MercadoLíder' };
const repCache = {};            // contaId -> { state: 'ok'|'notconnected'|'error', rep? }
const repQueue = [];            // jobs pendentes
const repInFlight = {};         // contaId -> [callbacks] aguardando a mesma busca em voo (dedup)
let repActive = 0;
const REP_MAX_CONCURRENT = 3;

function repPump() {
  while (repActive < REP_MAX_CONCURRENT && repQueue.length) {
    const job = repQueue.shift();
    repActive++;
    job().finally(() => { repActive--; repPump(); });
  }
}

function repFetch(contaId, cb) {
  if (repCache[contaId]) { cb(repCache[contaId]); return; }
  // dedup: se já há uma busca em voo p/ esta conta, só anexa o callback (não enfileira outra)
  if (repInFlight[contaId]) { repInFlight[contaId].push(cb); return; }
  repInFlight[contaId] = [cb];
  repQueue.push(async () => {
    let res;
    try {
      const d = await window.P4_API.meliReputation(contaId);
      res = (d && d.ok) ? { state: 'ok', rep: d } : { state: 'notconnected' };
    } catch (e) {
      res = (e && e.status === 400) ? { state: 'notconnected' } : { state: 'error' };
    }
    if (res.state !== 'error') repCache[contaId] = res; // erro não entra no cache (permite "tentar de novo")
    const cbs = repInFlight[contaId] || [cb];
    delete repInFlight[contaId];
    cbs.forEach((fn) => fn(res));
  });
  repPump();
}

function RepShield() {
  return (
    <span className="rep-ic">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3Z" /></svg>
    </span>
  );
}

function RepMuted({ title, sub, action, onAction }) {
  return (
    <div className="rep muted">
      <RepShield />
      <div className="rep-txt">
        <div className="lvl">{title}</div>
        <div className="medal">{sub}</div>
      </div>
      {action
        ? <button className="rep-connect" onClick={(e) => { e.stopPropagation(); onAction(); }}>{action} →</button>
        : null}
    </div>
  );
}

function ClientCardReputation({ client, canManage, onConnect }) {
  const live = !!(window.P4_API && window.P4_API.isLogged());
  const mlConta = (client.contas || []).find((m) => m.marketplace === 'Mercado Livre' && m.ativo !== false);
  const contaId = mlConta ? mlConta.id : null;
  const enabled = !!(live && contaId && !client.encerrado);
  const [st, setSt] = React.useState(() => (enabled && repCache[contaId]) ? repCache[contaId] : { state: 'loading' });
  const ref = React.useRef(null);

  // lazy-load: só busca quando o bloco entra na viewport
  React.useEffect(() => {
    if (!enabled || st.state !== 'loading') return;
    let cancel = false;
    const load = () => repFetch(contaId, (res) => { if (!cancel) setSt(res); });
    const el = ref.current;
    if (el && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { io.disconnect(); load(); }
      }, { rootMargin: '120px' });
      io.observe(el);
      return () => { cancel = true; io.disconnect(); };
    }
    load(); // fallback sem IntersectionObserver
    return () => { cancel = true; };
  }, [enabled, contaId, st.state]);

  if (client.encerrado) return <RepMuted title="Cliente encerrado" sub="Sem monitoramento ativo" />;
  if (!mlConta) return <RepMuted title="Reputação indisponível" sub="Sem conta no Mercado Livre" />;
  if (!live) return <RepMuted title="Reputação indisponível" sub="Modo demonstração" />;

  if (st.state === 'loading') {
    return (
      <div className="rep loading" ref={ref}>
        <div className="rep-therm">
          {REP_LEVELS_UI.map((l) => <span key={l.id} className="rep-seg" style={{ background: '#c9cfca' }}></span>)}
        </div>
        <div className="rep-txt">
          <div className="sk" style={{ height: 13, width: '55%' }}></div>
          <div className="sk" style={{ height: 9, width: '40%', marginTop: 6 }}></div>
        </div>
      </div>
    );
  }
  if (st.state === 'notconnected') {
    return (
      <RepMuted title="Reputação indisponível" sub="Mercado Livre não conectado"
        action={canManage && onConnect ? 'Conectar' : null} onAction={onConnect} />
    );
  }
  if (st.state === 'error') {
    return (
      <RepMuted title="Não foi possível carregar" sub="Reputação do Mercado Livre"
        action="Tentar de novo" onAction={() => setSt({ state: 'loading' })} />
    );
  }

  const r = st.rep;
  if (!r.levelId) return <RepMuted title="Sem nível de reputação" sub={r.nickname ? `Conta ${r.nickname}` : 'Conta nova no Mercado Livre'} />;
  const medal = REP_MEDALS[r.powerSeller];
  return (
    <div className="rep" title={r.nickname ? `Conta ${r.nickname}` : undefined}>
      <div className="rep-therm">
        {REP_LEVELS_UI.map((l) => (
          <span key={l.id} className={'rep-seg' + (l.id === r.levelId ? ' on' : '')} style={{ background: l.hex, color: l.hex }}></span>
        ))}
      </div>
      <div className="rep-txt">
        <div className="lvl">Reputação {String(r.colorLabel || '').toLowerCase()}</div>
        <div className="medal">
          {medal
            ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="9" r="6" /><path d="M8 14l-2 8 6-3 6 3-2-8" /></svg>{medal}</>
            : 'Sem medalha'}
        </div>
      </div>
    </div>
  );
}
window.ClientCardReputation = ClientCardReputation;

function ClientCard({ c, onOpen, onEdit, canManage }) {
  const I = window.Icons;
  const tag = c.statusTag || (c.encerrado ? 'encerrado' : c.status === 'atrasado' ? 'atrasado' : 'em-dia');
  const isLate = tag === 'atrasado';
  const dim = tag === 'pausado' || tag === 'onboarding'; // não são cobrados → cartão atenuado
  return (
    <div className={'ccard' + (c.encerrado ? ' is-closed' : '') + (isLate ? ' late' : '') + (dim ? ' is-dim' : '') + (tag === 'hoje' ? ' is-today' : '')} onClick={() => onOpen(c.id)}
      role="button" tabIndex={0} aria-label={`Abrir ${c.loja}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(c.id); } }}>
      <div className="cc-head">
        <div className="nm">
          <div className="loja">{c.loja}</div>
          <div className="an">{c.tipo} · {c.analista}</div>
        </div>
        <StatusTag tag={tag} motivo={c.motivoPausa} />
      </div>
      <MkRow contas={c.contas} />
      <ClientCardReputation client={c} canManage={canManage} onConnect={onEdit ? () => onEdit(c.id) : null} />
      <div className="cc-foot">
        <span className="cc-sched"><I.cal size={13} /> {window.agendaShort(c.agenda)}</span>
        <span className="lr">Último<b>{window.brShort(c.last)}</b></span>
      </div>
    </div>
  );
}

function Clients({ user, role, clients, loading, onOpenClient, onEditClient, onLogout, onManageUsers, onNewClient, onImport, onGotoDashboard, toast }) {
  const I = window.Icons;
  const [q, setQ] = React.useState('');
  const [mk, setMk] = React.useState('Todos');
  const [st, setSt] = React.useState('Todos');
  const [dueOn, setDueOn] = React.useState(false);
  const [dueDate, setDueDate] = React.useState(window.P4_TODAY);
  const [an, setAn] = React.useState('Todos');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef(null);
  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const canManage = role === 'admin' || role === 'analista'; // CS é somente leitura
  const seesAll = role === 'admin' || role === 'cs'; // admin e CS veem todos
  const all = clients || window.P4_CLIENTS || [];
  // analista vê só os seus; admin e CS veem todos.
  const scoped = seesAll ? all : all.filter((c) => c.analista === user.nome);
  // tag efetiva (usa statusTag do backend; deriva do legado se ausente).
  const tagOf = (c) => c.statusTag || (c.encerrado ? 'encerrado' : c.status === 'atrasado' ? 'atrasado' : 'em-dia');
  // "cobrável" = entra na cobrança de atraso/envio: não encerrado, não pausado, não onboarding.
  const chargeable = (c) => { const t = tagOf(c); return t !== 'encerrado' && t !== 'pausado' && t !== 'onboarding'; };
  // encerrados continuam visíveis (mutados), mas fora das métricas de atraso/envio.
  const activeScoped = scoped.filter((c) => !c.encerrado);
  const closedN = scoped.length - activeScoped.length;

  const markets = (window.P4_AD_MARKETPLACES || []).filter((m) => scoped.some((c) => c.marketplaces.includes(m)));
  const mkCount = (m) => activeScoped.filter((c) => c.marketplaces.includes(m)).length;
  // contagem "para enviar hoje" fixa no header (independe da data escolhida no toggle);
  // exclui pausados/onboarding, que não são cobrados.
  const dueTodayCount = scoped.filter((c) => chargeable(c) && (window.isDueOn(c.agenda, window.P4_TODAY) || c.status === 'atrasado')).length;
  // analistas com clientes no escopo (filtro só faz sentido p/ quem vê todos)
  const analistOptions = [...new Set(scoped.map((c) => c.analista).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));

  const dueMatch = (c) => chargeable(c) && (window.isDueOn(c.agenda, dueDate) || c.status === 'atrasado');
  const ST_MAP = { 'Em dia': 'em-dia', 'Enviar hoje': 'hoje', Atrasado: 'atrasado', Pausado: 'pausado', Onboarding: 'onboarding', Encerrado: 'encerrado' };
  let list = scoped.filter((c) => {
    if (dueOn && !dueMatch(c)) return false;
    if (seesAll && an !== 'Todos' && c.analista !== an) return false;
    if (mk !== 'Todos' && !c.marketplaces.includes(mk)) return false;
    if (st !== 'Todos' && ST_MAP[st] && tagOf(c) !== ST_MAP[st]) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      if (!(c.loja.toLowerCase().includes(t) || c.analista.toLowerCase().includes(t) || c.marketplaces.join(' ').toLowerCase().includes(t))) return false;
    }
    return true;
  });
  // encerrados sempre por último; em "para enviar", atrasados e depois "enviar hoje" primeiro
  const dueRank = (c) => { const t = tagOf(c); return t === 'atrasado' ? 0 : t === 'hoje' ? 1 : 2; };
  list = [...list].sort((a, b) => {
    if (!!a.encerrado !== !!b.encerrado) return a.encerrado ? 1 : -1;
    return dueOn ? dueRank(a) - dueRank(b) : 0;
  });

  const dueCount = scoped.filter(dueMatch).length;
  const isToday = dueDate === window.P4_TODAY;

  const lateN = activeScoped.filter((c) => tagOf(c) === 'atrasado').length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const firstName = (user && user.nome) ? user.nome.split(' ')[0] : '';

  // Exporta TODOS os clientes do escopo para .xlsx no mesmo formato da importação
  // (com ID Cliente / ID Conta), para editar em massa e reimportar atualizando.
  const exportClients = () => {
    if (!window.XLSX) { toast('Recarregue a página (Ctrl+Shift+R) e tente novamente.'); return; }
    const metaStr = (v) => (typeof v === 'number' ? v.toFixed(2).replace('.', ',') : (v == null ? '' : String(v)));
    const headers = ['ID Cliente', 'Loja', 'Tipo', 'Analista', 'Marketplace', 'ID Conta', 'Conta', 'Meta Investimento', 'Meta ROAS', 'Meta ACOS', 'Meta TACOS', 'Data entrada', 'Data encerramento', 'Status', 'Frequência', 'Dia', 'Observações'];
    const rows = [headers];
    scoped.forEach((c) => {
      const ag = c.agenda || {};
      const freq = ag.freq || 'Semanal';
      const dia = freq === 'Mensal' ? (ag.diaMes != null ? String(ag.diaMes) : '') : (ag.diaSemana || '');
      const cts = (c.contas && c.contas.length) ? c.contas : (c.marketplaces || []).map((m) => ({ marketplace: m }));
      cts.forEach((m, i) => {
        rows.push([
          c.id || '', c.loja || '', c.tipo || 'Loja', c.analista || '',
          m.marketplace || '', m.id || '', m.conta || '',
          metaStr(m.metaInvestimento), metaStr(m.metaRoas), metaStr(m.metaAcos), metaStr(m.metaTacos),
          m.dataEntrada || '', m.dataEncerramento || '', m.ativo === false ? 'Encerrado' : 'Ativo',
          i === 0 ? freq : '', i === 0 ? dia : '', i === 0 ? (c.observacoes || '') : '',
        ]);
      });
    });
    if (rows.length <= 1) { toast('Nenhum cliente para exportar.'); return; }
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(11, h.length + 1) }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
    window.XLSX.writeFile(wb, `clientes-${window.P4_TODAY || 'export'}.xlsx`);
    toast(`Planilha exportada · ${scoped.length} cliente(s)`);
  };

  return (
    <div className="shell">
      <window.TopBar title="Clientes" user={user} role={role} onLogout={onLogout} onManageUsers={onManageUsers} />
      <div className="page">
        <div className="page-inner">

          <div className="ch-top">
            <div>
              <div className="ch-eyebrow">{greeting}, {firstName} 👋</div>
              <h1>{dueOn ? 'Feedbacks para enviar' : (seesAll ? 'Todos os clientes' : 'Meus clientes')}</h1>
              <div className="ch-stats">
                <span className="stat ok"><span className="dt"></span><span className="n">{activeScoped.length}</span> {activeScoped.length === 1 ? 'ativo' : 'ativos'}</span>
                <span className="sep">·</span>
                {lateN > 0
                  ? <span className="stat late"><span className="dt"></span><span className="n">{lateN}</span> {lateN === 1 ? 'atrasado' : 'atrasados'}</span>
                  : <span className="stat ok"><span className="dt"></span>tudo em dia</span>}
                <span className="sep">·</span>
                <span className="stat send"><span className="dt"></span><span className="n">{dueTodayCount}</span> para enviar hoje</span>
                {closedN > 0 ? <><span className="sep">·</span><span className="stat closed"><span className="dt"></span>{closedN} {closedN === 1 ? 'encerrado' : 'encerrados'}</span></> : null}
              </div>
            </div>
            <div className="ch-actions">
              {canManage ? (
                <div style={{ position: 'relative' }} ref={menuRef}>
                  <button className={'km-btn' + (menuOpen ? ' on' : '')} onClick={() => setMenuOpen((o) => !o)} title="Ações em massa" aria-label="Ações em massa">
                    <I.dots size={18} />
                  </button>
                  {menuOpen ? (
                    <div className="km-menu">
                      {onImport ? <button className="km-item" onClick={() => { setMenuOpen(false); onImport(); }}><I.upload size={16} /> Adicionar clientes em massa</button> : null}
                      <button className="km-item" onClick={() => { setMenuOpen(false); exportClients(); }}><I.edit size={16} /> Editar clientes em massa</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {canManage ? <button className="btn-accent" onClick={onNewClient}><I.plus size={16} /> Adicionar cliente</button> : null}
            </div>
          </div>

          <div className="toolbar">
            <div className="search">
              <I.search size={17} />
              <input aria-label="Buscar clientes" placeholder="Buscar por loja, analista ou marketplace…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button className={'due-toggle' + (dueOn ? ' on' : '')} onClick={() => setDueOn((v) => !v)}>
              <I.cal size={15} /> Para enviar {isToday ? 'hoje' : ''} <span className="cnt">{dueCount}</span>
            </button>
            {dueOn ? (
              <>
                <div className="due-date">
                  <I.cal size={14} />
                  <input type="date" aria-label="Data de envio" value={dueDate} onChange={(e) => setDueDate(e.target.value || window.P4_TODAY)} />
                </div>
                {!isToday ? <button className="chip" onClick={() => setDueDate(window.P4_TODAY)}>Hoje</button> : null}
                <span className="due-info">{window.weekdayName(dueDate)}</span>
              </>
            ) : null}
            {seesAll && analistOptions.length > 1 ? (
              <div className={'filter-select' + (an !== 'Todos' ? ' on' : '')}>
                <I.users size={16} />
                <select value={an} onChange={(e) => setAn(e.target.value)} aria-label="Filtrar por analista" title="Filtrar por analista">
                  <option value="Todos">Todos os analistas</option>
                  {analistOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            ) : null}
          </div>

          <div className="filters">
            <div className="chips">
              {['Todos', 'Em dia', 'Enviar hoje', 'Atrasado', 'Pausado', 'Onboarding', 'Encerrado'].map((s) => (
                <button key={s} className={'chip' + (st === s ? ' on' : '')} onClick={() => setSt(s)}>{s}</button>
              ))}
            </div>
            {markets.length > 1 ? <div className="div"></div> : null}
            {markets.length > 1 ? (
              <div className="chips">
                {markets.map((m) => (
                  <button key={m} className={'chip' + (mk === m ? ' on' : '')} onClick={() => setMk(mk === m ? 'Todos' : m)}>
                    <span className="dot" style={{ background: window.mkBrand(m) }}></span>{m} <span className="c">{mkCount(m)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {loading && all.length === 0
            ? <div className="empty"><b>Carregando clientes…</b>Buscando os dados no servidor.</div>
            : list.length === 0
            ? <div className="empty"><b>{dueOn ? 'Nada para enviar' : 'Nenhum cliente encontrado'}</b>{dueOn ? 'Nenhum feedback agendado para a data e nenhum atrasado.' : 'Ajuste a busca ou os filtros acima.'}</div>
            : (
              <div className="cgrid">
                {list.map((c) => <ClientCard key={c.id} c={c} onOpen={onOpenClient} onEdit={canManage ? onEditClient : null} canManage={canManage} />)}
                {canManage
                  ? <button className="add-card" onClick={onNewClient}>
                      <span className="plus"><I.plus size={22} /></span>
                      Adicionar cliente
                    </button>
                  : null}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

window.Clients = Clients;
window.StatusTag = StatusTag;
window.MkBadge = MkBadge;
