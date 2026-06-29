// p4-clients.jsx — client picker. Cards (default) or list layout via tweak.
// Analysts see only their own clients; admins see all + management actions.

function MkBadge({ name }) {
  const meta = (window.P4_MK || {})[name] || { short: '?' };
  return (
    <span className="mk-badge" style={{ color: window.mkColor(name), background: window.mkBg(name) }}>
      {meta.short}
    </span>
  );
}

function StatusTag({ status, encerrado }) {
  if (encerrado) {
    return (
      <span className="status-tag closed">
        <span className="d"></span>Encerrado
      </span>
    );
  }
  const ok = status === 'em-dia';
  return (
    <span className={'status-tag ' + (ok ? 'ok' : 'late')}>
      <span className="d"></span>{ok ? 'Em dia' : 'Atrasado'}
    </span>
  );
}

function MkRow({ contas }) {
  return (
    <div className="mk-row">
      {contas.map((m) => (
        <span key={m.id} className="mk-chip" title={m.marketplace + (m.ativo === false ? ' · encerrado' : (m.status === 'atrasado' ? ' · atrasado' : ' · em dia'))}
              style={{ color: window.mkColor(m.marketplace), background: window.mkBg(m.marketplace) }}>
          <span className="d" style={{ background: m.ativo === false ? 'var(--muted)' : (m.status === 'atrasado' ? 'var(--red)' : window.mkBrand(m.marketplace)) }}></span>
          {m.marketplace}
        </span>
      ))}
    </div>
  );
}

function ClientCard({ c, onOpen, onEdit }) {
  return (
    <div className={'ccard' + (c.encerrado ? ' is-closed' : '')} onClick={() => onOpen(c.id)}>
      <div className="cc-head">
        <div className="nm">
          <div className="loja">{c.loja}</div>
          <div className="an">{c.tipo} · {c.analista}</div>
          <div className="cc-sched"><window.Icons.cal size={13} /> Envio · {window.agendaShort(c.agenda).toLowerCase()}</div>
        </div>
        <StatusTag status={c.status} encerrado={c.encerrado} />
      </div>
      <MkRow contas={c.contas} />
      <div className="cc-foot">
        <span className="lr">Último · <b>{window.brShort(c.last)}</b></span>
        <div className="cc-foot-r">
          <span className="cc-count">{c.contas.length} {c.contas.length === 1 ? 'marketplace' : 'marketplaces'} · {c.n} rel.</span>
          {onEdit
            ? <button className="cc-edit" title="Editar cliente" onClick={(e) => { e.stopPropagation(); onEdit(c.id); }}><window.Icons.edit size={15} /></button>
            : null}
        </div>
      </div>
    </div>
  );
}

function ClientRow({ c, onOpen }) {
  return (
    <div className={'clist-row' + (c.encerrado ? ' is-closed' : '')} onClick={() => onOpen(c.id)}>
      <div>
        <div className="loja">{c.loja}</div>
        <div className="an">{c.tipo} · {c.analista}</div>
      </div>
      <div><MkRow contas={c.contas} /></div>
      <div className="num">{String(c.roasW).replace('.', ',')}x</div>
      <div className="num">{window.fmtMoneyShort(c.fatLatest)}</div>
      <div className="num" style={{ fontWeight: 500, color: 'var(--muted)' }}>{window.brShort(c.last)}</div>
      <div><StatusTag status={c.status} encerrado={c.encerrado} /></div>
    </div>
  );
}

