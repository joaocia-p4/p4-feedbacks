/* P4 — Report (A4). Core sheet + multi-period comparison sheet (table + line charts). */

// resolve an asset URL: blob from the standalone bundler if present, else relative path
function assetUrl(id, path) {
  return (typeof window !== 'undefined' && window.__resources && window.__resources[id]) || path;
}

// ---------- metric definitions (shared) ----------
const METRIC_DEFS = [
  { k: 'faturamento', label: 'Faturamento', full: 'Faturamento Total', prefix: 'R$', dir: 'up' },
  { k: 'vendas', label: 'Vendas', full: 'Vendas Totais', suffix: 'ped.', dir: 'up' },
  { k: 'receitaAds', label: 'Receita Ads', full: 'Receita via Ads', prefix: 'R$', dir: 'up' },
  { k: 'vendasAds', label: 'Vendas Ads', full: 'Vendas via Ads', suffix: 'ped.', dir: 'up' },
  { k: 'investimento', label: 'Investimento', full: 'Investimento', prefix: 'R$', dir: 'neutral' },
  { k: 'roas', label: 'ROAS', full: 'ROAS', suffix: 'x', dir: 'up' },
  { k: 'acos', label: 'ACOS', full: 'ACOS', suffix: '%', dir: 'down', calc: true },
  { k: 'tacos', label: 'TACOS', full: 'TACOS', suffix: '%', dir: 'down', calc: true },
];

// ---------- helpers ----------
function parseNum(s) {
  if (s === null || s === undefined) return 0;
  const n = parseFloat(String(s).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function brl(s) { const v = String(s ?? '').trim(); return v === '' ? '—' : 'R$ ' + v; }
function fmtDate(iso) {
  if (!iso) return '—';
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  return `${p[2]}/${p[1]}/${p[0]}`;
}
function shortDate(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  return `${p[2]}/${p[1]}`;
}
function dateRange(ini, fim) {
  if (ini && fim) return `${shortDate(ini)}–${shortDate(fim)}`;
  if (ini) return shortDate(ini);
  return '';
}
function pctOf(part, whole) { const w = parseNum(whole); return w ? Math.round((parseNum(part) / w) * 100) : 0; }

// ---------- auto-calculated indicators ----------
// ACOS  = investimento / receita via Ads  · TACOS = investimento / faturamento total
function calcAcos(o) { const inv = parseNum(o.investimento), rec = parseNum(o.receitaAds); return rec > 0 ? (inv / rec) * 100 : null; }
function calcTacos(o) { const inv = parseNum(o.investimento), fat = parseNum(o.faturamento); return fat > 0 ? (inv / fat) * 100 : null; }
// ROAS = receita via Ads / investimento
function calcRoas(o) { const inv = parseNum(o.investimento), rec = parseNum(o.receitaAds); return inv > 0 ? rec / inv : null; }
function fmtCalc(n) { return n == null ? '' : n.toFixed(2).replace('.', ','); }
// is a derived metric (roas/acos/tacos) in automatic mode? (default: yes)
function metricIsAuto(o, k) { const f = o[k + 'Auto']; return f === undefined ? true : !!f; }
// returns a copy of a period with roas/acos/tacos replaced by their computed values where auto is on
function withCalc(o) {
  const out = { ...o };
  if (metricIsAuto(o, 'roas')) { const r = calcRoas(o); if (r != null) out.roas = fmtCalc(r); }
  if (metricIsAuto(o, 'acos')) { const a = calcAcos(o); out.acos = a == null ? '' : fmtCalc(a); }
  if (metricIsAuto(o, 'tacos')) { const t = calcTacos(o); out.tacos = t == null ? '' : fmtCalc(t); }
  return out;
}
// most recent previous period, with acos/tacos computed
function prevPeriod(d) { return (Array.isArray(d.prev) && d.prev.length) ? withCalc(d.prev[0]) : null; }
// effective state of a metric: 'pos' (green) | 'neg' (red) | 'neu' (black).
// Always driven by the manual status toggle (no automatic coloring from the comparison).
function metricState(d, k) {
  const st = d.status && d.status[k];
  return st === 'neg' ? 'neg' : st === 'neutral' ? 'neu' : 'pos';
}
// status-driven class for a value display
function valCls(d, k) { if (isEmpty(d[k])) return ''; const s = metricState(d, k); return s === 'neg' ? ' neg' : s === 'neu' ? ' neu' : ' pos'; }

// auto-shrink a value so a long number (e.g. >100 mil) keeps "R$" on the same line
function FitText({ text, className }) {
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.fontSize = '';
    let guard = 0;
    while (el.scrollWidth > el.clientWidth + 1 && guard < 40) {
      const base = parseFloat(getComputedStyle(el).fontSize);
      if (base <= 12) break;
      el.style.fontSize = (base - 1) + 'px';
      guard++;
    }
  });
  return <span ref={ref} className={className} style={{ whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '100%' }}>{text}</span>;
}
function neg(d, k) { return metricState(d, k) === 'neg'; }
function hasPrev(d) { return Array.isArray(d.prev) && d.prev.length > 0; }
function isEmpty(v) { return v === undefined || v === null || String(v).trim() === ''; }

