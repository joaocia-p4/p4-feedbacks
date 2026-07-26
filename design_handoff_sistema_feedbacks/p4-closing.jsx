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

  // Guarda contra resposta atrasada: trocar de mês rápido no navegador dispara
  // várias `getClosings` em paralelo; se a mais velha responder por último ela
  // não pode sobrescrever os dados do mês atual (mesmo padrão do CSDashboard).
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
  }, [ym]);

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
                  <div key={c.clientId} style={{ display: 'grid', gridTemplateColumns: MC_COLS, gap: 10, padding: '13px 18px', borderBottom: '1px solid var(--line)', alignItems: 'center', fontSize: 13, opacity: c.closing && c.closing.fechadoEm ? .62 : 1 }}>
                    <span style={{ fontWeight: 600 }}>
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
