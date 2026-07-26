// p4-closing.jsx — fechamento mensal dos clientes.
// Consolidado do mês por cliente (expansível em contas) contra as metas.

const MC_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function mcYmLabel(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return `${MC_MESES[m - 1]} / ${y}`;
}
function mcShiftYm(ym, delta) {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
// Componentes de data locais (não `toISOString`, que é UTC e vira o dia/mês
// cedo demais para quem está no fuso de SP — mesmo truque do `localISO` em
// p4-data.jsx, mas essa função não é exposta em `window`, por isso repetida aqui).
function mcHoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const mcMoney = (v) => (v == null ? '—' : window.fmtMoneyShort(v));
const mcRoas = (v) => (v == null ? '—' : v.toFixed(2).replace('.', ',') + 'x');
const mcPct = (v) => (v == null ? '—' : v.toFixed(1).replace('.', ',') + '%');

// ✓ / ✗ / — conforme o backend já resolveu em `atingiu`
function McMeta({ ok, meta, sufixo }) {
  if (ok === null || ok === undefined) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <span style={{ color: ok ? 'var(--brand-ink)' : 'var(--red-ink)', fontWeight: 600, fontSize: 11 }}>
      {ok ? '✓' : '✗'} meta {meta}{sufixo}
    </span>
  );
}

const MC_COLS = '2fr 1fr 1fr .8fr 1fr';

