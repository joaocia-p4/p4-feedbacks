// p4-cs-dashboard.jsx — Painel de acompanhamento (CS / admin).
// KPIs + gráficos (relatórios por semana, clientes por gestor, entrada de
// clientes, por marketplace) + lista de relatórios em atraso.

const MONTHS_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function weekLbl(iso) { const p = String(iso).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : iso; }
function monthLbl(ym) { const p = String(ym).split('-'); return p.length === 2 ? `${MONTHS_ABBR[+p[1] - 1]}/${p[0].slice(2)}` : ym; }

function DashCard({ title, sub, children }) {
  return (
    <div className="dash-no-break" style={{ background: 'var(--paper, #fff)', border: '1px solid var(--line, #e9ece9)', borderRadius: 14, padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <b style={{ fontSize: 14 }}>{title}</b>
        {sub ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</span> : null}
      </div>
      {children}
    </div>
  );
}

// Barras verticais (relatórios por semana / entradas por mês).
function VBars({ items, color }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 150 }}>
      {items.map((it, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: it.value ? 'var(--ink, #1C242E)' : 'var(--muted)' }}>{it.value}</span>
          <div title={`${it.label}: ${it.value}`} style={{ width: '100%', maxWidth: 30, height: Math.max(3, (it.value / max) * 104) + 'px', background: it.value ? color : 'var(--line, #e9ece9)', borderRadius: '5px 5px 0 0' }}></div>
          <span style={{ fontSize: 9.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// Barras horizontais com fração "atrasado" destacada (clientes por gestor).
function HBars({ items, color, danger }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <div style={{ color: 'var(--muted)', fontSize: 12 }}>sem dados</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((it, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ fontWeight: 600 }}>{it.label}</span>
            <span style={{ color: 'var(--muted)' }}>{it.value}{it.danger ? <span style={{ color: 'var(--red)' }}> · {it.danger} atras.</span> : null}</span>
          </div>
          <div style={{ height: 10, background: 'var(--stage, #eceeec)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ width: (it.value / max) * 100 + '%', height: '100%', background: color, position: 'relative' }}>
              {it.danger ? <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: (it.danger / it.value) * 100 + '%', background: danger || 'var(--red)' }}></div> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Kpi({ label, value, foot, footColor }) {
  return (
    <div className="dash-no-break" style={{ background: 'var(--paper, #fff)', border: '1px solid var(--line, #e9ece9)', borderRadius: 13, padding: '14px 16px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>{value}</div>
      {foot ? <div style={{ fontSize: 11.5, color: footColor || 'var(--muted)', marginTop: 6 }}>{foot}</div> : null}
    </div>
  );
}

// Tabela de métricas (ROAS, faturamento, investimento, ACOS, TACOS) por analista, mensal.
function AnalystMetrics({ am }) {
  const [month, setMonth] = React.useState(am.months[0]);
  const cur = am.byMonth[month] || { rows: [], total: null };
  const money = (v) => window.fmtMoneyShort(v || 0);
  const roasF = (v) => (v == null ? '—' : Number(v).toFixed(2).replace('.', ',') + 'x');
  const pctF = (v) => (v == null ? '—' : Number(v).toFixed(1).replace('.', ',') + '%');
  const cols = '1.5fr .7fr 1.1fr 1.1fr .75fr .8fr .8fr';
  const num = (extra) => ({ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, fontSize: 13, textAlign: 'right', ...extra });
  const headCell = { textAlign: 'right' };
  const selStyle = { fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, fontWeight: 600, padding: '7px 11px', border: '1px solid var(--line)', borderRadius: 9, background: 'var(--paper)', color: 'var(--ink)', cursor: 'pointer' };
  return (
    <div className="dash-no-break" style={{ background: 'var(--paper, #fff)', border: '1px solid var(--line, #e9ece9)', borderRadius: 14, padding: '16px 18px', marginBottom: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <b style={{ fontSize: 14 }}>Métricas por analista</b>
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>ROAS · faturamento · investimento · ACOS · TACOS</span>
        </div>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={selStyle}>
          {am.months.map((m) => <option key={m} value={m}>{monthLbl(m)}</option>)}
        </select>
      </div>
      {cur.rows.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Sem relatórios neste mês.</div>
      ) : (
        <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--line)', background: 'rgba(0,0,0,.02)', fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
            <span>Analista</span>
            <span style={headCell}>Clientes</span>
            <span style={headCell}>Faturamento</span>
            <span style={headCell}>Investimento</span>
            <span style={headCell}>ROAS</span>
            <span style={headCell}>ACOS</span>
            <span style={headCell}>TACOS</span>
          </div>
          {cur.rows.map((r, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{r.analista}</span>
              <span style={num({ color: 'var(--muted)' })}>{r.nClientes}</span>
              <span style={num()}>{money(r.faturamento)}</span>
              <span style={num()}>{money(r.investimento)}</span>
              <span style={num()}>{roasF(r.roas)}</span>
              <span style={num()}>{pctF(r.acos)}</span>
              <span style={num()}>{pctF(r.tacos)}</span>
            </div>
          ))}
          {cur.total ? (
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '12px 16px', alignItems: 'center', background: 'rgba(0,0,0,.03)' }}>
              <span style={{ fontWeight: 800, fontSize: 13 }}>Total</span>
              <span style={num({ fontWeight: 800 })}>{cur.total.nClientes}</span>
              <span style={num({ fontWeight: 800 })}>{money(cur.total.faturamento)}</span>
              <span style={num({ fontWeight: 800 })}>{money(cur.total.investimento)}</span>
              <span style={num({ fontWeight: 800 })}>{roasF(cur.total.roas)}</span>
              <span style={num({ fontWeight: 800 })}>{pctF(cur.total.acos)}</span>
              <span style={num({ fontWeight: 800 })}>{pctF(cur.total.tacos)}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CSDashboard({ user, role, onLogout, onManageUsers, onOpenClient, onGotoClients, toast }) {
  const I = window.Icons;
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState('');

  React.useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setErr('');
      try {
        if (!window.P4_API || !window.P4_API.isLogged()) throw new Error('Faça login no sistema para ver o painel.');
        const d = await window.P4_API.getDashboard();
        if (!cancel) setData(d);
      } catch (e) {
        if (!cancel) setErr(e.message || 'Falha ao carregar o painel.');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  const t = (data && data.totals) || {};
  const wkColor = '#2A6FDB';
  const mkChart = (data && data.clientsByMarketplace || []).map((x) => ({ label: x.marketplace, value: x.clients, _c: window.mkColor(x.marketplace) }));

  return (
    <div className="shell">
      <window.TopBar title="Painel" user={user} role={role} onLogout={onLogout} onManageUsers={onManageUsers} />
      <div className="page">
        <div className="page-inner">
          {/* cabeçalho que aparece só na impressão (PDF) */}
          <div className="dash-print-head">
            <img src="assets/p4-mark.png" alt="P4" />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>Relatório de Acompanhamento · Método P4</div>
              <div style={{ fontSize: 11, color: '#6b7570' }}>Gerado em {window.brShort(data && data.today)}{user ? ' · por ' + user.nome : ''}</div>
            </div>
          </div>

          <div className="ch-top">
            <div>
              <h1>Painel de acompanhamento</h1>
              <div className="ch-sub">
                Visão geral dos clientes e relatórios{data ? <> · referência <b>{window.brShort(data.today)}</b></> : null}
              </div>
            </div>
            <div className="no-print" style={{ display: 'flex', gap: 8 }}>
              <button className="btn-line" onClick={onGotoClients}><I.users size={16} /> Ver clientes</button>
              <button className="btn-accent" onClick={() => window.print()} disabled={loading || !!err} title="Gerar PDF do painel">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></svg>
                Gerar relatório
              </button>
            </div>
          </div>

          {loading ? (
            <div className="empty"><b>Carregando painel…</b>Buscando os dados no servidor.</div>
          ) : err ? (
            <div className="empty"><b>Não foi possível carregar</b>{err}</div>
          ) : (
            <>
              {/* KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, marginBottom: 22 }}>
                <Kpi label="Clientes" value={t.totalClients} foot={`${t.clientsNoReports} sem relatório`} />
                <Kpi label="Atrasados" value={t.overdueClients} foot={`${t.onTimeRate}% no prazo`} footColor={t.overdueClients ? 'var(--red)' : 'var(--green-ink)'} />
                <Kpi label="Para enviar hoje" value={t.dueToday} foot="agendados p/ hoje" />
                <Kpi label="Relatórios" value={t.totalReports} foot={`${t.reportsPerClient} por cliente`} />
                <Kpi label="Relatórios na semana" value={t.reportsThisWeek} foot={`semana passada: ${t.reportsLastWeek}`} footColor={t.reportsThisWeek >= t.reportsLastWeek ? 'var(--green-ink)' : 'var(--red)'} />
                <Kpi label="ROAS médio" value={String(t.avgRoas).replace('.', ',') + 'x'} />
                <Kpi label="Faturamento" value={window.fmtMoneyShort(t.totalRevenue || 0)} foot="soma do último de cada conta" />
                <Kpi label="No prazo" value={t.onTimeRate + '%'} foot="entrega em dia" footColor={t.onTimeRate >= 80 ? 'var(--green-ink)' : 'var(--red)'} />
              </div>

              {/* Métricas por analista (mensal) */}
              {data.analystMonthly && data.analystMonthly.months.length
                ? <AnalystMetrics am={data.analystMonthly} />
                : null}

              {/* Gráficos */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 22 }}>
                <DashCard title="Relatórios gerados por semana" sub="últimas 12 semanas">
                  <VBars items={(data.reportsByWeek || []).map((w) => ({ label: weekLbl(w.weekStart), value: w.count }))} color={wkColor} />
                </DashCard>
                <DashCard title="Clientes por gestor" sub="responsável · atrasados">
                  <HBars items={(data.clientsByManager || []).map((m) => ({ label: m.analista, value: m.clients, danger: m.overdue }))} color="#56D54F" danger="var(--red)" />
                </DashCard>
                <DashCard title="Entrada de clientes" sub="novos clientes por mês">
                  {(data.entriesByMonth || []).length
                    ? <VBars items={data.entriesByMonth.map((m) => ({ label: monthLbl(m.month), value: m.count }))} color="#7A5AE0" />
                    : <div style={{ color: 'var(--muted)', fontSize: 12 }}>sem datas de entrada registradas</div>}
                </DashCard>
                <DashCard title="Clientes por marketplace" sub="contas ativas">
                  <HBars items={mkChart} color="#E0922F" />
                </DashCard>
              </div>

              {/* Atrasados */}
              <div className="sec-head">
                <h2>Relatórios em atraso</h2>
                <span className="mono">{(data.overdue || []).length} cliente(s)</span>
              </div>
              {(data.overdue || []).length === 0 ? (
                <div className="empty"><b>Tudo em dia 🎉</b>Nenhum cliente com relatório atrasado.</div>
              ) : (
                <div style={{ background: 'var(--paper, #fff)', border: '1px solid var(--line, #e9ece9)', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.6fr .8fr 1.2fr', gap: 10, padding: '12px 18px', borderBottom: '1px solid var(--line)', fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                    <span>Cliente</span><span>Gestor</span><span>Marketplaces</span><span>Atraso</span><span>Agenda</span>
                  </div>
                  {data.overdue.map((o) => (
                    <div key={o.clientId} onClick={() => onOpenClient(o.clientId)}
                         style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.6fr .8fr 1.2fr', gap: 10, padding: '13px 18px', borderBottom: '1px solid var(--line)', alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{o.loja}</span>
                      <span style={{ color: 'var(--muted)' }}>{o.analista || '—'}</span>
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {o.contas.map((m, i) => (
                          <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 999, color: window.mkColor(m.marketplace), background: window.mkBg(m.marketplace) }}>
                            {m.marketplace}{m.conta ? ' · ' + m.conta : ''}
                          </span>
                        ))}
                      </span>
                      <span style={{ fontWeight: 700, color: 'var(--red)' }}>{o.daysLate != null ? o.daysLate + 'd' : '—'}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>{o.reason === 'agenda' ? '⚠ agenda vencida' : o.agendaLabel}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

window.CSDashboard = CSDashboard;