function fmtMetric(v, m) {
  if (isEmpty(v)) return '—';
  const s = String(v).trim();
  if (m.prefix === 'R$') return 'R$ ' + s;
  if (m.suffix === 'x') return s + 'x';
  if (m.suffix === '%') return s + '%';
  return s;
}
function pctChange(cur, prev) {
  if (isEmpty(cur)) return null;
  const c = parseNum(cur), p = parseNum(prev);
  if (!p) return null;
  return ((c - p) / p) * 100;
}
// chronological series: oldest → current (current always last)
function buildSeries(d) {
  let arr = (d.prev || []).map((p) => ({ ...withCalc(p), current: false })).reverse();
  const wc = withCalc(d);
  const cur = { current: true, preP4: !!d.preP4, periodoIni: d.periodoIni, periodoFim: d.periodoFim, label: 'Atual' };
  METRIC_DEFS.forEach((m) => (cur[m.k] = wc[m.k]));
  arr.push(cur);
  if (arr.length > 1 && arr.every((s) => s.periodoIni)) {
    arr = arr.slice().sort((a, b) => new Date(a.periodoIni) - new Date(b.periodoIni));
  }
  return arr;
}
function periodLabel(s, i) {
  return dateRange(s.periodoIni, s.periodoFim) || s.label || ('P' + (i + 1));
}

// ---------- small viz ----------
function Trend({ state, down }) {
  const s = state || (down ? 'neg' : 'pos');
  if (s === 'neu') return <span className="trend is-neu">–</span>;
  return <span className={'trend ' + (s === 'neg' ? 'is-neg' : 'is-pos')}>{s === 'neg' ? '▾' : '▴'}</span>;
}

// growth/reduction % vs. the most recent previous period, for an individual card
function CmpDelta({ d, k, share, center }) {
  const prev = prevPeriod(d);
  if (!prev) return null;
  let pc, dir;
  if (share) {
    const cur = pctOf(d.receitaAds, d.faturamento);
    const pre = pctOf(prev.receitaAds, prev.faturamento);
    if (!pre) return null;
    pc = ((cur - pre) / pre) * 100; dir = 'neutral';
  } else {
    const m = METRIC_DEFS.find((x) => x.k === k);
    pc = pctChange(d[k], prev[k]); dir = m ? m.dir : 'neutral';
  }
  if (pc === null) return null;
  return <span className={'cmp-delta' + (center ? ' center' : '')}><DeltaChip pc={pc} dir={dir} plain /> <i>vs. anterior</i></span>;
}

function DeltaChip({ pc, dir, plain }) {
  if (pc === null) return <span className={'dchip muted' + (plain ? ' plain' : '')}>—</span>;
  const r = Math.round(pc);
  const arrow = r > 0 ? '▲' : r < 0 ? '▾' : '–';
  let cls = 'muted';
  if (r !== 0 && dir !== 'neutral') cls = ((dir === 'up') === (r > 0)) ? 'good' : 'bad';
  return <span className={'dchip ' + cls + (plain ? ' plain' : '')}>{arrow} {Math.abs(r)}%</span>;
}

function HeroDelta({ d, light }) {
  if (!hasPrev(d)) return null;
  const pc = pctChange(d.faturamento, d.prev[0].faturamento);
  if (pc === null) return null;
  const up = Math.round(pc) >= 0;
  return (
    <span className={'hdelta ' + (up ? 'up' : 'down') + (light ? ' on-light' : '')}>
      {up ? '▲' : '▼'} {Math.abs(Math.round(pc))}% <i>vs. período anterior</i>
    </span>
  );
}