function MonthlyClosing({ user, role, onLogout, onManageUsers, toast }) {
  const [ym, setYm] = React.useState(mcHoje);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState('');
  const [aberto, setAberto] = React.useState(null); // clientId expandido (um por vez)
  const [obs, setObs] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);
  const [recarregar, setRecarregar] = React.useState(0); // incrementa p/ forçar nova busca após salvar

  // Guarda contra resposta atrasada: trocar de mês rápido no navegador, ou
  // salvar um fechamento (que também dispara nova busca via `recarregar`),
  // pode empilhar várias `getClosings` em paralelo; se uma mais velha
  // responder por último ela não pode sobrescrever os dados já exibidos
  // (mesmo padrão do CSDashboard). O `cancel` é por execução do efeito, então
  // continua protegendo os três setters mesmo quando é `recarregar` (e não
  // `ym`) que dispara a nova chamada.
  React.useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setErr('');
      try {
        if (!window.P4_API || !window.P4_API.isLogged()) throw new Error('Faça login para ver o fechamento.');
        const d = await window.P4_API.getClosings(ym);
        if (!cancel) setData(d);
      } catch (e) {
        if (!cancel) setErr(e.message || 'Falha ao carregar o fechamento.');
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [ym, recarregar]);

  const expandir = (c) => {
    if (aberto === c.clientId) { setAberto(null); return; }
    setAberto(c.clientId);
    setObs((c.closing && c.closing.observacoes) || '');
  };

  const gravar = async (c, fechado) => {
    if (salvando) return;
    setSalvando(true);
    try {
      await window.P4_API.saveClosing(c.clientId, ym, { observacoes: obs, fechado });
      toast(fechado ? 'Mês fechado.' : 'Mês reaberto.');
      setRecarregar((n) => n + 1); // dispara o efeito de carga, que tem guarda de obsolescência
    } catch (e) {
      toast(e.message || 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  };

  const r = (data && data.resumo) || {};

  return (
    <div className="shell">
      <window.TopBar title="Fechamento" user={user} role={role} onLogout={onLogout} onManageUsers={onManageUsers} />
      <div className="page">
        <div className="page-inner">
          <div className="ch-top">
            <div>
              <h1>Fechamento mensal</h1>
              <div className="ch-sub">Consolidado do mês por cliente, comparado com as metas cadastradas</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn-line" onClick={() => setYm(mcShiftYm(ym, -1))} title="Mês anterior">◀</button>
              <b style={{ fontSize: 14, minWidth: 150, textAlign: 'center' }}>{mcYmLabel(ym)}</b>
              <button className="btn-line" onClick={() => setYm(mcShiftYm(ym, 1))} title="Próximo mês">▶</button>
            </div>
          </div>

          {loading ? (
            <div className="empty"><b>Carregando…</b>Buscando os relatórios do mês.</div>
          ) : err ? (
            <div className="empty"><b>Não foi possível carregar</b>{err}</div>
          ) : !data.clients.length ? (
            <div className="empty"><b>Nenhum cliente operou neste mês</b>Escolha outro mês na navegação acima.</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16, fontSize: 12.5 }}>
                <span><b>{r.clientes}</b> clientes</span>
                <span style={{ color: 'var(--muted)' }}>·</span>
                <span style={{ color: 'var(--brand-ink)' }}><b>{r.fechados}</b> fechados</span>
                <span style={{ color: 'var(--muted)' }}>·</span>
                <span><b>{r.pendentes}</b> pendentes</span>
                {r.semRelatorio ? (
                  <>
                    <span style={{ color: 'var(--muted)' }}>·</span>
                    <span style={{ color: 'var(--amber-ink)' }}>⚠ <b>{r.semRelatorio}</b> sem relatório</span>
                  </>
                ) : null}
              </div>

              <div style={{ background: 'var(--paper,#fff)', border: '1px solid var(--line,#e9ece9)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: MC_COLS, gap: 10, padding: '12px 18px', borderBottom: '1px solid var(--line)', fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                  <span>Cliente</span>
                  <span style={{ textAlign: 'right' }}>Faturamento</span>
                  <span style={{ textAlign: 'right' }}>Investimento</span>
                  <span style={{ textAlign: 'right' }}>ROAS</span>
                  <span style={{ textAlign: 'right' }}>Situação</span>
                </div>
                {data.clients.map((c) => (
                  <React.Fragment key={c.clientId}>
                    <div onClick={() => expandir(c)}
                         style={{ display: 'grid', gridTemplateColumns: MC_COLS, gap: 10, padding: '13px 18px', borderBottom: '1px solid var(--line)', alignItems: 'center', fontSize: 13, cursor: 'pointer', opacity: c.closing && c.closing.fechadoEm ? .62 : 1 }}>
                      <span style={{ fontWeight: 600 }}>
                        <span style={{ color: 'var(--muted)', marginRight: 6 }}>{aberto === c.clientId ? '▾' : '▸'}</span>
                        {c.nReports === 0 ? <span title="operou no mês mas ficou sem relatório" style={{ color: 'var(--amber-ink)' }}>⚠ </span> : null}
                        {c.loja}
                        <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}> · {c.analista}</span>
                      </span>
                      <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcMoney(c.totals.faturamento)}</span>
                      <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcMoney(c.totals.investimento)}</span>
                      <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcRoas(c.totals.roas)}</span>
                      <span style={{ textAlign: 'right', fontSize: 11.5, fontWeight: 600, color: c.closing && c.closing.fechadoEm ? 'var(--brand-ink)' : 'var(--muted)' }}>
                        {c.closing && c.closing.fechadoEm ? '✓ fechado' : '● a fechar'}
                      </span>
                    </div>

                    {aberto === c.clientId ? (
                      <div style={{ padding: '14px 18px 18px 40px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2,#F7FAF6)' }}>
                        {c.contas.map((a) => (
                          <div key={a.accountId} style={{ display: 'grid', gridTemplateColumns: MC_COLS, gap: 10, padding: '8px 0', alignItems: 'center', fontSize: 12.5 }}>
                            <span style={{ color: 'var(--ink-2)' }}>
                              {a.marketplace}{a.conta ? ' · ' + a.conta : ''}
                              <span style={{ color: 'var(--muted)', fontSize: 11 }}> · {a.nReports} relat.</span>
                            </span>
                            <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcMoney(a.totals.faturamento)}</span>
                            <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcMoney(a.totals.investimento)}</span>
                            <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcRoas(a.totals.roas)}</span>
                            <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                              {/* metas vêm do cadastro já como texto BR ("4,00"), não como número — por
                                  isso não passam por mcRoas/mcPct (que chamam .toFixed); só o valor
                                  realizado (a.totals.*, número puro de `ratios()`) usa essas funções.
                                  ROAS não repete o valor aqui: a coluna à esquerda já mostra o realizado,
                                  então esta linha traz só o selo. ACOS/TACOS não têm coluna própria, por
                                  isso mantêm valor + selo — a linha do ROAS fica com o mesmo wrapper de
                                  layout (flex, baseline) só que com um filho a menos, p/ não destoar. */}
                              <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                                <McMeta ok={a.atingiu.roas} meta={a.metas.roas} sufixo="x" />
                              </span>
                              <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                                <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{mcPct(a.totals.acos)}</span>
                                <McMeta ok={a.atingiu.acos} meta={a.metas.acos} sufixo="%" />
                              </span>
                              <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                                <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{mcPct(a.totals.tacos)}</span>
                                <McMeta ok={a.atingiu.tacos} meta={a.metas.tacos} sufixo="%" />
                              </span>
                            </span>
                          </div>
                        ))}

                        <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <label style={{ flex: 1, minWidth: 260 }}>
                            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 5 }}>Observação do mês</div>
                            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3}
                                      placeholder="O que explica o resultado do mês? O que muda no próximo?"
                                      style={{ width: '100%', resize: 'vertical', fontFamily: "'Sora'", fontSize: 12.5, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9, background: 'var(--paper)', color: 'var(--ink)' }} />
                          </label>
                          {c.closing && c.closing.fechadoEm ? (
                            <button className="btn-line" disabled={salvando} onClick={() => gravar(c, false)}>Reabrir mês</button>
                          ) : (
                            <button className="btn-accent" disabled={salvando} onClick={() => gravar(c, true)}>Fechar mês</button>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </React.Fragment>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

window.MonthlyClosing = MonthlyClosing;
