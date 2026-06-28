// p4-history.jsx — dedicated report history for one client.

// Formatadores por tipo de indicador.
const MX_FMT = {
  money: (v) => window.fmtMoneyShort(v),
  int: (v) => String(Math.round(v || 0)),
  x: (v) => (v || 0).toFixed(2).replace('.', ',') + 'x',
  pct: (v) => (v || 0).toFixed(2).replace('.', ',') + '%',
};

// Os 8 indicadores (mesmos do relatório), cada um com cor, formato e direção "boa".
const MX_METRICS = [
  { key: 'faturamento', label: 'Faturamento', color: '#2DA67A', fmt: 'money', dir: 'up' },
  { key: 'vendas', label: 'Vendas', color: '#5B8DEF', fmt: 'int', dir: 'up', type: 'bar' },
  { key: 'receitaAds', label: 'Receita Ads', color: '#9B86D9', fmt: 'money', dir: 'up' },
  { key: 'vendasAds', label: 'Vendas Ads', color: '#3FB6C2', fmt: 'int', dir: 'up', type: 'bar' },
  { key: 'investimento', label: 'Investimento', color: '#94A0AE', fmt: 'money', dir: 'neutral' },
  { key: 'roas', label: 'ROAS', color: '#E8A05C', fmt: 'x', dir: 'up' },
  { key: 'acos', label: 'ACOS', color: '#DB87AC', fmt: 'pct', dir: 'down' },
  { key: 'tacos', label: 'TACOS', color: '#C9B05A', fmt: 'pct', dir: 'down' },
];