function Ring({ value, max, meta, state, isNeg, label, sub }) {
  const s = state || (isNeg ? 'neg' : 'pos');
  // ring fills completely when the value reaches `max` (50% for ACOS/TACOS)
  const pct = Math.max(0, Math.min(100, (parseNum(value) / max) * 100));
  const color = s === 'neg' ? 'var(--red)' : s === 'neu' ? 'var(--ink)' : 'var(--accent)';
  const hasMeta = !isEmpty(meta) && parseNum(meta) > 0;
  const mDeg = hasMeta ? Math.min(360, (parseNum(meta) / max) * 360) : 0;
  return (
    <div className="ring-wrap">
      <div className="ring" style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, var(--track) 0)` }}>
        {hasMeta ? <span className="ring-tick" style={{ transform: `translateX(-50%) rotate(${mDeg}deg)` }}></span> : null}
        <div className="ring-hole"><span className={'ring-val' + (s === 'neg' ? ' neg' : '')}>{value || '—'}<i>{sub}</i></span></div>
      </div>
      <span className="ring-label">{label} <Trend state={s} /></span>
    </div>
  );
}

function Bar({ value, max, target, state, isNeg }) {
  const s = state || (isNeg ? 'neg' : 'pos');
  const fill = s === 'neg' ? 'var(--red)' : s === 'neu' ? 'var(--ink)' : 'var(--accent)';
  const pct = Math.max(2, Math.min(100, (parseNum(value) / max) * 100));
  const showT = target != null && parseNum(target) > 0;
  const tp = showT ? Math.max(0, Math.min(100, (parseNum(target) / max) * 100)) : 0;
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: pct + '%', background: fill }}></div>
      {showT ? <div className="bar-target" style={{ left: tp + '%' }}></div> : null}
    </div>
  );
}

function Kicker({ children }) { return <div className="kicker">{children}</div>; }

// ---------- line chart (per metric, across periods) ----------
function MiniLineChart({ series, m, chartStyle }) {
  const style = chartStyle || 'area';
  const W = 300, H = 92, padX = 10, padT = 14, padB = 16;
  const pts = series.map((s, i) => ({ i, v: isEmpty(s[m.k]) ? null : parseNum(s[m.k]), cur: s.current, pre: !!s.preP4 }));
  const present = pts.filter((p) => p.v !== null);
  if (present.length === 0) return <div className="chart-empty">sem dados</div>;
  let min = Math.min(...present.map((p) => p.v));
  let max = Math.max(...present.map((p) => p.v));
  if (min === max) { const pad = Math.abs(min) * 0.15 || 1; min -= pad; max += pad; }
  const n = series.length;
  const xOf = (i) => n === 1 ? W / 2 : padX + (i / (n - 1)) * (W - padX * 2);
  const yOf = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const coords = present.map((p) => [xOf(p.i), yOf(p.v)]);
  // color by latest change
  let cls = 'neutral';
  if (present.length > 1 && m.dir !== 'neutral') {
    const last = present[present.length - 1].v, prev = present[present.length - 2].v;
    if (last !== prev) cls = ((m.dir === 'up') === (last > prev)) ? 'good' : 'bad';
  }
  const stroke = cls === 'good' ? 'var(--accent-ink)' : 'var(--ink)';
  const lastP = present[present.length - 1];
  const base = (H - padB).toFixed(1);

  // build line + area path per style
  let linePath = '', areaPath = '';
  if (coords.length > 1) {
    if (style === 'step') {
      linePath = `M${coords[0][0].toFixed(1)},${coords[0][1].toFixed(1)}`;
      for (let i = 1; i < coords.length; i++) linePath += ` H${coords[i][0].toFixed(1)} V${coords[i][1].toFixed(1)}`;
      areaPath = `M${coords[0][0].toFixed(1)},${base} V${coords[0][1].toFixed(1)}` +
        coords.slice(1).map((c) => ` H${c[0].toFixed(1)} V${c[1].toFixed(1)}`).join('') +
        ` V${base} Z`;
    } else {
      linePath = 'M' + coords.map((c) => c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' L');
      areaPath = `M${coords[0][0].toFixed(1)},${base} L` + coords.map((c) => c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' L') + ` L${coords[coords.length - 1][0].toFixed(1)},${base} Z`;
    }
  }
  const showArea = style !== 'line';
  const sw = style === 'line' ? 3 : 2.5;

  // "entrada na P4" boundary: shade the pre-P4 zone + dashed divider
  let dividerX = null;
  const preIdxs = series.map((s, i) => (s.preP4 ? i : -1)).filter((i) => i >= 0);
  const postIdxs = series.map((s, i) => (!s.preP4 ? i : -1)).filter((i) => i >= 0);
  if (preIdxs.length && postIdxs.length) {
    const lastPre = Math.max.apply(null, preIdxs);
    const after = postIdxs.filter((i) => i > lastPre);
    if (after.length) dividerX = (xOf(lastPre) + xOf(Math.min.apply(null, after))) / 2;
  }

  return (
    <svg className="lchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {dividerX != null ? <rect x="0" y="0" width={dividerX.toFixed(1)} height={H} fill="var(--ink)" opacity="0.06" /> : null}
      <line x1="0" y1={H - padB} x2={W} y2={H - padB} className="lc-base" />
      {showArea && areaPath ? <path d={areaPath} fill={stroke} opacity="0.08" /> : null}
      {linePath ? <path d={linePath} fill="none" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" /> : null}
      {dividerX != null ? <line x1={dividerX.toFixed(1)} y1="1" x2={dividerX.toFixed(1)} y2={H - padB} stroke="var(--ink)" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.5" /> : null}
      {present.map((p, k) => (
        <circle key={k} cx={xOf(p.i)} cy={yOf(p.v)} r={p === lastP ? 4 : 2.6} fill={p.pre ? '#fff' : (p === lastP ? stroke : '#fff')} stroke={p.pre ? 'var(--muted)' : stroke} strokeWidth="2" />
      ))}
    </svg>
  );
}

// ---------- comparison table (periods as rows, with per-metric deltas) ----------
function CompareTable({ series }) {
  return (
    <table className="cmp">
      <thead>
        <tr>
          <th className="mh">Período</th>
          {METRIC_DEFS.map((m) => <th key={m.k}>{m.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {series.map((s, i) => {
          const prev = i > 0 ? series[i - 1] : null;
          return (
            <tr key={i} className={(s.current ? 'cur' : '') + (s.preP4 ? ' pre' : '')}>
              <td className="plabel">{periodLabel(s, i)}{s.preP4 ? <span className="pre-tag">pré-P4</span> : null}{s.current ? <span className="cur-tag">Atual</span> : null}</td>
              {METRIC_DEFS.map((m) => {
                const pc = prev ? pctChange(s[m.k], prev[m.k]) : null;
                return (
                  <td key={m.k}>
                    <span className="cval">{fmtMetric(s[m.k], m)}</span>
                    {prev ? <span className="cdelta"><DeltaChip pc={pc} dir={m.dir} plain /></span> : <span className="cdelta cdelta-base">base</span>}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ChartsGrid({ series, chartStyle }) {
  return (
    <div className="charts">
      {METRIC_DEFS.map((m) => {
        const present = series.filter((s) => !isEmpty(s[m.k]));
        const cur = series[series.length - 1];
        const prevPresent = present.length > 1 ? present[present.length - 2] : null;
        const pc = prevPresent ? pctChange(cur[m.k], prevPresent[m.k]) : null;
        return (
          <div className="chart" key={m.k}>
            <div className="chart-head">
              <span className="chart-name">{m.full}</span>
              <span className="chart-now">{fmtMetric(cur[m.k], m)} <DeltaChip pc={pc} dir={m.dir} plain /></span>
            </div>
            <MiniLineChart series={series} m={m} chartStyle={chartStyle} />
          </div>
        );
      })}
    </div>
  );
}

// shrink the comparison-page content so it always fits exactly ONE A4 sheet,
// no matter how many periods are added (otherwise it spills onto a 2nd page).
function useFitToPage(fitRef, deps) {
  React.useLayoutEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;

    const fit = () => {
      // reset to natural state to measure
      el.style.transform = 'none';
      el.style.width = '100%';
      const cs = getComputedStyle(parent);
      const avail = parent.clientHeight
        - parseFloat(cs.paddingTop || 0)
        - parseFloat(cs.paddingBottom || 0);
      if (avail <= 0) return;
      el.style.minHeight = avail + 'px';
      const natural = el.scrollHeight;
      if (natural > avail + 0.5) {
        const scale = avail / natural;
        el.style.transformOrigin = 'top left';
        el.style.width = (100 / scale) + '%';
        el.style.transform = 'scale(' + scale + ')';
      } else {
        el.style.transform = 'none';
        el.style.width = '100%';
      }
    };

    fit();
    // re-fit after fonts/layout settle, on resize, and around printing
    const raf = requestAnimationFrame(fit);
    const t = setTimeout(fit, 250);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    window.addEventListener('resize', fit);
    window.addEventListener('beforeprint', fit);
    // density / chart-style tweaks toggle classes on <html> — re-fit when they do
    const mo = new MutationObserver(fit);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener('resize', fit);
      window.removeEventListener('beforeprint', fit);
      mo.disconnect();
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------- comparison page (shared) ----------
// one A4 sheet of comparison content, auto-fitted to a single page
function CmpSheet({ variant, fitKey, children }) {
  const fitRef = React.useRef(null);
  useFitToPage(fitRef, [fitKey, variant]);
  return (
    <div className={'sheet fixed cmp-page cmp-' + variant}>
      <div className="cmp-fit" ref={fitRef}>{children}</div>
    </div>
  );
}

// above this many periods, the charts move to their own page instead of
// shrinking everything to share one sheet with the table
const CMP_SPLIT_OVER = 8;

function ComparePage({ d, variant }) {
  const series = buildSeries(d);
  const split = series.length > CMP_SPLIT_OVER;
  const hasPre = series.some((s) => s.preP4);
  const fitKey = series.length + '|' + (d._chartStyle || '') + '|' + (d.marketplace || '');

  const head = (
    <div className="cmp-page-head">
      <img src={assetUrl('p4mark', 'assets/p4-mark.png')} alt="P4" className="cmp-mark" />
      <div>
        <Kicker>Comparativo de Períodos</Kicker>
        <h2 className="cmp-title">{d.marketplace || '—'} · Evolução</h2>
      </div>
      <span className="cmp-count">{series.length} períodos</span>
    </div>
  );
  const foot = (
    <footer className="cmp-foot">
      <span>Método P4 · Performance que move o seu negócio</span>
      <span>metodop4.com.br</span>
    </footer>
  );
  const tableBlock = (
    <React.Fragment>
      <div className="cmp-sec-head">Tabela comparativa{hasPre ? <span className="pre-legend">pré-P4 = antes da entrada na P4</span> : null}</div>
      <CompareTable series={series} />
    </React.Fragment>
  );
  const chartsBlock = (
    <React.Fragment>
      <div className="cmp-sec-head charts-head">Evolução por indicador{hasPre ? <span className="pre-legend"><i className="pre-swatch"></i>zona antes da P4</span> : null}</div>
      <ChartsGrid series={series} chartStyle={d._chartStyle} />
    </React.Fragment>
  );

  if (!split) {
    return (
      <CmpSheet variant={variant} fitKey={fitKey}>
        {head}
        {tableBlock}
        {chartsBlock}
        {foot}
      </CmpSheet>
    );
  }

  // 9+ periods → table on its own page, all charts together on the next page
  return (
    <React.Fragment>
      <CmpSheet variant={variant} fitKey={fitKey + '-t'}>
        {head}
        {tableBlock}
        {foot}
      </CmpSheet>
      <CmpSheet variant={variant} fitKey={fitKey + '-c'}>
        {head}
        {chartsBlock}
        {foot}
      </CmpSheet>
    </React.Fragment>
  );
}

// ---------- campaigns page (shared) ----------
// Tabela própria das campanhas de Ads, numa folha auto-ajustada (igual ao comparativo).
function CampaignsPage({ d, variant }) {
  const rows = (d.campanhas || []).filter((c) => String(c.nome || '').trim() || String(c.investimento || '').trim());
  if (!rows.length) return null;
  const meta = d.campanhasMeta || {};
  const cmp = meta.comparadoCom;
  const removidas = (meta.removidas || []).filter((r) => String(r.nome || '').trim());
  const cell = (v, unit) => {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '—';
    return unit === 'R$' ? 'R$ ' + s : unit === '%' ? s + '%' : unit === 'x' ? s + 'x' : s;
  };
  const total = rows.reduce((a, c) => a + parseNum(c.investimento), 0);
  const novas = rows.filter((c) => c.novo).length;
  const fitKey = rows.length + '|' + (cmp ? 'c' : '') + '|' + removidas.length + '|' + (d.marketplace || '');
  return (
    <CmpSheet variant={variant} fitKey={fitKey}>
      <div className="cmp-page-head">
        <img src={assetUrl('p4mark', 'assets/p4-mark.png')} alt="P4" className="cmp-mark" />
        <div>
          <Kicker>Campanhas de Ads</Kicker>
          <h2 className="cmp-title">{d.marketplace || '—'} · Campanhas</h2>
        </div>
        <span className="cmp-count">{rows.length} ativa{rows.length === 1 ? '' : 's'}{novas ? ` · ${novas} nova${novas === 1 ? '' : 's'}` : ''}</span>
      </div>
      {cmp ? <div className="camp-cmp">Comparado com o período anterior · {shortDate(cmp.periodoIni)}–{shortDate(cmp.periodoFim)}</div> : null}
      <table className="camp-doc">
        <thead>
          <tr><th className="camp-doc-l">Campanha</th><th>ROAS obj.</th><th>Orçamento</th><th>Investimento</th><th>ROAS</th></tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={i} className={c.novo ? 'camp-row-new' : ''}>
              <td className="camp-doc-l">
                <span className="camp-nm">{c.nome || '—'}{c.novo ? <span className="camp-tag">Nova</span> : null}</span>
                {(c.mudancas && c.mudancas.length) ? <span className="camp-chg-doc">{c.mudancas.join(' · ')}</span> : null}
              </td>
              <td>{cell(c.roasObjetivo, 'x')}</td>
              <td>{cell(c.orcamento, 'R$')}</td>
              <td>{cell(c.investimento, 'R$')}</td>
              <td>{cell(c.roas, 'x')}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td className="camp-doc-l">Total investido</td><td></td><td></td><td>{'R$ ' + total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td></td></tr>
        </tfoot>
      </table>
      {removidas.length ? <div className="camp-rem">Pausadas/removidas neste período: {removidas.map((r) => r.nome).join(', ')}</div> : null}
      <footer className="cmp-foot">
        <span>Método P4 · Performance que move o seu negócio</span>
        <span>metodop4.com.br</span>
      </footer>
    </CmpSheet>
  );
}

// split observation text into page-sized chunks by measuring, so long notes
// paginate into separate sheets instead of being sliced at the page fold
function splitObs(text, measurer, firstMax, contMax) {
  const tokens = text.split(/(\s+)/);
  const pages = [];
  let i = 0, max = firstMax;
  while (i < tokens.length) {
    let buf = '', j = i;
    while (j < tokens.length) {
      measurer.textContent = buf + tokens[j];
      if (measurer.offsetHeight > max && buf.replace(/\s/g, '') !== '') break;
      buf += tokens[j]; j++;
    }
    if (j === i) { buf = tokens[i]; j = i + 1; }
    pages.push(buf);
    i = j; max = contMax;
  }
  return pages.length ? pages : [''];
}

// ---------- LAYOUT A — Clássico ----------
function ReportA({ d }) {
  d = withCalc(d);
  const pctAds = pctOf(d.receitaAds, d.faturamento);
  const invMeta = parseNum(d.metaInvestimento);
  const invPct = invMeta > 0 ? Math.min(100, (parseNum(d.investimento) / invMeta) * 100) : 0;
  const imgs = d.obsImages || [];
  const obsText = (d.obs && d.obs.trim()) ? d.obs : '';
  const reportRef = React.useRef(null);
  const obsBodyRef = React.useRef(null);
  const measureRef = React.useRef(null);
  const [obsPages, setObsPages] = React.useState(obsText ? [obsText] : ['']);
  React.useLayoutEffect(() => {
    if (!obsText) { setObsPages(['']); return; }
    const measurer = measureRef.current, body = obsBodyRef.current;
    if (!measurer || !body) return;
    const recompute = () => {
      measurer.style.width = body.offsetWidth + 'px';
      const PAGE_H = 1123;
      const bodyTop = body.offsetTop;
      const avail = Math.max(300, PAGE_H - bodyTop - 30 - 50 - 20);
      const pages = splitObs(obsText, measurer, avail, avail);
      setObsPages((prev) => (prev.length === pages.length && prev.every((x, i) => x === pages[i])) ? prev : pages);
    };
    recompute();
    const raf = requestAnimationFrame(recompute);
    const t = setTimeout(recompute, 250);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(recompute);
    const mo = new MutationObserver(recompute);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => { cancelAnimationFrame(raf); clearTimeout(t); mo.disconnect(); };
  }, [obsText]);
  const multiObs = obsPages.length > 1;
  const raFooter = (
    <footer className="ra-foot">
      <span className="ra-foot-mid">Método P4 · Performance que move o seu negócio</span>
      <span>metodop4.com.br</span>
    </footer>
  );
  const obsImgsEl = imgs.length ? <div className="ra-notes-imgs">{imgs.map((s, i) => <img key={i} src={s} alt={'Print ' + (i + 1)} />)}</div> : null;
  const raHeader = (
    <header className="ra-head">
      <div className="ra-head-l">
        <img src={assetUrl('p4mark', 'assets/p4-mark.png')} alt="P4" className="ra-mark" />
        <div>
          <Kicker>Relatório {d.periodicidade || 'Semanal'} de Performance</Kicker>
          <h1 className="ra-title">{d.marketplace || '—'}</h1>
        </div>
      </div>
      <div className="ra-period">
        <span className="ra-period-cap">Período</span>
        <span className="ra-period-val">{fmtDate(d.periodoIni)} <em>—</em> {fmtDate(d.periodoFim)}</span>
      </div>
    </header>
  );
  return (
    <React.Fragment>
      <div className="sheet flow report-a" ref={reportRef}>
        {raHeader}

        <div className="ra-meta">
          {d.loja ? <span><b>{d.lojaTipo || 'Loja'}</b>{d.loja}</span> : null}
          <span><b>Preparado por</b>{d.analista || '—'}</span>
        </div>

        <section className="ra-sec">
          <div className="ra-sec-head"><span className="dot"></span>Resumo Financeiro</div>
          <div className="ra-fin">
            <div className={'ra-hero-stat' + (neg(d, 'faturamento') ? ' is-neg' : '')}>
              <span className="rhs-cap">Faturamento Total <Trend state={metricState(d, 'faturamento')} /></span>
              <FitText className="rhs-val" text={brl(d.faturamento)} />
              <span className="rhs-sub">{d.vendas || '0'} pedidos no período</span>
              <HeroDelta d={d} />
            </div>
            <div className="ra-fin-grid">
              <div className="mini">
                <span className="mini-cap">Receita via Ads <Trend state={metricState(d, 'receitaAds')} /></span>
                <FitText className={'mini-val' + valCls(d, 'receitaAds')} text={brl(d.receitaAds)} />
                <CmpDelta d={d} k="receitaAds" />
              </div>
              <div className="mini">
                <span className="mini-cap">Vendas via Ads <Trend state={metricState(d, 'vendasAds')} /></span>
                <span className={'mini-val' + valCls(d, 'vendasAds')}>{d.vendasAds || '0'} <i>pedidos</i></span>
                <CmpDelta d={d} k="vendasAds" />
              </div>
              <div className="mini mini-accent">
                <span className="mini-cap">Faturamento via Ads</span>
                <span className="mini-val">{pctAds}<i>%</i></span>
                <div className="mini-bar"><span style={{ width: pctAds + '%' }}></span></div>
                <CmpDelta d={d} share />
              </div>
            </div>
          </div>
        </section>

        <section className="ra-sec">
          <div className="ra-sec-head"><span className="dot"></span>Indicadores de Eficiência <em>· Ads</em></div>
          <div className="ra-ind">
            <div className="ind-card">
              <span className="ind-cap">Investimento <Trend state={metricState(d, 'investimento')} /></span>
              <FitText className={'ind-val' + valCls(d, 'investimento')} text={brl(d.investimento)} />
              {invMeta > 0 ? <div className={'mini-bar' + (metricState(d, 'investimento') === 'neg' ? ' is-neg' : metricState(d, 'investimento') === 'neu' ? ' is-neu' : '')}><span style={{ width: invPct + '%' }}></span></div> : null}
              <div className="ind-bottom">
                <CmpDelta d={d} k="investimento" />
                <span className="ind-note">{invMeta > 0 ? 'Meta: R$ ' + d.metaInvestimento + ' · investimento em Ads' : 'Verba aplicada em anúncios'}</span>
              </div>
            </div>
            <div className="ind-card ind-roas">
              <span className="ind-cap">ROAS <Trend state={metricState(d, 'roas')} /></span>
              <span className={'ind-val' + valCls(d, 'roas')}>{d.roas || '—'}<i>x</i></span>
              <Bar value={d.roas} max={50} target={!isEmpty(d.metaRoas) ? d.metaRoas : null} state={metricState(d, 'roas')} />
              <div className="ind-bottom">
                <CmpDelta d={d} k="roas" />
                <span className="ind-note">{!isEmpty(d.metaRoas) ? 'Meta ' + d.metaRoas + 'x · retorno sobre Ads' : 'Retorno sobre investimento'}</span>
              </div>
            </div>
            <div className="ind-card ind-ring">
              <Ring value={d.acos} max={50} meta={d.metaAcos} state={metricState(d, 'acos')} label="ACOS" sub="%" />
              <div className="ind-bottom">
                <CmpDelta d={d} k="acos" center />
                <span className="ind-note">{!isEmpty(d.metaAcos) ? 'Meta ≤ ' + d.metaAcos + '% · custo sobre Ads' : 'Custo sobre vendas de Ads'}</span>
              </div>
            </div>
            <div className="ind-card ind-ring">
              <Ring value={d.tacos} max={50} meta={d.metaTacos} state={metricState(d, 'tacos')} label="TACOS" sub="%" />
              <div className="ind-bottom">
                <CmpDelta d={d} k="tacos" center />
                <span className="ind-note">{!isEmpty(d.metaTacos) ? 'Meta ≤ ' + d.metaTacos + '% · sobre faturamento' : 'Custo sobre faturamento total'}</span>
              </div>
            </div>
          </div>
        </section>

        <div ref={measureRef} aria-hidden="true" className="ra-notes-body obs-measure" style={{ position: 'absolute', left: '-9999px', top: 0, visibility: 'hidden', pointerEvents: 'none', minHeight: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}></div>

        {raFooter}
      </div>

      {(obsText || imgs.length) ? obsPages.map((chunk, idx, arr) => {
        const last = idx === arr.length - 1;
        const multi = arr.length > 1;
        return (
          <div className="sheet flow obs-cont" key={idx}>
            {raHeader}
            <div className="ra-sec-head"><span className="dot"></span>Observações{multi ? <em> ({idx + 1}/{arr.length})</em> : null}</div>
            <div className="ra-notes-body" ref={idx === 0 ? obsBodyRef : null}>
              {chunk ? <p className="ra-notes-text">{chunk}</p> : null}
              {last ? obsImgsEl : null}
            </div>
            {raFooter}
          </div>
        );
      }) : null}

      <CampaignsPage d={d} variant="a" />
      {hasPrev(d) ? <ComparePage d={d} variant="a" /> : null}
    </React.Fragment>
  );
}

// ---------- LAYOUT B — Destaque ----------
function ReportB({ d }) {
  d = withCalc(d);
  const pctAds = pctOf(d.receitaAds, d.faturamento);
  const acosW = Math.min(100, parseNum(d.acos) * 2);
  const tacosW = Math.min(100, parseNum(d.tacos) * 2);
  return (
    <React.Fragment>
      <div className="sheet fixed report-b">
        <header className="rb-hero">
          <div className="rb-glow"></div>
          <div className="rb-hero-top">
            <img src={assetUrl('p4markWhite', 'assets/p4-mark-white.png')} alt="P4" className="rb-mark" />
            <div className="rb-period">
              <span>Período</span>
              <strong>{fmtDate(d.periodoIni)} — {fmtDate(d.periodoFim)}</strong>
            </div>
          </div>
          <Kicker>Relatório {d.periodicidade || 'Semanal'} de Performance · {d.marketplace || '—'}</Kicker>
          <div className="rb-hero-main">
            <span className="rb-hero-cap">Faturamento Total <Trend down={neg(d, 'faturamento')} /></span>
            <span className={'rb-hero-val' + (neg(d, 'faturamento') ? ' neg' : '')}>{brl(d.faturamento)}</span>
            <div className="rb-hero-tags">
              <span><b>{d.vendas || '0'}</b> pedidos</span>
              <span className="sep"></span>
              <span><b>{pctAds}%</b> via Ads</span>
              <span className="sep"></span>
              <span><b>{d.analista || '—'}</b></span>
              <HeroDelta d={d} light />
            </div>
          </div>
        </header>

        <section className="rb-block">
          <div className="rb-block-head">Resumo Financeiro</div>
          <div className="rb-fin">
            <div className="rbf">
              <span className="rbf-cap">Vendas Totais <Trend down={neg(d, 'vendas')} /></span>
              <span className={'rbf-val' + (neg(d, 'vendas') ? ' neg' : '')}>{d.vendas || '0'}<i>pedidos</i></span>
            </div>
            <div className="rbf">
              <span className="rbf-cap">Receita via Ads <Trend down={neg(d, 'receitaAds')} /></span>
              <span className={'rbf-val' + (neg(d, 'receitaAds') ? ' neg' : '')}>{brl(d.receitaAds)}</span>
            </div>
            <div className="rbf">
              <span className="rbf-cap">Vendas via Ads <Trend down={neg(d, 'vendasAds')} /></span>
              <span className={'rbf-val' + (neg(d, 'vendasAds') ? ' neg' : '')}>{d.vendasAds || '0'}<i>pedidos</i></span>
            </div>
          </div>
        </section>

        <section className="rb-block">
          <div className="rb-block-head">Indicadores de Eficiência <em>· Ads</em></div>
          <div className="rb-ind">
            <div className="rbi">
              <span className="rbi-cap">Investimento <Trend down={neg(d, 'investimento')} /></span>
              <span className={'rbi-val' + (neg(d, 'investimento') ? ' neg' : '')}>{brl(d.investimento)}</span>
            </div>
            <div className={'rbi rbi-hl' + (neg(d, 'roas') ? ' is-neg' : '')}>
              <span className="rbi-cap">ROAS <Trend down={neg(d, 'roas')} /></span>
              <span className="rbi-val">{d.roas || '—'}<i>x</i></span>
              <Bar value={d.roas} max={10} target={parseNum(d.metaRoas) || 4} isNeg={neg(d, 'roas')} />
            </div>
            <div className="rbi">
              <span className="rbi-cap">ACOS <Trend down={neg(d, 'acos')} /></span>
              <span className={'rbi-val' + (neg(d, 'acos') ? ' neg' : '')}>{d.acos || '—'}<i>%</i></span>
              <div className={'mini-bar' + (neg(d, 'acos') ? ' is-neg' : '')}><span style={{ width: acosW + '%' }}></span></div>
            </div>
            <div className="rbi">
              <span className="rbi-cap">TACOS <Trend down={neg(d, 'tacos')} /></span>
              <span className={'rbi-val' + (neg(d, 'tacos') ? ' neg' : '')}>{d.tacos || '—'}<i>%</i></span>
              <div className={'mini-bar' + (neg(d, 'tacos') ? ' is-neg' : '')}><span style={{ width: tacosW + '%' }}></span></div>
            </div>
          </div>
        </section>

        <section className="rb-notes">
          <span className="rbn-cap">Observações</span>
          <p>{d.obs || 'Sem observações para este período.'}</p>
        </section>

        <footer className="rb-foot">
          <span>metodop4.com.br</span>
          <span>Método P4</span>
        </footer>
      </div>

      <CampaignsPage d={d} variant="b" />
      {hasPrev(d) ? <ComparePage d={d} variant="b" /> : null}
    </React.Fragment>
  );
}

Object.assign(window, { ReportA, ReportB, parseNum, METRIC_DEFS, assetUrl, calcAcos, calcTacos, calcRoas, fmtCalc, withCalc, metricIsAuto });