function Clients({ user, role, layout, clients, loading, onOpenClient, onEditClient, onLogout, onManageUsers, onNewClient, onImport, onGotoDashboard, toast }) {
  const I = window.Icons;
  const [q, setQ] = React.useState('');
  const [mk, setMk] = React.useState('Todos');
  const [st, setSt] = React.useState('Todos');
  const [dueOn, setDueOn] = React.useState(false);
  const [dueDate, setDueDate] = React.useState(window.P4_TODAY);

  const isAdmin = role === 'admin';
  const canManage = role === 'admin' || role === 'analista'; // CS é somente leitura
  const seesAll = role === 'admin' || role === 'cs'; // admin e CS veem todos
  const all = clients || window.P4_CLIENTS || [];
  // analista vê só os seus; admin e CS veem todos.
  const scoped = seesAll ? all : all.filter((c) => c.analista === user.nome);
  // encerrados continuam visíveis (mutados), mas fora das métricas de atraso/envio.
  const activeScoped = scoped.filter((c) => !c.encerrado);
  const closedN = scoped.length - activeScoped.length;

  const markets = ['Todos', ...(window.P4_AD_MARKETPLACES || []).filter((m) => scoped.some((c) => c.marketplaces.includes(m)))];

  const dueMatch = (c) => !c.encerrado && (window.isDueOn(c.agenda, dueDate) || c.status === 'atrasado');
  let list = scoped.filter((c) => {
    if (dueOn && !dueMatch(c)) return false;
    if (mk !== 'Todos' && !c.marketplaces.includes(mk)) return false;
    if (st === 'Em dia' && (c.encerrado || c.status !== 'em-dia')) return false;
    if (st === 'Atrasado' && (c.encerrado || c.status !== 'atrasado')) return false;
    if (st === 'Encerrado' && !c.encerrado) return false;
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      if (!(c.loja.toLowerCase().includes(t) || c.analista.toLowerCase().includes(t) || c.marketplaces.join(' ').toLowerCase().includes(t))) return false;
    }
    return true;
  });
  // encerrados sempre por último; em "para enviar", atrasados primeiro
  list = [...list].sort((a, b) => {
    if (!!a.encerrado !== !!b.encerrado) return a.encerrado ? 1 : -1;
    return dueOn ? (b.status === 'atrasado') - (a.status === 'atrasado') : 0;
  });

  const dueCount = scoped.filter(dueMatch).length;
  const schedCount = scoped.filter((c) => !c.encerrado && window.isDueOn(c.agenda, dueDate)).length;
  const isToday = dueDate === window.P4_TODAY;

  const lateN = activeScoped.filter((c) => c.status === 'atrasado').length;
  const emDia = activeScoped.length - lateN;
  const totalMk = activeScoped.reduce((a, c) => a + (c.contas ? c.contas.filter((m) => m.ativo !== false).length : ((c.marketplaces && c.marketplaces.length) || 0)), 0);
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
              <div className="ch-sub">
                {dueOn
                  ? <><b>{dueCount}</b> para enviar · {schedCount} no dia ({isToday ? 'hoje' : window.weekdayName(dueDate).toLowerCase()}, {window.brShort(dueDate)}) · <b style={{ color: lateN ? 'var(--red)' : 'inherit' }}>{lateN}</b> atrasado{lateN === 1 ? '' : 's'}</>
                  : <><b>{activeScoped.length}</b> {activeScoped.length === 1 ? 'cliente' : 'clientes'}
                      {lateN > 0 ? <> · <b style={{ color: 'var(--red)' }}>{lateN}</b> com relatório atrasado</> : <> · tudo em dia</>}
                      {closedN > 0 ? <> · {closedN} encerrado{closedN === 1 ? '' : 's'}</> : null}</>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {canManage ? <button className="btn-line" onClick={exportClients} title="Exportar todos os clientes para editar em massa">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v10" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></svg> Exportar planilha
              </button> : null}
              {canManage && onImport ? <button className="btn-line" onClick={onImport}><I.upload size={16} /> Importar planilha</button> : null}
              {canManage ? <button className="btn-accent" onClick={onNewClient}><I.plus size={16} /> Adicionar cliente</button> : null}
            </div>
          </div>

          <div className="kpis" style={{ marginBottom: 22 }}>
            <div className="kpi">
              <div className="k">Clientes</div>
              <div className="v">{activeScoped.length}</div>
              <div className="trend" style={{ color: 'var(--muted)' }}>{totalMk} {totalMk === 1 ? 'marketplace' : 'marketplaces'}{closedN ? ` · ${closedN} encerrado${closedN === 1 ? '' : 's'}` : ''}</div>
            </div>
            <div className="kpi">
              <div className="k">Em dia</div>
              <div className="v" style={{ color: 'var(--green-ink)' }}>{emDia}</div>
              <div className="trend" style={{ color: 'var(--muted)' }}>{activeScoped.length ? Math.round((emDia / activeScoped.length) * 100) : 0}% dos ativos</div>
            </div>
            <div className="kpi">
              <div className="k">Atrasados</div>
              <div className="v" style={{ color: lateN ? 'var(--red)' : 'var(--ink)' }}>{lateN}</div>
              <div className="trend" style={{ color: lateN ? 'var(--red)' : 'var(--muted)' }}>{lateN ? 'precisam de atenção' : 'tudo certo'}</div>
            </div>
            <div className="kpi" style={{ cursor: 'pointer' }} onClick={() => setDueOn(true)} title="Ver feedbacks para enviar">
              <div className="k">Para enviar</div>
              <div className="v">{dueCount}</div>
              <div className="trend" style={{ color: 'var(--muted)' }}>{isToday ? 'na data de hoje' : window.brShort(dueDate)}</div>
            </div>
          </div>

          <div className="duebar">
            <button className={'due-toggle' + (dueOn ? ' on' : '')} onClick={() => setDueOn((v) => !v)}>
              <I.cal size={15} /> Para enviar {dueOn ? `· ${dueCount}` : ''}
            </button>
            {dueOn
              ? (
                <>
                  <div className="due-date">
                    <I.cal size={14} />
                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value || window.P4_TODAY)} />
                  </div>
                  <button className={'chip' + (isToday ? ' on' : '')} onClick={() => setDueDate(window.P4_TODAY)}>Hoje</button>
                  <span className="due-info">{window.weekdayName(dueDate)}</span>
                  {lateN > 0 ? <span className="due-late">+{lateN} atrasado{lateN === 1 ? '' : 's'}</span> : null}
                </>
              )
              : <span className="due-hint">agendados para a data + relatórios atrasados</span>}
          </div>

          <div className="toolbar">
            <div className="search">
              <I.search size={17} />
              <input placeholder="Buscar por loja, analista ou marketplace…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="chips">
              {markets.map((m) => (
                <button key={m} className={'chip' + (mk === m ? ' on' : '')} onClick={() => setMk(m)}>
                  {m !== 'Todos' ? <span className="dot" style={{ background: window.mkBrand(m) }}></span> : null}{m}
                </button>
              ))}
            </div>
            <div className="chips">
              {['Todos', 'Em dia', 'Atrasado', 'Encerrado'].map((s) => (
                <button key={s} className={'chip' + (st === s ? ' on' : '')} onClick={() => setSt(s)}>{s}</button>
              ))}
            </div>
          </div>

          {loading && all.length === 0
            ? <div className="empty"><b>Carregando clientes…</b>Buscando os dados no servidor.</div>
            : list.length === 0
            ? <div className="empty"><b>{dueOn ? 'Nada para enviar' : 'Nenhum cliente encontrado'}</b>{dueOn ? 'Nenhum feedback agendado para a data e nenhum atrasado.' : 'Ajuste a busca ou os filtros acima.'}</div>
            : layout === 'lista'
              ? (
                <div className="clist">
                  <div className="clist-row head">
                    <span>Loja / Analista</span><span>Marketplace</span><span>ROAS</span><span>Faturamento</span><span>Último</span><span>Status</span>
                  </div>
                  {list.map((c) => <ClientRow key={c.id} c={c} onOpen={onOpenClient} />)}
                </div>
              )
              : (
                <div className="cgrid">
                  {list.map((c) => <ClientCard key={c.id} c={c} onOpen={onOpenClient} onEdit={canManage ? onEditClient : null} />)}
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