const MX_CSS = `
.mx { background: var(--paper,#fff); border:1px solid var(--line,#e9ece9); border-radius:14px; padding:16px 18px; margin-bottom:22px; }
.mx-head { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:8px; }
.mx-head b { font-size:15px; font-weight:700; }
.mx-sub { font-size:11px; color:var(--muted); }
.mx-range { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.mx-presets { display:inline-flex; gap:4px; }
.mx-preset { border:1px solid var(--line,#e9ece9); background:#fff; border-radius:8px; padding:5px 10px; font-size:12px; font-weight:600; color:var(--muted); cursor:pointer; transition:border-color .14s, background .14s, color .14s; }
.mx-preset:hover { border-color:#cfd6cf; color:#1C242E; }
.mx-preset.on { background:#1C242E; border-color:#1C242E; color:#fff; }
.mx-pick { position:relative; }
.mx-pick-btn { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line,#e9ece9); border-radius:10px; padding:6px 11px; background:#fff; cursor:pointer; font-family:'JetBrains Mono',monospace; font-size:11.5px; font-weight:600; color:#1C242E; transition:border-color .14s, box-shadow .14s; }
.mx-pick-btn:hover { border-color:#cfd6cf; }
.mx-pick.open .mx-pick-btn { border-color:var(--accent); box-shadow:0 0 0 3px rgba(var(--accent-rgb),.14); }
.mx-pick-btn > svg:first-child { color:var(--muted); flex:none; }
.mx-pick-arrow { color:var(--muted); }
.mx-pick-chev { color:var(--muted); flex:none; margin-left:1px; transition:transform .16s ease; }
.mx-pick.open .mx-pick-chev { transform:rotate(180deg); }
.mx-pick-pop { position:absolute; top:calc(100% + 6px); right:0; z-index:20; width:235px; background:#fff; border:1px solid var(--line,#e9ece9); border-radius:12px; box-shadow:0 14px 40px rgba(20,30,25,.16); padding:8px; animation:mxPop .14s ease; }
@keyframes mxPop { from { opacity:0; transform:translateY(-5px); } to { opacity:1; transform:translateY(0); } }
.mx-pick-hint { font-family:'JetBrains Mono',monospace; font-size:9px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); padding:3px 8px 8px; }
.mx-pick-list { display:flex; flex-direction:column; gap:2px; max-height:264px; overflow:auto; }
.mx-pick-opt { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; border:0; background:transparent; cursor:pointer; padding:8px 10px; border-radius:8px; font-family:'JetBrains Mono',monospace; font-size:12px; font-weight:600; color:#1C242E; transition:background .1s; text-align:left; }
.mx-pick-opt:hover { background:#f4f7f3; }
.mx-pick-opt.in { background:rgba(var(--accent-rgb),.13); }
.mx-pick-opt.end { background:var(--accent); color:#0d1410; }
.mx-pick-tag { font-size:8.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; opacity:.75; flex:none; }
.mx-cards { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin:6px 0 16px; }
@media (max-width:720px){ .mx-cards { grid-template-columns:repeat(2, 1fr); } }
.mx-card { position:relative; border:1px solid var(--line,#e9ece9); border-radius:12px; padding:14px 14px 13px; cursor:pointer; background:#fff; overflow:hidden; transition:box-shadow .14s, border-color .14s, background .14s; }
.mx-card:hover { border-color:#cfd6cf; background:#fcfdfc; }
.mx-card .mx-acc { position:absolute; left:0; right:0; top:0; height:3px; background:currentColor; opacity:.2; transition:opacity .14s; }
.mx-card.on .mx-acc { opacity:1; }
.mx-card.on { box-shadow:inset 0 0 0 1.5px currentColor; }
.mx-card-l { font-family:'JetBrains Mono',monospace; font-size:9px; font-weight:600; color:var(--muted); display:flex; align-items:center; gap:6px; margin-bottom:9px; text-transform:uppercase; letter-spacing:.1em; }
.mx-card-l .mx-d { width:8px; height:8px; flex:none; }
.mx-card-v { font-family:'JetBrains Mono',monospace; font-size:18px; font-weight:700; color:#1C242E; letter-spacing:-.01em; line-height:1.05; }
.mx-plot { position:relative; }
.mx-plot svg { display:block; cursor:crosshair; }
.mx-tip { position:absolute; top:6px; pointer-events:none; background:#fff; color:#1C242E; border:1px solid var(--line,#e9ece9); border-radius:10px; padding:9px 11px; box-shadow:0 10px 28px rgba(20,30,25,.14); z-index:4; transition:left .13s ease; }
.mx-tip-h { font-family:'JetBrains Mono',monospace; font-size:10px; color:var(--muted); font-weight:600; letter-spacing:.06em; text-transform:uppercase; margin-bottom:7px; line-height:1.3; }
.mx-tip-row { display:flex; align-items:center; gap:7px; padding:2px 0; font-size:12px; white-space:nowrap; }
.mx-tip-row .mx-d { width:8px; height:8px; flex:none; }
.mx-tip-row .mx-lab { color:var(--muted); }
.mx-tip-row .mx-val { font-family:'JetBrains Mono',monospace; font-weight:700; margin-left:auto; padding-left:12px; color:#1C242E; }
@keyframes mxDraw { from { stroke-dashoffset:1; } to { stroke-dashoffset:0; } }
@keyframes mxGrow { from { transform:scaleY(0); } to { transform:scaleY(1); } }
@keyframes mxFade { from { opacity:0; } to { opacity:1; } }
.mx-line { stroke-dasharray:1; stroke-dashoffset:1; animation:mxDraw .85s ease forwards; }
.mx-area { animation:mxFade .6s ease both; }
.mx-grp circle { animation:mxFade .5s ease both; }
.mx-bar { transform-box:fill-box; transform-origin:bottom; animation:mxGrow .6s cubic-bezier(.2,.7,.3,1) both; transition:fill-opacity .15s ease; }
.mx-guide { transition:x1 .13s ease, x2 .13s ease; }
.mx-ring { transition:cx .13s ease, cy .13s ease; }
.mx-cmp { margin-top:14px; border:1px solid var(--line,#e9ece9); border-radius:12px; overflow:hidden; }
.mx-cmp-h { display:flex; justify-content:space-between; align-items:center; gap:10px; background:#f7f9f6; padding:9px 13px; font-size:12.5px; }
.mx-cmp-clear { border:none; background:transparent; color:var(--muted); cursor:pointer; font-size:12px; font-weight:600; display:inline-flex; align-items:center; gap:5px; padding:3px 6px; border-radius:7px; }
.mx-cmp-clear:hover { background:#eceee9; color:#1C242E; }
.mx-cmp-row { display:grid; grid-template-columns:1.3fr 1fr 1fr .9fr; gap:8px; padding:8px 13px; font-size:12.5px; align-items:center; border-top:1px solid var(--line,#f0f2ef); }
.mx-cmp-row.head { font-family:'JetBrains Mono',monospace; font-size:9px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:500; border-top:none; }
.mx-cmp-row .mx-m { display:inline-flex; align-items:center; gap:7px; font-weight:600; }
.mx-cmp-row .mx-d { width:9px; height:9px; flex:none; }
.mx-cmp-num { font-family:'JetBrains Mono',monospace; font-weight:600; font-variant-numeric:tabular-nums; }
.mx-cmp-d { font-family:'JetBrains Mono',monospace; font-weight:700; font-variant-numeric:tabular-nums; }
`;

const mxArrow = (pc) => (pc == null ? '' : pc > 0.05 ? '▲' : pc < -0.05 ? '▼' : '–');
const mxDeltaColor = (pc, dir) => {
  if (pc == null || Math.abs(pc) < 0.5 || dir === 'neutral') return 'var(--muted)';
  return (dir === 'up') === (pc > 0) ? '#2f9a2b' : '#d8423a';
};

// Caminho suave (Catmull-Rom → Bézier) para arredondar as linhas do gráfico.
// yMin/yMax limitam os pontos de controle: como a curva Bézier fica dentro do
// casco convexo dos pontos, clampá-los garante que a linha não ultrapasse as
// bordas do gráfico (sem overshoot nos picos/vales).
function mxSmooth(pts, yMin, yMax) {
  if (!pts.length) return '';
  if (pts.length < 3) return 'M' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
  const t = 0.16;
  const cl = (y) => (yMin == null ? y : Math.max(yMin, Math.min(yMax, y)));
  const d = ['M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1)];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * t, c1y = cl(p1[1] + (p2[1] - p0[1]) * t);
    const c2x = p2[0] - (p3[0] - p1[0]) * t, c2y = cl(p2[1] - (p3[1] - p1[1]) * t);
    d.push('C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1));
  }
  return d.join(' ');
}

// Seletor de período (intervalo) — popover estilizado no padrão da página.
// Seleção em 2 cliques: 1º clique = início, 2º = fim (com prévia ao passar o mouse).
function PeriodPicker({ all, from, to, setFrom, setTo }) {
  const [open, setOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState(null);
  const [hov, setHov] = React.useState(null);
  const ref = React.useRef(null);
  const listRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setAnchor(null); } };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setAnchor(null); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    // rola para deixar o fim do intervalo visível ao abrir
    if (listRef.current) {
      const el = listRef.current.children[to];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const lbl = (i) => window.brRange(all[i].periodoIni, all[i].periodoFim);
  const toggle = () => { setOpen((o) => !o); setAnchor(null); };
  const pick = (i) => {
    if (anchor == null) { setAnchor(i); setHov(i); }
    else { setFrom(Math.min(anchor, i)); setTo(Math.max(anchor, i)); setAnchor(null); setOpen(false); }
  };
  const lo = anchor != null ? Math.min(anchor, hov == null ? anchor : hov) : from;
  const hi = anchor != null ? Math.max(anchor, hov == null ? anchor : hov) : to;

  return (
    <div className={'mx-pick' + (open ? ' open' : '')} ref={ref}>
      <button className="mx-pick-btn" onClick={toggle}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        <span>{window.brShort(all[from].periodoIni)}</span>
        <span className="mx-pick-arrow">→</span>
        <span>{window.brShort(all[to].periodoFim)}</span>
        <svg className="mx-pick-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open ? (
        <div className="mx-pick-pop">
          <div className="mx-pick-hint">{anchor == null ? 'Selecione o início' : 'Selecione o fim'}</div>
          <div className="mx-pick-list" ref={listRef}>
            {all.map((r, i) => {
              const inRange = i >= lo && i <= hi;
              const isEnd = i === lo || i === hi;
              const tag = lo === hi ? '' : i === lo ? 'início' : i === hi ? 'fim' : '';
              return (
                <button key={i} className={'mx-pick-opt' + (inRange ? ' in' : '') + (isEnd ? ' end' : '')}
                        onMouseEnter={() => setHov(i)} onClick={() => pick(i)}>
                  <span>{lbl(i)}</span>
                  {isEnd && tag ? <span className="mx-pick-tag">{tag}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Gráfico único e interativo: sobrepõe métricas (comparar métricas), passa o
// mouse para ver os valores de cada período (tooltip) e clica para fixar um
// período de base e comparar com os demais (comparar períodos).
function MetricsExplorer({ reports }) {
  const all = React.useMemo(() => [...reports].reverse(), [reports]); // antigo → novo (todos)
  const total = all.length;
  const [sel, setSel] = React.useState(['faturamento', 'vendas', 'vendasAds']);
  const [from, setFrom] = React.useState(Math.max(0, total - 12));
  const [to, setTo] = React.useState(total ? total - 1 : 0);
  const [hover, setHover] = React.useState(total ? total - 1 : 0);
  const [pinned, setPinned] = React.useState(null);
  const wrapRef = React.useRef(null);
  const svgRef = React.useRef(null);
  const [w, setW] = React.useState(820);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((es) => { for (const e of es) setW(Math.max(320, Math.floor(e.contentRect.width - 36))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Troca de conta → volta o intervalo para os últimos 12 períodos.
  React.useEffect(() => { setFrom(Math.max(0, total - 12)); setTo(total ? total - 1 : 0); }, [total]);
  // Mudou o intervalo → limpa a fixação e foca o último período do intervalo.
  React.useEffect(() => { setPinned(null); setHover(Math.max(0, to - from)); }, [from, to]);

  if (!total) {
    return (
      <div className="mx" ref={wrapRef}>
        <div className="mx-head"><b>Desempenho dos anúncios</b></div>
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: '8px 0' }}>Sem relatórios para exibir ainda.</div>
      </div>
    );
  }

  const series = all.slice(from, to + 1); // intervalo selecionado (antigo → novo)
  const n = series.length;

  const H = 300, padL = 14, padR = 14, padT = 18, padB = 34;
  const plotW = Math.max(1, w - padL - padR);
  const plotH = H - padT - padB;
  const xAt = (i) => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const numAt = (i, k) => { const v = Number(series[i][k]); return isNaN(v) ? null : v; };

  const toggle = (k) => setSel((s) => (s.includes(k) ? (s.length > 1 ? s.filter((x) => x !== k) : s) : [...s, k]));

  const selMetrics = MX_METRICS.filter((m) => sel.includes(m.key));
  const lineMetrics = selMetrics.filter((m) => m.type !== 'bar');
  const barMetrics = selMetrics.filter((m) => m.type === 'bar');

  // Faixa de dados de uma métrica (para legenda/escalas).
  const dataRange = (k) => {
    const vs = series.map((_, i) => numAt(i, k)).filter((v) => v != null);
    if (!vs.length) return [0, 0];
    return [Math.min(...vs), Math.max(...vs)];
  };

  // Linhas: escala independente por métrica (R$, %, x convivem no gráfico).
  // `linePad` deixa um respiro vertical para a curva suave não colar nas bordas.
  const linePad = 10;
  const info = {};
  lineMetrics.forEach((m) => {
    let [min, max] = dataRange(m.key);
    if (min === max) { const p = Math.abs(min) * 0.15 || 1; min -= p; max += p; }
    info[m.key] = { yAt: (v) => padT + linePad + (1 - (v - min) / (max - min)) * (plotH - linePad * 2) };
  });

  // Barras (Vendas / Vendas Ads): escala única ancorada em zero, para que a
  // parte de Ads apareça como fração do total — igual ao painel do marketplace.
  const barBase = padT + plotH;
  let barMax = 1;
  barMetrics.forEach((m) => { const mx = dataRange(m.key)[1]; if (mx > barMax) barMax = mx; });
  if (barMax <= 0) barMax = 1;
  const yAtBar = (v) => padT + (1 - v / barMax) * plotH;
  const gap = n > 1 ? plotW / (n - 1) : plotW;
  const barW = Math.min(gap * 0.5, 30);
  // Empilhadas na MESMA coluna: Vendas atrás, Vendas Ads à frente (Ads ⊆ total),
  // de modo que a parte de baixo é a venda vinda de Ads e o topo, o restante.
  const barOp = (m, hovered) => (m.key === 'vendas' ? (hovered ? 0.85 : 0.5) : (hovered ? 1 : 0.92));

  const hv = Math.max(0, Math.min(n - 1, hover));
  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const rel = (e.clientX - rect.left - padL) / plotW;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  };
  const onClick = () => setPinned((p) => (p === hv ? null : hv));

  const labelStep = Math.max(1, Math.ceil(n / 6));

  // Tooltip flutuante posicionado no período em foco.
  const tipW = 188;
  let tipLeft = xAt(hv) - tipW / 2;
  tipLeft = Math.max(2, Math.min(w - tipW - 2, tipLeft));

  const singleLine = lineMetrics.length === 1 && barMetrics.length === 0;

  // Agregação do intervalo para os cards: somas; ROAS/ACOS/TACOS recalculados a
  // partir das somas (média ponderada), igual ao painel do marketplace.
  const aggOver = (rows, m) => {
    const s = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    if (m.key === 'roas') { const inv = s('investimento'); return inv ? s('receitaAds') / inv : 0; }
    if (m.key === 'acos') { const rec = s('receitaAds'); return rec ? (s('investimento') / rec) * 100 : 0; }
    if (m.key === 'tacos') { const fat = s('faturamento'); return fat ? (s('investimento') / fat) * 100 : 0; }
    return s(m.key);
  };
  const rangeLabel = `${window.brShort(series[0].periodoIni || series[0].periodoFim)} – ${window.brShort(series[n - 1].periodoFim)}`;
  // Atalhos de período (Últimos N · Tudo).
  const setLast = (k) => { setTo(total - 1); setFrom(Math.max(0, total - k)); };
  const isPreset = (k) => to === total - 1 && from === Math.max(0, total - k);
  const isAll = to === total - 1 && from === 0;

  return (
    <div className="mx" ref={wrapRef}>
      <style dangerouslySetInnerHTML={{ __html: MX_CSS }} />
      <div className="mx-head">
        <div>
          <b>Desempenho dos anúncios</b>
          <span className="mx-sub"> · {n} {n === 1 ? 'período' : 'períodos'} · {rangeLabel}</span>
        </div>
        <div className="mx-range">
          {total > 4 ? (
            <div className="mx-presets">
              {[4, 8, 12].filter((k) => k < total).map((k) => (
                <button key={k} className={'mx-preset' + (isPreset(k) ? ' on' : '')} onClick={() => setLast(k)}>{k}</button>
              ))}
              <button className={'mx-preset' + (isAll ? ' on' : '')} onClick={() => { setFrom(0); setTo(total - 1); }}>Tudo</button>
            </div>
          ) : null}
          <PeriodPicker all={all} from={from} to={to} setFrom={setFrom} setTo={setTo} />
        </div>
      </div>

      {/* Cards de métricas — valores agregados do intervalo. Clique para incluir/remover do gráfico. */}
      <div className="mx-cards">
        {MX_METRICS.map((m) => {
          const on = sel.includes(m.key);
          return (
            <div key={m.key} className={'mx-card' + (on ? ' on' : '')} style={{ color: m.color }} onClick={() => toggle(m.key)}
                 title={on ? 'Clique para remover do gráfico' : 'Clique para incluir no gráfico'}>
              <span className="mx-acc" />
              <div className="mx-card-l"><span className="mx-d" style={{ background: m.color, borderRadius: m.type === 'bar' ? 2 : '50%' }} />{m.label}</div>
              <div className="mx-card-v">{MX_FMT[m.fmt](aggOver(series, m))}</div>
            </div>
          );
        })}
      </div>

      <div className="mx-plot">
        <svg ref={svgRef} width={w} height={H} viewBox={`0 0 ${w} ${H}`}
             onMouseMove={onMove} onMouseLeave={() => setHover(n - 1)} onClick={onClick}>
          {/* grades horizontais */}
          {[0, 0.25, 0.5, 0.75, 1].map((f, k) => (
            <line key={k} x1={padL} x2={w - padR} y1={padT + plotH * f} y2={padT + plotH * f}
                  stroke="#eef1ee" strokeWidth="1" />
          ))}
          {/* barras Vendas / Vendas Ads — empilhadas na mesma coluna (Ads na frente) */}
          {barMetrics.length ? series.map((_, i) => (
            <g key={'bar:' + from + ':' + to + ':' + i}>
              {barMetrics.map((m) => {
                const v = numAt(i, m.key);
                if (v == null) return null;
                const by = yAtBar(v);
                const bh = Math.max(0, barBase - by);
                return <rect className="mx-bar" key={m.key} x={xAt(i) - barW / 2} y={by} width={barW} height={bh} rx="2.5"
                             fill={m.color} fillOpacity={barOp(m, i === hv)} style={{ animationDelay: (i * 0.03).toFixed(2) + 's' }} />;
              })}
            </g>
          )) : null}
          {/* período fixado */}
          {pinned != null ? (
            <line x1={xAt(pinned)} x2={xAt(pinned)} y1={padT} y2={padT + plotH}
                  stroke="#1C242E" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.5" />
          ) : null}
          {/* período em foco */}
          <line className="mx-guide" x1={xAt(hv)} x2={xAt(hv)} y1={padT} y2={padT + plotH} stroke="#c8cfc7" strokeWidth="1.5" />

          {/* linhas das métricas */}
          {lineMetrics.map((m) => {
            const inf = info[m.key];
            const pts = [];
            series.forEach((_, i) => { const v = numAt(i, m.key); if (v != null) pts.push([xAt(i), inf.yAt(v)]); });
            if (!pts.length) return null;
            const d = mxSmooth(pts, padT, padT + plotH);
            const mi = lineMetrics.indexOf(m);
            return (
              <g className="mx-grp" key={m.key + ':' + from + ':' + to}>
                {singleLine ? (
                  <path className="mx-area" d={`${d} L${pts[pts.length - 1][0].toFixed(1)},${(padT + plotH).toFixed(1)} L${pts[0][0].toFixed(1)},${(padT + plotH).toFixed(1)} Z`}
                        fill={m.color} opacity="0.09" />
                ) : null}
                <path className="mx-line" pathLength="1" d={d} fill="none" stroke={m.color} strokeWidth="2.4"
                      strokeLinejoin="round" strokeLinecap="round" style={{ animationDelay: (mi * 0.07).toFixed(2) + 's' }} />
                {pts.map((p, k) => <circle key={k} cx={p[0]} cy={p[1]} r="2.6" fill={m.color} />)}
                {numAt(hv, m.key) != null ? (
                  <circle className="mx-ring" cx={xAt(hv)} cy={inf.yAt(numAt(hv, m.key))} r="5" fill="#fff" stroke={m.color} strokeWidth="2.6" />
                ) : null}
              </g>
            );
          })}

          {/* rótulos do eixo X (datas finais) */}
          {series.map((r, i) => {
            if (i % labelStep !== 0 && i !== n - 1) return null;
            const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
            return (
              <text key={i} x={xAt(i)} y={H - 12} fontSize="10" fontFamily="'JetBrains Mono', monospace" fill="var(--muted)" textAnchor={anchor}>
                {window.brShort(r.periodoFim)}
              </text>
            );
          })}
        </svg>

        {/* tooltip do período em foco */}
        <div className="mx-tip" style={{ left: tipLeft, width: tipW }}>
          <div className="mx-tip-h">{window.brRange(series[hv].periodoIni, series[hv].periodoFim)}</div>
          {selMetrics.map((m) => {
            const cur = numAt(hv, m.key);
            return (
              <div className="mx-tip-row" key={m.key}>
                <span className="mx-d" style={{ background: m.color, borderRadius: m.type === 'bar' ? 2 : '50%' }} />
                <span className="mx-lab">{m.label}</span>
                <span className="mx-val">{cur != null ? MX_FMT[m.fmt](cur) : '—'}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Comparar períodos: tabela base × atual quando há um período fixado;
          caso contrário, legenda com valor atual e faixa min–max. */}
      {pinned != null && pinned !== hv ? (
        <div className="mx-cmp">
          <div className="mx-cmp-h">
            <span><b>Comparando períodos</b> · {window.brShort(series[pinned].periodoFim)} → {window.brShort(series[hv].periodoFim)}</span>
            <button className="mx-cmp-clear" onClick={() => setPinned(null)}>✕ limpar</button>
          </div>
          <div className="mx-cmp-row head">
            <span>Indicador</span>
            <span>{window.brShort(series[pinned].periodoFim)}</span>
            <span>{window.brShort(series[hv].periodoFim)}</span>
            <span>Variação</span>
          </div>
          {selMetrics.map((m) => {
            const a = numAt(pinned, m.key), b = numAt(hv, m.key);
            const pc = a != null && a !== 0 && b != null ? ((b - a) / a) * 100 : null;
            return (
              <div className="mx-cmp-row" key={m.key}>
                <span className="mx-m"><span className="mx-d" style={{ background: m.color, borderRadius: m.type === 'bar' ? 2 : '50%' }} />{m.label}</span>
                <span className="mx-cmp-num">{a != null ? MX_FMT[m.fmt](a) : '—'}</span>
                <span className="mx-cmp-num">{b != null ? MX_FMT[m.fmt](b) : '—'}</span>
                <span className="mx-cmp-d" style={{ color: mxDeltaColor(pc, m.dir) }}>{pc != null ? `${mxArrow(pc)} ${Math.abs(pc).toFixed(1).replace('.', ',')}%` : '—'}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function History({ client, user, role, onBack, onEdit, onLogout, onManageUsers, generatorHref, onRefresh, toast }) {
  const I = window.Icons;
  const c = client;
  const [idx, setIdx] = React.useState(0);
  const conta = c.contas[Math.min(idx, c.contas.length - 1)];
  const reports = conta.reports; // newest first
  const last = reports[0] || {};
  const prev = reports[1] || {};
  const isAdmin = role === 'admin';
  const canManage = role === 'admin' || role === 'analista'; // CS é somente leitura
  const multi = c.contas.length > 1;

  // Rótulo da conta — diferencia várias contas do mesmo marketplace pelo apelido
  // (ou por número, se não houver apelido).
  const mkCounts = c.contas.reduce((a, m) => ((a[m.marketplace] = (a[m.marketplace] || 0) + 1), a), {});
  const contaLabel = (m, i) => {
    if (!m) return '—';
    if (mkCounts[m.marketplace] <= 1) return m.marketplace;
    if (m.conta) return `${m.marketplace} · ${m.conta}`;
    const ord = c.contas.slice(0, i + 1).filter((x) => x.marketplace === m.marketplace).length;
    return `${m.marketplace} #${ord}`;
  };

  const roasDelta = prev.roas ? ((last.roas - prev.roas) / prev.roas) * 100 : 0;
  const fatDelta = prev.faturamento ? ((last.faturamento - prev.faturamento) / prev.faturamento) * 100 : 0;
  const totalFat = reports.reduce((a, r) => a + r.faturamento, 0);

  const live = !!(window.P4_API && window.P4_API.isLogged());
  const importInputRef = React.useRef(null);

  // Abre o gerador vinculado a esta conta, continuando de `lastPayload`
  // (o gerador lê este "contexto" do localStorage).
  const abrirGeradorNovo = (lastPayload) => {
    try {
      localStorage.setItem('p4-report-context', JSON.stringify({
        mode: 'new',
        accId: conta.id,
        clientId: c.id,
        marketplace: conta.marketplace,
        loja: c.loja,
        lojaTipo: c.tipo === 'Marca' ? 'Cliente' : 'Loja',
        analista: c.analista,
        metas: {
          metaInvestimento: conta.metaInvestimento,
          metaRoas: conta.metaRoas,
          metaAcos: conta.metaAcos,
          metaTacos: conta.metaTacos,
        },
        last: lastPayload || null,
      }));
    } catch (e) {}
    window.open(generatorHref, '_blank', 'noopener');
  };
  // novo relatório a partir do último período
  const novoRelatorio = () => abrirGeradorNovo((last && last.payload) ? last.payload : null);
  // duplicar: novo período continuando deste relatório específico
  const duplicarRelatorio = (r) => abrirGeradorNovo(r && r.payload ? r.payload : null);

  // Abre um relatório existente no gerador (somente visualizar/imprimir).
  const contaMetas = () => ({ metaInvestimento: conta.metaInvestimento, metaRoas: conta.metaRoas, metaAcos: conta.metaAcos, metaTacos: conta.metaTacos });
  const abrirRelatorio = (r) => {
    try {
      if (r && r.payload) localStorage.setItem('p4-report-context', JSON.stringify({ mode: 'restore', restore: r.payload, metas: contaMetas() }));
      else localStorage.removeItem('p4-report-context');
    } catch (e) {}
    window.open(generatorHref, '_blank', 'noopener');
  };

  // Exporta um relatório como .json (aqui na página do cliente).
  const exportarRelatorio = (r) => {
    try {
      const data = r.payload || r;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const nome = (c.loja || 'relatorio').replace(/[^a-zA-Z0-9À-ſ ]+/g, '').replace(/\s+/g, '-') || 'relatorio';
      const per = (r.periodoIni || '') + (r.periodoFim ? '_a_' + r.periodoFim : '');
      a.href = url; a.download = nome + (per ? '-' + per : '') + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast('Não foi possível exportar o relatório.'); }
  };

  // Gera o relatório (PDF) com TUDO que já temos: período mais recente + todo o
  // histórico como comparativo (gráficos de evolução), pronto para exportar.
  const brMoney = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const brDec = (n) => Number(n || 0).toFixed(2).replace('.', ',');
  const comparisonEntry = (r) => {
    const pl = r.payload || {};
    const pick = (a, b) => (a != null && a !== '' ? a : b);
    return {
      label: '',
      periodoIni: pick(pl.periodoIni, r.periodoIni) || '',
      periodoFim: pick(pl.periodoFim, r.periodoFim) || '',
      faturamento: pick(pl.faturamento, brMoney(r.faturamento)),
      vendas: pick(pl.vendas, String(r.vendas || '')),
      receitaAds: pick(pl.receitaAds, brMoney(r.receitaAds)),
      vendasAds: pick(pl.vendasAds, String(r.vendasAds || '')),
      investimento: pick(pl.investimento, brMoney(r.investimento)),
      roas: pick(pl.roas, brDec(r.roas)),
      acos: pick(pl.acos, brDec(r.acos)),
      tacos: pick(pl.tacos, brDec(r.tacos)),
      roasAuto: false, acosAuto: false, tacosAuto: false,
      preP4: !!pl.preP4,
    };
  };
  const gerarRelatorioAtual = () => {
    if (!reports.length) { toast('Sem relatórios para gerar'); return; }
    const latest = reports[0];
    const base = latest.payload
      ? { ...latest.payload }
      : {
          marketplace: conta.marketplace, analista: c.analista, loja: c.loja, lojaTipo: c.tipo === 'Marca' ? 'Cliente' : 'Loja',
          periodicidade: 'Semanal', roasAuto: false, acosAuto: false, tacosAuto: false,
          periodoIni: latest.periodoIni || '', periodoFim: latest.periodoFim || '',
          faturamento: brMoney(latest.faturamento), vendas: String(latest.vendas || ''), receitaAds: brMoney(latest.receitaAds),
          vendasAds: String(latest.vendasAds || ''), investimento: brMoney(latest.investimento),
          roas: brDec(latest.roas), acos: brDec(latest.acos), tacos: brDec(latest.tacos),
          metaInvestimento: conta.metaInvestimento, metaRoas: conta.metaRoas, metaAcos: conta.metaAcos, metaTacos: conta.metaTacos,
          obs: '', obsImages: [], status: {},
        };
    base.prev = reports.slice(1).map(comparisonEntry); // todo o histórico vira comparativo
    try { localStorage.setItem('p4-report-context', JSON.stringify({ mode: 'restore', restore: base, metas: contaMetas() })); } catch (e) {}
    window.open(generatorHref, '_blank', 'noopener');
  };


  // Excluir relatório (admin) → DELETE /reports/:id
  const excluirRelatorio = async (r) => {
    if (!live) { toast('Entre no sistema para excluir relatórios.'); return; }
    if (!window.confirm('Excluir este relatório? Esta ação não pode ser desfeita.')) return;
    try {
      await window.P4_API.deleteReport(r.id);
      toast('Relatório excluído');
      if (onRefresh) onRefresh();
    } catch (e) { toast(e.message || 'Falha ao excluir relatório'); }
  };

  // Importar um .json (exportado pelo gerador) e salvar nesta conta.
  const onImportFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!live) { toast('Entre no sistema para importar relatórios.'); return; }
    let payload;
    try { payload = JSON.parse(await file.text()); }
    catch (err) { toast('Arquivo .json inválido.'); return; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { toast('Arquivo inválido.'); return; }
    payload.marketplace = conta.marketplace; // garante a conta certa
    try {
      const res = await window.P4_API.createReport(conta.id, payload);
      const c = (res && res.created) || 0;
      const o = (res && res.overwritten) || 0;
      toast(c || o ? `${c} importado(s)${o ? ' · ' + o + ' atualizado(s)' : ''}` : 'Nada novo a importar');
      if (onRefresh) onRefresh();
    } catch (err) { toast(err.message || 'Falha ao importar relatório'); }
  };

  const Trend = ({ v }) => (
    <div className={'trend ' + (v >= 0 ? 'up' : 'down')}>
      {v >= 0 ? '▲' : '▼'} {Math.abs(v).toFixed(1).replace('.', ',')}% vs. anterior
    </div>
  );

  return (
    <div className="shell">
      <window.TopBar title={c.loja} user={user} role={role} onBack={onBack} onLogout={onLogout} onManageUsers={onManageUsers} />
      <div className="page">
        <div className="page-inner">

          <div className="hh">
            <div className="hh-id">
              <div className="crumb"><span onClick={onBack} style={{ cursor: 'pointer' }}>Clientes</span> / Histórico</div>
              <h1>
                {c.loja}
                <window.StatusTag status={c.status} encerrado={c.encerrado} />
              </h1>
              <div className="meta">
                <span style={{ color: window.mkColor(conta.marketplace), fontWeight: 700 }}>{contaLabel(conta, idx)}</span>
                <span>Analista · <b>{c.analista}</b></span>
                <span>{c.contas.length} {c.contas.length === 1 ? 'marketplace' : 'marketplaces'}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><I.cal size={14} /> Envio · <b>{window.agendaLabel(c.agenda).toLowerCase()}</b></span>
                {conta.dataEntrada ? <span>Entrada · <b>{window.brShort(conta.dataEntrada)}</b></span> : null}
                {conta.ativo === false ? <span style={{ color: 'var(--muted)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><span className="d" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--muted)' }}></span>Encerrado{conta.dataEncerramento ? <> · {window.brShort(conta.dataEncerramento)}</> : null}</span> : null}
              </div>
            </div>
            <div className="hh-actions">
              {canManage ? <button className="btn-line" onClick={onEdit}><I.edit size={16} /> Editar</button> : null}
              {canManage ? <button className="btn-line" onClick={() => importInputRef.current && importInputRef.current.click()}><I.upload size={16} /> Importar</button> : null}
              <input ref={importInputRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportFile} />
              <button className="btn-line" onClick={gerarRelatorioAtual} title="Gera o PDF com todo o histórico desta conta">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></svg>
                Gerar PDF
              </button>
              {canManage ? <button className="btn-accent" onClick={novoRelatorio}><I.bolt size={16} /> Novo relatório</button> : null}
            </div>
          </div>

          <div className="dash-no-break" style={{ background: 'var(--paper, #fff)', border: '1px solid var(--line, #e9ece9)', borderRadius: 14, padding: '14px 18px', marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <b style={{ fontSize: 13.5 }}>Observações do cliente</b>
              {canManage ? <button className="btn-line no-print" style={{ padding: '6px 11px', fontSize: 12.5 }} onClick={onEdit}><I.edit size={14} /> Editar</button> : null}
            </div>
            {(c.observacoes || '').trim()
              ? <p style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>{c.observacoes}</p>
              : <span style={{ color: 'var(--muted)', fontSize: 13 }}>Sem observações.{canManage ? ' Use "Editar" para adicionar.' : ''}</span>}
          </div>

          {multi
            ? (
              <div className="mk-tabs">
                {c.contas.map((m, i) => (
                  <button key={m.id} className={'mk-tab' + (i === idx ? ' on' : '') + (m.ativo === false ? ' is-closed' : '')} onClick={() => setIdx(i)}
                          style={i === idx ? { borderColor: window.mkColor(m.marketplace), color: window.mkColor(m.marketplace) } : null}>
                    <span className="d" style={{ background: m.ativo === false ? 'var(--muted)' : (m.status === 'atrasado' ? 'var(--red)' : window.mkBrand(m.marketplace)) }}></span>
                    {contaLabel(m, i)}
                    <span className="mk-tab-n">{m.reports.length}</span>
                  </button>
                ))}
              </div>
            )
            : null}

          <div className="kpis">
            <div className="kpi">
              <div className="k">Relatórios</div>
              <div className="v">{reports.length}</div>
              <div className="trend" style={{ color: 'var(--muted)' }}>{conta.marketplace}</div>
            </div>
            <div className="kpi">
              <div className="k">ROAS atual</div>
              <div className="v">{String(last.roas).replace('.', ',')}<small>x</small></div>
              <Trend v={roasDelta} />
            </div>
            <div className="kpi">
              <div className="k">Faturamento último</div>
              <div className="v">{window.fmtMoney(last.faturamento)}</div>
              <Trend v={fatDelta} />
            </div>
            <div className="kpi">
              <div className="k">Faturamento acumulado</div>
              <div className="v">{window.fmtMoneyShort(totalFat)}</div>
              <div className="trend" style={{ color: 'var(--muted)' }}>{reports.length} períodos</div>
            </div>
          </div>

          <MetricsExplorer reports={reports} conta={conta} />

          <div className="sec-head">
            <h2>Relatórios</h2>
            <span className="mono">{reports.length} registros</span>
          </div>

          <div className="rtable">
            <div className="rrow head">
              <span>Período</span>
              <span style={{ textAlign: 'right' }}>Faturamento</span>
              <span style={{ textAlign: 'right' }}>ROAS</span>
              <span className="col-hide" style={{ textAlign: 'right' }}>ACOS</span>
              <span className="col-hide" style={{ textAlign: 'right' }}>TACOS</span>
              <span className="col-hide">Status</span>
              <span className="col-hide">Marketplace</span>
              <span style={{ textAlign: 'right' }}>Ações</span>
            </div>
            {reports.map((r) => (
              <div className="rrow" key={r.id}>
                <div className="per">
                  {window.brRange(r.periodoIni, r.periodoFim)}
                  <span className="mono">criado {window.brShort(r.criadoEm)}</span>
                </div>
                <div className="num">{window.fmtMoney(r.faturamento)}</div>
                <div className="num" style={{ color: r.ok ? 'var(--green-ink)' : 'var(--red)' }}>{String(r.roas).replace('.', ',')}x</div>
                <div className="num col-hide">{String(r.acos).replace('.', ',')}<small>%</small></div>
                <div className="num col-hide">{String(r.tacos).replace('.', ',')}<small>%</small></div>
                <div className="col-hide"><window.StatusTag status={r.ok ? 'em-dia' : 'atrasado'} /></div>
                <div className="col-hide" style={{ fontSize: 11.5, fontWeight: 600, color: window.mkColor(conta.marketplace) }}>{conta.marketplace}</div>
                <div className="r-actions">
                  <button className="iconbtn" onClick={() => abrirRelatorio(r)} title="Abrir"><I.open /></button>
                  <button className="iconbtn" onClick={() => exportarRelatorio(r)} title="Exportar (.json)">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></svg>
                  </button>
                  {canManage ? <button className="iconbtn" title="Duplicar (novo período a partir deste)" onClick={() => duplicarRelatorio(r)}><I.copy /></button> : null}
                  {isAdmin ? <button className="iconbtn danger" title="Excluir" onClick={() => excluirRelatorio(r)}><I.trash /></button> : null}
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

window.History = History;
