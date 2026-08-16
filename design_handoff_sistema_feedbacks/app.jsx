/* P4 — Gerador de Relatório (app shell). */
const { useState, useEffect, useRef, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#56D54F",
  "density": "padrao",
  "chartStyle": "area"
}/*EDITMODE-END*/;

// hex → "r,g,b"
function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// readable dark version of an accent for text/strokes on white paper
function readableInk(hex) {
  let [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const dlt = max - min;
    s = l > 0.5 ? dlt / (2 - max - min) : dlt / (max + min);
    if (max === r) hue = ((g - b) / dlt + (g < b ? 6 : 0));
    else if (max === g) hue = (b - r) / dlt + 2;
    else hue = (r - g) / dlt + 4;
    hue /= 6;
  }
  const L = Math.min(l, 0.36), S = Math.min(1, s * 1.05);
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const to = (t) => Math.round(hue2rgb(p, q, t) * 255).toString(16).padStart(2, '0');
  return '#' + to(hue + 1 / 3) + to(hue) + to(hue - 1 / 3);
}

const METRIC_KEYS = ['faturamento', 'vendas', 'receitaAds', 'vendasAds', 'investimento', 'roas', 'acos', 'tacos'];

// Filtros das campanhas no relatório (por relatório, salvos no payload). O seletor
// "Filtrar por" + chips é só uma camada de UI sobre estes três campos.
const CAMP_FILTRO_DEFAULT = { investMin: '', roasMin: '', soNovas: false };
const CAMP_FILTRO_DIMS = [
  { key: 'investMin', label: 'Investimento mínimo', money: true, chip: (v) => `Invest ≥ R$ ${v}` },
  { key: 'roasMin', label: 'ROAS mínimo', money: false, chip: (v) => `ROAS ≥ ${v}x` },
  { key: 'soNovas', label: 'Só novas/alteradas', bool: true, chip: () => 'Só novas/alteradas' },
];
// Ordenação das campanhas no relatório (default: ROAS maior → menor).
const CAMP_ORDEM_DEFAULT = 'roasDesc';
const CAMP_ORDEM_OPTS = [
  { key: 'roasDesc', label: 'ROAS (maior → menor)' },
  { key: 'roasAsc', label: 'ROAS (menor → maior)' },
  { key: 'investDesc', label: 'Investimento (maior → menor)' },
  { key: 'investAsc', label: 'Investimento (menor → maior)' },
  { key: 'fatDesc', label: 'Faturamento (maior → menor)' },
  { key: 'nome', label: 'Nome (A → Z)' },
];

// BRL input mask — treats typed digits as cents → "1.234,56"
function maskBRL(v) {
  let s = String(v).replace(/\D/g, '');
  if (!s) return '';
  s = s.replace(/^0+(?=\d)/, '');
  while (s.length < 3) s = '0' + s;
  const cents = s.slice(-2);
  const int = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return int + ',' + cents;
}

// downscale a pasted/uploaded print before storing it as a data URL
function resizeImage(file, cb) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const maxW = 1100;
    let w = img.width, h = img.height;
    if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    try { cb(c.toDataURL('image/jpeg', 0.72)); } catch (e) {}
  };
  img.src = url;
}

const DEFAULTS = {
  marketplace: 'Mercado Livre',
  analista: 'Ingrid e Renan',
  loja: '',
  lojaTipo: 'Loja',
  periodicidade: 'Semanal',
  roasAuto: true,
  acosAuto: true,
  tacosAuto: true,
  periodoIni: '2026-05-07',
  periodoFim: '2026-05-14',
  faturamento: '123,00',
  vendas: '3',
  receitaAds: '89,00',
  vendasAds: '2',
  investimento: '17,62',
  roas: '5,02',
  acos: '19,91',
  tacos: '14,32',
  // metas vêm SEMPRE do cadastro do cliente (ctx.metas); nunca hardcoded aqui
  metaInvestimento: '',
  metaRoas: '',
  metaAcos: '',
  metaTacos: '',
  obs: '',
  obsImages: [],
  status: METRIC_KEYS.reduce((a, k) => (a[k] = 'pos', a), {}),
  campanhasFiltro: { investMin: '', roasMin: '', soNovas: false },
  campanhasOrdem: 'roasDesc',
  prev: [
    { label: '', periodoIni: '2026-04-30', periodoFim: '2026-05-06', faturamento: '98,00', vendas: '2', receitaAds: '71,00', vendasAds: '2', investimento: '15,40', roas: '4,61', acos: '21,69', tacos: '15,71' },
    { label: '', periodoIni: '2026-04-23', periodoFim: '2026-04-29', faturamento: '84,00', vendas: '2', receitaAds: '60,00', vendasAds: '1', investimento: '14,10', roas: '4,26', acos: '23,50', tacos: '16,79' },
  ],
};

function blankPeriod() {
  return { label: '', periodoIni: '', periodoFim: '', faturamento: '', vendas: '', receitaAds: '', vendasAds: '', investimento: '', roas: '', acos: '', tacos: '' };
}

function isoDate(dt) { return dt.toISOString().slice(0, 10); }

// ---- Observações em blocos (texto/imagem) ----
function newId() { return 'b' + Math.random().toString(36).slice(2, 9); }
function makeTextBlock(html) { return { id: newId(), type: 'text', html: html || '' }; }
function makeImageBlock(src, widthPct) { return { id: newId(), type: 'image', src, widthPct: widthPct == null ? 100 : widthPct }; }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function obsTextToHtml(text) {
  const paras = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paras.map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>').join('');
}
function obsToBlocks(obs, obsImages) {
  const blocks = [];
  const html = obsTextToHtml(obs);
  if (html) blocks.push(makeTextBlock(html));
  (obsImages || []).forEach((src) => { if (src) blocks.push(makeImageBlock(src, 100)); });
  return blocks;
}
function blocksToPlainText(blocks) {
  return (blocks || [])
    .filter((b) => b.type === 'text')
    .map((b) => String(b.html || '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim())
    .filter(Boolean).join('\n\n');
}
// só adiciona obsBlocks quando ausente (relatório antigo) — não sobrescreve
function ensureObsBlocks(d) {
  if (Array.isArray(d.obsBlocks)) return d;
  return { ...d, obsBlocks: obsToBlocks(d.obs, d.obsImages) };
}

// turn an imported report into the most-recent "previous period" of a fresh report,
// carrying identification + metas and advancing the period forward by one interval
function rollForward(imp) {
  const carry = ['faturamento', 'vendas', 'receitaAds', 'vendasAds', 'investimento', 'roas', 'acos', 'tacos'];
  const newPrev = { label: '', periodoIni: imp.periodoIni || '', periodoFim: imp.periodoFim || '' };
  carry.forEach((k) => (newPrev[k] = imp[k] || ''));
  let nIni = '', nFim = '';
  if (imp.periodoFim) {
    const fim = new Date(imp.periodoFim + 'T00:00:00');
    const ini = imp.periodoIni ? new Date(imp.periodoIni + 'T00:00:00') : null;
    const len = ini ? Math.max(0, Math.round((fim - ini) / 86400000)) : 6;
    const ns = new Date(fim); ns.setDate(ns.getDate() + 1);
    const ne = new Date(ns); ne.setDate(ne.getDate() + len);
    nIni = isoDate(ns); nFim = isoDate(ne);
  }
  return {
    ...EMPTY,
    marketplace: imp.marketplace || '', analista: imp.analista || '', loja: imp.loja || '', lojaTipo: imp.lojaTipo || 'Loja',
    periodicidade: imp.periodicidade || 'Semanal', roasAuto: imp.roasAuto !== false,
    acosAuto: imp.acosAuto !== false, tacosAuto: imp.tacosAuto !== false,
    metaInvestimento: imp.metaInvestimento || '', metaRoas: imp.metaRoas || '',
    metaAcos: imp.metaAcos || '', metaTacos: imp.metaTacos || '',
    periodoIni: nIni, periodoFim: nFim,
    status: { ...EMPTY.status, ...(imp.status || {}) },
    campanhasFiltro: imp.campanhasFiltro || CAMP_FILTRO_DEFAULT,
    campanhasOrdem: imp.campanhasOrdem || CAMP_ORDEM_DEFAULT,
    prev: [newPrev, ...(imp.prev || [])],
  };
}
// restore a saved report exactly as it was
function fullRestore(imp) {
  return { ...EMPTY, ...imp, status: { ...EMPTY.status, ...(imp.status || {}) }, prev: imp.prev || [], obsImages: imp.obsImages || [] };
}

const EMPTY = {
  marketplace: '',
  analista: '',
  loja: '',
  lojaTipo: 'Loja',
  periodicidade: 'Semanal',
  roasAuto: true,
  acosAuto: true,
  tacosAuto: true,
  periodoIni: '',
  periodoFim: '',
  faturamento: '',
  vendas: '',
  receitaAds: '',
  vendasAds: '',
  investimento: '',
  roas: '',
  acos: '',
  tacos: '',
  // metas vêm SEMPRE do cadastro do cliente (ctx.metas); nunca hardcoded aqui
  metaInvestimento: '',
  metaRoas: '',
  metaAcos: '',
  metaTacos: '',
  obs: '',
  obsImages: [],
  status: METRIC_KEYS.reduce((a, k) => (a[k] = 'pos', a), {}),
  campanhasFiltro: { investMin: '', roasMin: '', soNovas: false },
  campanhasOrdem: 'roasDesc',
  prev: [],
};

function ToneToggle({ value, onChange }) {
  return (
    <span className="tone" role="group" aria-label="Status da métrica">
      <button type="button" className={'tone-btn pos' + (value === 'pos' ? ' on' : '')} onClick={() => onChange('pos')} title="Positiva">▲</button>
      <button type="button" className={'tone-btn neu' + (value === 'neutral' ? ' on' : '')} onClick={() => onChange('neutral')} title="Neutra">–</button>
      <button type="button" className={'tone-btn neg' + (value === 'neg' ? ' on' : '')} onClick={() => onChange('neg')} title="Negativa">▼</button>
    </span>
  );
}

// ===== Custom date picker (replaces the un-styleable native calendar) =====
const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS_PT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
function parseIso(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null; }
function dateToIso(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }
function fmtBR(iso) { const p = parseIso(iso); return p ? `${String(p.d).padStart(2, '0')}/${String(p.mo + 1).padStart(2, '0')}/${p.y}` : ''; }
function CalIcon() {
  return (
    <svg className="cal-ico" width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.6" width="11" height="9.9" rx="2" stroke="currentColor" strokeWidth="1.2"></rect>
      <line x1="1.5" y1="5.4" x2="12.5" y2="5.4" stroke="currentColor" strokeWidth="1.2"></line>
      <line x1="4.6" y1="1" x2="4.6" y2="3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"></line>
      <line x1="9.4" y1="1" x2="9.4" y2="3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"></line>
    </svg>
  );
}

// ----- date RANGE picker (start + end together, Mercado Livre style) -----
function CalendarRangePanel({ draft, onPickDay, onApply, onClear, canApply }) {
  const today = new Date();
  const [view, setView] = useState(() => ({ y: today.getFullYear(), mo: today.getMonth() }));
  const go = (delta) => setView((v) => { let mo = v.mo + delta, y = v.y; while (mo < 0) { mo += 12; y--; } while (mo > 11) { mo -= 12; y++; } return { y, mo }; });
  const startDow = new Date(view.y, view.mo, 1).getDay();
  const gridStart = new Date(view.y, view.mo, 1 - startDow);
  const cells = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const todayIso = dateToIso(today);
  const hasRange = draft.start && draft.end && draft.end > draft.start;
  return (
    <div className="cal range">
      <div className="cal-head range">
        <button type="button" className="cal-arrow" onClick={() => go(-1)} aria-label="Mês anterior">‹</button>
        <span className="cal-title">{MONTHS_PT[view.mo].charAt(0).toUpperCase() + MONTHS_PT[view.mo].slice(1)} {view.y}</span>
        <button type="button" className="cal-arrow" onClick={() => go(1)} aria-label="Próximo mês">›</button>
      </div>
      <div className="cal-wd">{WEEKDAYS_PT.map((w, i) => <span key={i}>{w}</span>)}</div>
      <div className="cal-grid">
        {cells.map((dt, i) => {
          const iso = dateToIso(dt);
          const out = dt.getMonth() !== view.mo;
          const isStart = iso === draft.start;
          const isEnd = iso === draft.end;
          const inRange = hasRange && iso > draft.start && iso < draft.end;
          const isToday = iso === todayIso;
          let cls = 'cal-day';
          if (out) cls += ' out';
          if (inRange) cls += ' inrange';
          if (isStart || isEnd) cls += ' sel';
          if (hasRange && isStart) cls += ' rstart';
          if (hasRange && isEnd) cls += ' rend';
          if (isToday && !isStart && !isEnd) cls += ' today';
          return <button type="button" key={i} className={cls} onClick={() => onPickDay(iso)}>{dt.getDate()}</button>;
        })}
      </div>
      <div className="cal-foot range">
        <button type="button" className="cal-link" onClick={onClear}>Limpar</button>
        <button type="button" className="cal-apply" disabled={!canApply} onClick={onApply}>Aplicar</button>
      </div>
    </div>
  );
}
function DateRangeInput({ startValue, endValue, onChange, compact }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ start: startValue || '', end: endValue || '' });
  const trigRef = useRef(null);
  const popRef = useRef(null);
  useEffect(() => { if (open) setDraft({ start: startValue || '', end: endValue || '' }); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (popRef.current && !popRef.current.contains(e.target) && trigRef.current && !trigRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll, true); };
  }, [open]);
  React.useLayoutEffect(() => {
    if (!open || !popRef.current || !trigRef.current) return;
    const t = trigRef.current.getBoundingClientRect();
    const p = popRef.current;
    const pw = p.offsetWidth, ph = p.offsetHeight;
    let left = t.left;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, t.right - pw);
    let top = t.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, t.top - 6 - ph);
    p.style.left = left + 'px'; p.style.top = top + 'px';
  }, [open, draft]);
  const pickDay = (iso) => setDraft((d) => {
    if (!d.start || d.end) return { start: iso, end: '' };
    // second click before the first → treat it as the start (allow picking end→start)
    if (iso < d.start) return { start: iso, end: d.start };
    return { start: d.start, end: iso };
  });
  const apply = () => { if (draft.start) { onChange(draft.start, draft.end || draft.start); setOpen(false); } };
  const disp = (startValue || endValue) ? `${fmtBR(startValue) || '…'} – ${fmtBR(endValue) || '…'}` : '';
  return (
    <div className={'date-wrap' + (compact ? ' compact' : '')}>
      <button type="button" ref={trigRef} className={'date-trigger range' + (open ? ' open' : '') + (disp ? '' : ' empty')} onClick={() => setOpen((o) => !o)}>
        <span className="date-txt">{disp || 'dd/mm/aaaa – dd/mm/aaaa'}</span>
        <CalIcon />
      </button>
      {open ? (
        <div className="cal-pop" ref={popRef}>
          <CalendarRangePanel draft={draft} onPickDay={pickDay} onApply={apply} onClear={() => setDraft({ start: '', end: '' })} canApply={!!draft.start} />
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, hint, value, onChange, prefix, suffix, placeholder, type = 'text', wide, area, tone, onTone, money, numeric, onPaste, options, labelExtra }) {
  const selectAll = (e) => { try { e.target.select(); } catch (_) {} };
  const inputMode = money ? 'decimal' : numeric ? 'decimal' : undefined;
  const listId = React.useMemo(() => options ? 'dl-' + Math.random().toString(36).slice(2) : null, [options ? 1 : 0]);
  const opts = (options || []).filter((o) => o && String(o).trim() !== '');
  return (
    <label className={'field' + (wide ? ' field-wide' : '')}>
      <span className="field-label">
        <span className="fl-txt">{label}{hint ? <i>{hint}</i> : null}{labelExtra || null}</span>
        {tone ? <ToneToggle value={tone} onChange={onTone} /> : null}
      </span>
      <div className={'field-in' + (area ? ' is-area' : '') + (tone === 'neg' ? ' tone-neg' : '')}>
        {prefix ? <span className="affix">{prefix}</span> : null}
        {area
          ? <textarea value={value} placeholder={placeholder} rows="3" onChange={(e) => onChange(e.target.value)} onPaste={onPaste} />
          : <input type={type} value={value} placeholder={placeholder} inputMode={inputMode} list={listId || undefined} onFocus={type === 'date' ? undefined : selectAll} onChange={(e) => onChange(money ? maskBRL(e.target.value) : e.target.value)} />}
        {suffix ? <span className="affix affix-r">{suffix}</span> : null}
      </div>
      {listId && opts.length ? (
        <datalist id={listId}>
          {opts.map((o, i) => <option key={i} value={o} />)}
        </datalist>
      ) : null}
    </label>
  );
}

// read-only display for auto-calculated indicators (ACOS / TACOS)
function CalcField({ label, value, suffix, tone, onTone }) {
  return (
    <label className="field">
      <span className="field-label">
        <span className="fl-txt">{label}</span>
        {tone ? <ToneToggle value={tone} onChange={onTone} /> : null}
      </span>
      <div className="field-in is-calc">
        <span className="calc-auto">auto</span>
        <span className="calc-val">{value}</span>
        {suffix ? <span className="affix affix-r">{suffix}</span> : null}
      </div>
    </label>
  );
}


// ---- "antes da P4" baseline marker ----
function PreToggle({ value, onChange, compact }) {
  return (
    <button type="button" className={'pre-toggle' + (value ? ' on' : '') + (compact ? ' sm' : '')} onClick={() => onChange(!value)}
      title="Marque se este período é anterior à entrada do cliente na P4">
      <span className="pre-box">{value ? '✓' : ''}</span>
      <span>Período antes da entrada na P4</span>
    </button>
  );
}

function rangeDays(ini, fim) {
  if (!ini || !fim) return null;
  const a = new Date(ini + 'T00:00:00'), b = new Date(fim + 'T00:00:00');
  if (isNaN(a) || isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}
function brShort(iso) { if (!iso) return '—'; const p = iso.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : iso; }


// collapsible section wrapper that matches the .grp look
function Section({ title, note, summary, collapsible, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="grp">
      <div className={'grp-title' + (collapsible ? ' is-collap' : '')} onClick={collapsible ? () => setOpen((o) => !o) : undefined}>
        {collapsible ? <span className={'grp-chev' + (open ? ' open' : '')}>▸</span> : null}
        <span className="grp-title-txt">{title}</span>
        {note ? <span className="grp-note">{note}</span> : null}
        {collapsible && !open && summary ? <span className="grp-summary">{summary}</span> : null}
      </div>
      {(!collapsible || open) ? children : null}
    </div>
  );
}


// Dropdown customizado (mesma mecânica/estética do calendário: popup escuro,
// acento verde, clique-fora/Esc). options = [{ value, label }].
function SelectMenu({ value, options, onChange, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const trigRef = useRef(null);
  const popRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (popRef.current && !popRef.current.contains(e.target) && trigRef.current && !trigRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll, true); };
  }, [open]);
  React.useLayoutEffect(() => {
    if (!open || !popRef.current || !trigRef.current) return;
    const t = trigRef.current.getBoundingClientRect();
    const p = popRef.current;
    p.style.minWidth = t.width + 'px';
    const pw = p.offsetWidth, ph = p.offsetHeight;
    let left = t.left;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, t.right - pw);
    let top = t.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, t.top - 6 - ph);
    p.style.left = left + 'px'; p.style.top = top + 'px';
  }, [open]);
  const cur = options.find((o) => o.value === value);
  return (
    <div className="dd">
      <button type="button" ref={trigRef} className={'dd-trigger' + (open ? ' open' : '')} onClick={() => setOpen((o) => !o)} aria-label={ariaLabel}>
        <span className="dd-txt">{cur ? cur.label : '—'}</span>
        <span className="dd-caret">▾</span>
      </button>
      {open ? (
        <div className="dd-pop" ref={popRef}>
          <div className="dd-menu">
            {options.map((o) => (
              <button type="button" key={o.value} className={'dd-opt' + (o.value === value ? ' sel' : '')} onClick={() => { onChange(o.value); setOpen(false); }}>{o.label}</button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function prevTitle(p, index) {
  if (p.periodoIni && p.periodoFim) {
    const a = p.periodoIni.split('-'), b = p.periodoFim.split('-');
    if (a.length === 3 && b.length === 3) return `${a[2]}/${a[1]} – ${b[2]}/${b[1]}`;
  }
  return p.label && p.label.trim() ? p.label : 'Período anterior ' + (index + 1);
}

// derived metrics inside previous-period cards (auto/manual toggle each)
const PREV_DERIVED = [
  { k: 'roas', label: 'ROAS', suffix: 'x', calc: (o) => window.calcRoas(o) },
  { k: 'acos', label: 'ACOS', suffix: '%', calc: (o) => window.calcAcos(o) },
  { k: 'tacos', label: 'TACOS', suffix: '%', calc: (o) => window.calcTacos(o) },
];
const PREV_DERIVED_KEYS = PREV_DERIVED.map((m) => m.k);

function PrevCard({ p, index, onField, onDates, onRemove }) {  const [open, setOpen] = useState(index === 0);
  return (
    <div className={'prev-card' + (open ? ' open' : '')}>
      <div className="prev-head">
        <button type="button" className="prev-toggle" onClick={() => setOpen((o) => !o)} aria-label="Expandir">
          <span className="chev">{open ? '▾' : '▸'}</span>
        </button>
        <span className="prev-title" onClick={() => setOpen((o) => !o)}>{prevTitle(p, index)}</span>
        <button type="button" className="prev-del" onClick={onRemove} title="Remover período">×</button>
      </div>
      {open ? (
        <div className="prev-body">
          <div className="prev-dates single">
            <label className="pfield">
              <span className="pfield-lab">Período (início e fim)</span>
              <DateRangeInput compact startValue={p.periodoIni || ''} endValue={p.periodoFim || ''} onChange={(ini, fim) => onDates(ini, fim)} />
            </label>
          </div>
          <PreToggle compact value={!!p.preP4} onChange={onField('preP4')} />
          <div className="prev-metrics">
            {window.METRIC_DEFS.filter((m) => !PREV_DERIVED_KEYS.includes(m.k)).map((m) => (
              <label className="pfield" key={m.k}>
                <span className="pfield-lab">{m.label}</span>
                <div className="pfield-in">
                  {m.prefix ? <span className="paffix">{m.prefix}</span> : null}
                  <input value={p[m.k] || ''} placeholder="0" onChange={(e) => onField(m.k)(m.prefix === 'R$' ? maskBRL(e.target.value) : e.target.value)} />
                  {m.suffix ? <span className="paffix r">{m.suffix}</span> : null}
                </div>
              </label>
            ))}
          </div>
          <div className="prev-derived">
            {PREV_DERIVED.map((m) => {
              const auto = p[m.k + 'Auto'] !== false;
              const cv = m.calc(p);
              return (
                <label className="pfield" key={m.k}>
                  <span className="pfield-lab">{m.label}
                    <button type="button" className={'auto-pill xs' + (auto ? ' on' : '')} onClick={() => onField(m.k + 'Auto')(!auto)}
                      title={auto ? 'Automático — clique para editar manualmente' : 'Manual — clique para calcular automaticamente'}>{auto ? 'Auto' : 'Manual'}</button>
                  </span>
                  <div className={'pfield-in' + (auto ? ' is-calc' : '')}>
                    {auto
                      ? <span className="pcalc-val">{cv != null ? window.fmtCalc(cv) : '—'}</span>
                      : <input value={p[m.k] || ''} placeholder="0" onChange={(e) => onField(m.k)(e.target.value)} />}
                    {m.suffix ? <span className="paffix r">{m.suffix}</span> : null}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Nome do usuário logado (lido da aba de Telas). "Preparado por" usa sempre este.
function currentUserName() {
  try { const s = localStorage.getItem('p4-shell-user'); if (s) { const u = JSON.parse(s); return (u && u.nome) || ''; } } catch (e) {}
  return '';
}

// Consome (uma vez) o "contexto" deixado pela tela de histórico: vincula este
// relatório a uma conta (cliente + marketplace) e pré-preenche os campos.
function consumeReportContext() {
  let ctx = null;
  try {
    const raw = localStorage.getItem('p4-report-context');
    if (raw) { localStorage.removeItem('p4-report-context'); ctx = JSON.parse(raw); }
  } catch (e) {}

  const me = currentUserName();
  // periodicidade sempre Semanal; ROAS/ACOS/TACOS sempre automáticos.
  const NORM = { periodicidade: 'Semanal', roasAuto: true, acosAuto: true, tacosAuto: true };
  // As metas vêm SEMPRE do cadastro do cliente (ctx.metas), nunca do JSON antigo
  // nem de default hardcoded. Valor verbatim: vazio ("") = sem meta → o indicador
  // correspondente esconde o alvo/nota no relatório.
  const applyMetas = (obj, m) => (!m ? obj : {
    ...obj,
    metaInvestimento: m.metaInvestimento || '',
    metaRoas: m.metaRoas || '',
    metaAcos: m.metaAcos || '',
    metaTacos: m.metaTacos || '',
  });

  // abrir um relatório existente (visualizar/imprimir) — metas atuais do cadastro
  if (ctx && ctx.mode === 'restore' && ctx.restore) {
    return { initialD: applyMetas(fullRestore(ctx.restore), ctx.metas), link: null };
  }

  // novo relatório vinculado a uma conta
  if (ctx && ctx.accId) {
    let initialD;
    if (ctx.last) {
      initialD = rollForward(ctx.last); // continua do último período
    } else {
      initialD = { ...EMPTY, marketplace: ctx.marketplace || '', loja: ctx.loja || '', lojaTipo: ctx.lojaTipo || 'Loja' };
    }
    // metas do cadastro sobrescrevem o que veio do relatório antigo
    initialD = applyMetas({ ...initialD, ...NORM, analista: me || initialD.analista || '' }, ctx.metas);
    return { initialD, link: { accId: ctx.accId, clientId: ctx.clientId, marketplace: ctx.marketplace, loja: ctx.loja } };
  }

  // sem contexto: restaura rascunho local; mantém o vínculo salvo (se houver)
  let initialD = DEFAULTS;
  try {
    const s = localStorage.getItem('p4-report');
    if (s) { const parsed = JSON.parse(s); initialD = { ...DEFAULTS, ...parsed, status: { ...DEFAULTS.status, ...(parsed.status || {}) } }; }
  } catch (e) {}
  initialD = { ...initialD, ...NORM };
  if (me) initialD.analista = me;
  let link = null;
  try { const l = localStorage.getItem('p4-report-link'); if (l) link = JSON.parse(l); } catch (e) {}
  return { initialD, link };
}

// Campo somente leitura (marketplace, loja, preparado por — vêm do cliente/usuário).
function StaticField({ label, value, wide }) {
  return (
    <label className={'field' + (wide ? ' field-wide' : '')}>
      <span className="field-label"><span className="fl-txt">{label}</span></span>
      <div className="field-in" style={{ opacity: 0.9 }}>
        <input value={value} readOnly tabIndex={-1} style={{ cursor: 'default' }} />
      </div>
    </label>
  );
}

// Card de campanha (no painel). Recolhida = linha densa com resumo tabular
// (ROAS colorido vs. objetivo · investimento · ACOS); expandida = card com o grid
// de edição. A primeira nasce aberta; as demais, recolhidas.
function CampCard({ c, index, field, onRemove, acosTxt, tacosTxt }) {
  const [open, setOpen] = useState(index === 0);
  const roasNum = window.campRoasNum(c);
  const roasStr = roasNum > 0 ? roasNum.toFixed(2).replace('.', ',') + 'x' : '—';
  const objNum = window.parseNum(c.roasObjetivo);
  // verde se bate/supera o ROAS objetivo, vermelho se abaixo; neutro sem objetivo
  const roasTone = (objNum > 0 && roasNum > 0) ? (roasNum >= objNum ? ' good' : ' bad') : '';
  const invStr = (c.investimento && String(c.investimento).trim()) ? 'R$ ' + String(c.investimento).trim() : '—';
  const stop = (e) => e.stopPropagation();
  const eyeOn = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
  );
  const eyeOff = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><path d="m2 2 20 20" /></svg>
  );
  return (
    <div className={'camp-card' + (c.novo ? ' is-new' : '') + (open ? ' open' : '') + (c.oculta ? ' hidden' : '')}>
      <div className="camp-row" onClick={() => setOpen((o) => !o)}>
        <span className={'camp-chev' + (open ? ' open' : '')}>▶</span>
        {open
          ? <input className="camp-nm-in" placeholder="Nome da campanha" value={c.nome || ''} onClick={stop} onChange={(e) => field('nome')(e.target.value)} />
          : <span className={'camp-nm-txt' + (c.nome ? '' : ' empty')}>{c.nome || 'Sem nome'}</span>}
        {c.novo ? <span className="camp-badge">Nova</span> : null}
        {c.oculta ? <span className="camp-hidden-tag">oculta</span> : null}
        {!open ? (
          <span className="camp-strip">
            <span className={'cs-m' + roasTone}>ROAS<b>{roasStr}</b></span>
            <span className="cs-m">Inv<b>{invStr}</b></span>
            <span className="cs-m">ACOS<b>{acosTxt(c)}</b></span>
          </span>
        ) : null}
        <button type="button" className={'camp-hide' + (c.oculta ? ' on' : '')} onClick={(e) => { stop(e); field('oculta')(!c.oculta); }} title={c.oculta ? 'Exibir no PDF' : 'Não exibir no PDF'} aria-label={c.oculta ? 'Exibir no PDF' : 'Não exibir no PDF'}>{c.oculta ? eyeOff : eyeOn}</button>
        <button type="button" className="camp-del" onClick={(e) => { stop(e); onRemove(); }} title="Remover campanha (apaga o registro)">×</button>
      </div>
      {open ? (
        <div className="camp-body">
          <div className="camp-grid">
            <div className="camp-f"><label>ROAS obj.</label><input value={c.roasObjetivo || ''} onChange={(e) => field('roasObjetivo')(e.target.value)} /></div>
            <div className="camp-f"><label>Orçamento R$</label><input value={c.orcamento || ''} onChange={(e) => field('orcamento')(e.target.value)} /></div>
            <div className="camp-f"><label>Invest. R$</label><input value={c.investimento || ''} onChange={(e) => field('investimento')(e.target.value)} /></div>
            <div className="camp-f"><label>Fatur. R$</label><input value={c.faturamento || ''} onChange={(e) => field('faturamento')(e.target.value)} /></div>
            <div className="camp-f"><label>ROAS</label><div className="camp-ro" title="Faturamento ÷ investimento da campanha">{roasStr}</div></div>
            <div className="camp-f"><label>ACOS</label><div className="camp-ro" title="Investimento ÷ faturamento da campanha">{acosTxt(c)}</div></div>
            <div className="camp-f"><label>TACOS</label><div className="camp-ro" title="Investimento ÷ faturamento total da loja">{tacosTxt(c)}</div></div>
          </div>
          {(c.mudancas && c.mudancas.length) ? <div className="camp-chg">{c.mudancas.map((m, j) => <span key={j}>{m}</span>)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// Bloco de texto: contentEditable NÃO-controlado. O conteúdo inicial é escrito UMA
// vez (via initial.current, que nunca muda → React não reescreve o DOM a cada tecla,
// evitando o cursor "pular"). Mudanças externas só são sincronizadas quando o bloco
// NÃO está focado.
function TextBlock({ block, onHtml, onFocusBlock, onPasteImages }) {
  const ref = useRef(null);
  const initial = useRef(block.html || '');
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (document.activeElement !== el && el.innerHTML !== (block.html || '')) {
      el.innerHTML = block.html || '';
    }
  }, [block.html]);
  return (
    <div
      ref={ref}
      className="ob-text"
      contentEditable
      suppressContentEditableWarning
      dangerouslySetInnerHTML={{ __html: initial.current }}
      onFocus={() => onFocusBlock(block.id)}
      onInput={(e) => onHtml(e.currentTarget.innerHTML)}
      data-empty={!block.html ? '1' : undefined}
      onPaste={(e) => {
        if (!onPasteImages) return;
        const items = (e.clipboardData && e.clipboardData.items) || [];
        const imgs = [];
        for (const it of items) { if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) imgs.push(f); } }
        if (imgs.length) { e.preventDefault(); onPasteImages(imgs, block.id); }
      }}
    />
  );
}

// Editor de observações por blocos (usado no form e no modal maximizado).
function ObsEditor({ blocks, onChange, large, onAddImages, onMaximize, maximized }) {
  const list = blocks || [];
  const [focusId, setFocusId] = useState(null);
  const update = (id, patch) => onChange(list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (id, dir) => {
    const i = list.findIndex((b) => b.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const arr = list.slice(); const [x] = arr.splice(i, 1); arr.splice(j, 0, x); onChange(arr);
  };
  const remove = (id) => onChange(list.filter((b) => b.id !== id));
  const addText = () => onChange([...list, makeTextBlock('')]);
  const toolBtn = (cmd, label, title) => (
    <button type="button" className="ob-tool" title={title}
      onMouseDown={(e) => { e.preventDefault(); document.execCommand(cmd, false, null); }}>{label}</button>
  );
  return (
    <div className={'ob-editor' + (large ? ' ob-large' : '')}>
      <div className="ob-toolbar">
        {toolBtn('bold', <b>B</b>, 'Negrito')}
        {toolBtn('italic', <i>I</i>, 'Itálico')}
        {toolBtn('insertUnorderedList', '•', 'Lista')}
        <span className="ob-tool-sep" />
        <button type="button" className="ob-tool" onMouseDown={(e) => e.preventDefault()} onClick={addText}>+ Texto</button>
        {onAddImages ? (
          <label className="ob-tool" title="Adicionar imagem">+ Imagem
            <input type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={(e) => { onAddImages(e.target.files, focusId); e.target.value = ''; }} />
          </label>
        ) : null}
        {onMaximize ? <button type="button" className="ob-tool ob-max" onClick={onMaximize} title={maximized ? 'Fechar' : 'Maximizar'} aria-label={maximized ? 'Fechar' : 'Maximizar'}>{maximized ? '✕' : '⤢'}</button> : null}
      </div>
      <div className="ob-blocks">
        {list.length === 0 ? <div className="ob-empty" onClick={addText}>Clique para escrever ou cole um print…</div> : null}
        {list.map((b, i) => (
          <div className={'ob-block ob-' + b.type + (focusId === b.id ? ' focus' : '')} key={b.id}>
            <div className="ob-block-bar">
              <span className="ob-block-tag">{b.type === 'image' ? 'Imagem' : 'Texto'}</span>
              <button type="button" className="ob-mini" title="Mover para cima" disabled={i === 0} onClick={() => move(b.id, -1)}>↑</button>
              <button type="button" className="ob-mini" title="Mover para baixo" disabled={i === list.length - 1} onClick={() => move(b.id, 1)}>↓</button>
              <button type="button" className="ob-mini ob-del" title="Remover" onClick={() => remove(b.id)}>✕</button>
            </div>
            {b.type === 'text'
              ? <TextBlock block={b} onHtml={(html) => update(b.id, { html })} onFocusBlock={setFocusId} onPasteImages={onAddImages} />
              : (
                <div className="ob-imgwrap">
                  <img className="ob-img" src={b.src} alt="" />
                  <div className="ob-imgctl">
                    {[['P', 35], ['M', 60], ['G', 85], ['Cheia', 100]].map(([lab, w]) => (
                      <button type="button" key={w} className={'ob-size' + ((b.widthPct || 100) === w ? ' on' : '')} onClick={() => update(b.id, { widthPct: w })}>{lab}</button>
                    ))}
                    <input className="ob-slider" type="range" min="15" max="100" value={b.widthPct || 100}
                      onChange={(e) => update(b.id, { widthPct: Math.max(15, Math.min(100, parseInt(e.target.value, 10) || 100)) })} />
                    <span className="ob-pct">{b.widthPct || 100}%</span>
                  </div>
                </div>
              )}
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const bootRef = useRef(null);
  if (bootRef.current === null) bootRef.current = consumeReportContext();
  const [d, setD] = useState(() => ensureObsBlocks(bootRef.current.initialD));
  const [link] = useState(() => bootRef.current.link);
  const [mlBusy, setMlBusy] = useState(false);
  const [mlMsg, setMlMsg] = useState(null);
  const [campBusy, setCampBusy] = useState(false);
  const [campMsg, setCampMsg] = useState(null);
  const [savingApi, setSavingApi] = useState(false);
  const [apiMsg, setApiMsg] = useState(null);
  // keep comparison periods ordered by date automatically (most recent first)
  const prevSortKey = (d.prev || []).map((x) => (x.periodoFim || x.periodoIni || '')).join('|');
  useEffect(() => {
    setD((p) => {
      const arr = p.prev || [];
      if (arr.length < 2) return p;
      const sorted = [...arr].sort((a, b) => (b.periodoFim || b.periodoIni || '').localeCompare(a.periodoFim || a.periodoIni || ''));
      for (let i = 0; i < arr.length; i++) { if (arr[i] !== sorted[i]) return { ...p, prev: sorted }; }
      return p;
    });
  }, [prevSortKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [scale, setScale] = useState(1);
  const stageRef = useRef(null);
  const bodyRef = useRef(null);

  // Enter advances to the next field for fast keyboard entry
  const onFlowKey = useCallback((e) => {
    if (e.key !== 'Enter') return;
    const tag = e.target.tagName;
    if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return;
    const root = bodyRef.current; if (!root) return;
    const items = Array.from(root.querySelectorAll('input:not([type=file]), select')).filter((el) => !el.disabled && el.offsetParent !== null);
    const i = items.indexOf(e.target);
    if (i > -1 && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
  }, []);

  // apply accent tweak → CSS vars on :root
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-ink', readableInk(t.accent));
    root.style.setProperty('--accent-rgb', hexToRgb(t.accent).join(','));
  }, [t.accent]);

  const set = useCallback((k) => (v) => setD((p) => ({ ...p, [k]: v })), []);
  const setTone = useCallback((k) => (v) => setD((p) => ({ ...p, status: { ...p.status, [k]: v } })), []);
  // observações em blocos — grava obsBlocks + espelho de texto puro em obs
  const setObsBlocks = useCallback((blocks) => setD((p) => ({ ...p, obsBlocks: blocks, obs: blocksToPlainText(blocks) })), []);
  const [obsMax, setObsMax] = useState(false);
  useEffect(() => {
    if (!obsMax) return;
    const onKey = (e) => { if (e.key === 'Escape') setObsMax(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [obsMax]);
  const addPrev = () => setD((p) => ({ ...p, prev: [...(p.prev || []), blankPeriod((p.prev || []).length + 1)] }));
  const removePrev = (i) => setD((p) => ({ ...p, prev: (p.prev || []).filter((_, j) => j !== i) }));
  const prevField = (i) => (k) => (v) => setD((p) => { const arr = [...(p.prev || [])]; arr[i] = { ...arr[i], [k]: v }; return { ...p, prev: arr }; });
  // campanhas (tabela própria, fora das observações)
  const addCampanha = () => setD((p) => ({ ...p, campanhas: [...(p.campanhas || []), { nome: '', roasObjetivo: '', orcamento: '', investimento: '', faturamento: '', roas: '' }] }));
  const removeCampanha = (i) => setD((p) => ({ ...p, campanhas: (p.campanhas || []).filter((_, j) => j !== i) }));
  const campField = (i) => (k) => (v) => setD((p) => { const arr = [...(p.campanhas || [])]; arr[i] = { ...arr[i], [k]: v }; return { ...p, campanhas: arr }; });
  // ACOS e TACOS por campanha são derivados (ACOS = invest/faturamento; TACOS = invest/faturamento total) → read-only
  const campAcosTxt = (c) => {
    const inv = window.parseNum(c.investimento), fat = window.parseNum(c.faturamento);
    if (fat > 0) return ((inv / fat) * 100).toFixed(1).replace('.', ',') + '%';
    const r = window.parseNum(c.roas); return r > 0 ? (100 / r).toFixed(1).replace('.', ',') + '%' : '—';
  };
  const campTacosTxt = (c) => { const t = window.calcTacos({ investimento: c.investimento, faturamento: d.faturamento }); return t == null ? '—' : t.toFixed(1).replace('.', ',') + '%'; };
  // filtros das campanhas no relatório (seletor "Filtrar por" + chips) — camada de UI
  // sobre d.campanhasFiltro { investMin, roasMin, soNovas }
  const campFiltro = d.campanhasFiltro || CAMP_FILTRO_DEFAULT;
  const setCampFiltro = (k) => (v) => setD((p) => ({ ...p, campanhasFiltro: { ...(p.campanhasFiltro || CAMP_FILTRO_DEFAULT), [k]: v } }));
  const [filtroDim, setFiltroDim] = useState('investMin');
  const [filtroVal, setFiltroVal] = useState('');
  const filtroDimMeta = CAMP_FILTRO_DIMS.find((x) => x.key === filtroDim) || CAMP_FILTRO_DIMS[0];
  const onFiltroDim = (k) => { setFiltroDim(k); const dm = CAMP_FILTRO_DIMS.find((x) => x.key === k); setFiltroVal(dm && dm.bool ? '' : (campFiltro[k] || '')); };
  const addFiltro = () => {
    if (filtroDimMeta.bool) { setCampFiltro('soNovas')(true); return; }
    if (window.parseNum(filtroVal) > 0) { setCampFiltro(filtroDimMeta.key)(filtroVal); setFiltroVal(''); }
  };
  const removeFiltro = (key) => setCampFiltro(key)(key === 'soNovas' ? false : '');
  const filtrosAtivos = CAMP_FILTRO_DIMS.filter((x) => (x.bool ? campFiltro.soNovas : window.parseNum(campFiltro[x.key]) > 0));
  const campComConteudo = (d.campanhas || []).filter((c) => window.campanhaTemConteudo(c));
  const campOcultas = campComConteudo.length - campComConteudo.filter((c) => window.campanhaPassaFiltro(c, campFiltro)).length;
  // update a period's dates and auto-reorder the list (most recent first)
  const prevDates = (i) => (ini, fim) => setD((p) => {
    const arr = [...(p.prev || [])];
    arr[i] = { ...arr[i], periodoIni: ini, periodoFim: fim };
    arr.sort((a, b) => (b.periodoFim || b.periodoIni || '').localeCompare(a.periodoFim || a.periodoIni || ''));
    return { ...p, prev: arr };
  });

  // adiciona imagens como blocos de observação (após o bloco focado, senão no fim)
  const addObsImages = (files, afterId) => {
    Array.from(files || []).filter((f) => f.type && f.type.startsWith('image/')).forEach((f) => {
      resizeImage(f, (url) => setD((p) => {
        const arr = (p.obsBlocks || []).slice();
        const idx = afterId ? arr.findIndex((b) => b.id === afterId) : -1;
        const block = makeImageBlock(url, 100);
        if (idx >= 0) arr.splice(idx + 1, 0, block); else arr.push(block);
        return { ...p, obsBlocks: arr, obs: blocksToPlainText(arr) };
      }));
    });
  };

  useEffect(() => { try { localStorage.setItem('p4-report', JSON.stringify(d)); } catch (e) {} }, [d]);
  useEffect(() => { try { link ? localStorage.setItem('p4-report-link', JSON.stringify(link)) : localStorage.removeItem('p4-report-link'); } catch (e) {} }, [link]);

  // remembered store/client names — typed once, selectable afterwards
  const [, setLojas] = useState(() => {
    try { return JSON.parse(localStorage.getItem('p4-lojas') || '[]'); } catch (e) { return []; }
  });
  useEffect(() => {
    const name = (d.loja || '').trim();
    if (!name) return;
    setLojas((prev) => {
      if (prev.some((x) => x.toLowerCase() === name.toLowerCase())) return prev;
      const next = [name, ...prev].slice(0, 50);
      try { localStorage.setItem('p4-lojas', JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }, [d.loja]);

  useEffect(() => {
    function fit() {
      const el = stageRef.current; if (!el) return;
      const availW = el.clientWidth - 64;
      const s = Math.min(availW / 794, 1.05);
      setScale(s > 0 ? s : 1);
    }
    fit();
    const ro = new ResizeObserver(fit);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);

  const print = async () => {
    // Baixar PDF salva no sistema automaticamente (quando vinculado e logado).
    if (link && loggedIn) { try { await saveToSystem(); } catch (e) {} }
    document.body.classList.add('printing');
    setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove('printing'), 300); }, 60);
  };

  const reset = () => {
    if (confirm('Limpar os números do período atual? Os períodos anteriores (comparativo) são mantidos.')) {
      setD((p) => ({ ...EMPTY, marketplace: p.marketplace, loja: p.loja, lojaTipo: p.lojaTipo, analista: p.analista, metaInvestimento: p.metaInvestimento, metaRoas: p.metaRoas, metaAcos: p.metaAcos, metaTacos: p.metaTacos, campanhasFiltro: p.campanhasFiltro || CAMP_FILTRO_DEFAULT, campanhasOrdem: p.campanhasOrdem || CAMP_ORDEM_DEFAULT, obsBlocks: [], prev: p.prev || [] }));
      setApiMsg(null);
    }
  };

  // ROAS/ACOS/TACOS são sempre automáticos — normaliza caso venham manuais.
  useEffect(() => {
    if (d.roasAuto === false || d.acosAuto === false || d.tacosAuto === false) {
      setD((p) => ({ ...p, roasAuto: true, acosAuto: true, tacosAuto: true }));
    }
  }, [d.roasAuto, d.acosAuto, d.tacosAuto]);

  // salvar este relatório no backend (na conta vinculada)
  const loggedIn = !!(window.P4_API && window.P4_API.isLogged());

  // Puxar os números do período direto do Mercado Livre (Pedidos + Ads).
  const canPullMeli = !!(link && loggedIn && link.marketplace === 'Mercado Livre');

  // Reputação da conta ML — buscada só quando a conta está CONECTADA. Congela em
  // d.reputacao (entra no payload salvo), então o PDF mostra a reputação de quando
  // foi gerado. Conta não conectada / erro → mantém o que houver; sem reputacao a
  // seção some do relatório.
  useEffect(() => {
    if (!canPullMeli || !window.P4_API) return;
    let cancel = false;
    window.P4_API.meliReputation(link.accId)
      .then((rep) => { if (!cancel && rep && rep.ok) setD((p) => ({ ...p, reputacao: rep })); })
      .catch(() => {}); // não conectada / falha → não sobrescreve
    return () => { cancel = true; };
  }, [canPullMeli, link && link.accId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pullFromMeli = async () => {
    if (!d.periodoIni || !d.periodoFim) { setMlMsg({ err: true, t: 'Defina o início e o fim do período primeiro.' }); return; }
    setMlBusy(true); setMlMsg(null);
    try {
      const r = await window.P4_API.meliReportData(link.accId, d.periodoIni, d.periodoFim);
      const money = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const int = (n) => String(Math.round(Number(n) || 0));
      setD((p) => ({
        ...p,
        faturamento: money(r.faturamento),
        vendas: int(r.vendas),
        receitaAds: money(r.receitaAds),
        vendasAds: int(r.vendasAds),
        investimento: money(r.investimento),
      }));
      // sem mensagem de sucesso (os campos já mostram o resultado); só avisa se algo falhou
      const adsErr = r.ads && r.ads.erro;
      const ordErr = r.ordersErro;
      const warn = [
        ordErr ? 'Pedidos podem estar incompletos — confira o faturamento.' : '',
        adsErr ? 'Ads não retornou — confira o acesso de Publicidade do app.' : '',
      ].filter(Boolean).join(' ');
      setMlMsg(warn ? { err: true, t: '⚠ ' + warn } : null);
    } catch (e) {
      setMlMsg({ err: true, t: e.message || 'Falha ao buscar dados do Mercado Livre' });
    } finally {
      setMlBusy(false);
    }
  };
  // Puxa as campanhas ATIVAS de Product Ads do período, JÁ comparadas com o
  // relatório anterior (campanhas novas + mudanças de orçamento/ACOS-alvo +
  // pausadas/removidas) — o histórico é construído a partir dos snapshots salvos.
  const pullCampaigns = async () => {
    if (!d.periodoIni || !d.periodoFim) { setCampMsg({ err: true, t: 'Defina o início e o fim do período primeiro.' }); return; }
    setCampBusy(true); setCampMsg(null);
    try {
      const r = await window.P4_API.meliCampaigns(link.accId, d.periodoIni, d.periodoFim);
      if (!r || r.ok === false) { setCampMsg({ err: true, t: 'Não foi possível buscar as campanhas — confira o acesso de Publicidade do app no Mercado Livre.' }); return; }
      const active = r.campanhas || [];
      const paused = r.pausadasCount || 0;
      if (!active.length) { setCampMsg({ err: false, t: `Nenhuma campanha ativa no período${paused ? ` (${paused} inativa(s))` : ''}.` }); return; }
      const numStr = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const roasStr = (v) => (v == null ? '' : Number(v).toFixed(2).replace('.', ','));
      const money = (v) => (v == null ? '—' : 'R$ ' + numStr(v));
      const roasd = (v) => (v == null ? '—' : roasStr(v) + 'x');
      const fmtMud = (m) => {
        const out = [];
        if (m.roasObjetivo) out.push(`ROAS obj. ${roasd(m.roasObjetivo.de)} → ${roasd(m.roasObjetivo.para)}`);
        if (m.orcamento) out.push(`Orç. ${money(m.orcamento.de)} → ${money(m.orcamento.para)}`);
        return out;
      };
      const novas = active.map((c) => ({
        id: c.id != null ? String(c.id) : '',
        nome: c.nome || '',
        roasObjetivo: c.roasObjetivo != null ? roasStr(c.roasObjetivo) : '',
        orcamento: c.orcamento != null ? numStr(c.orcamento) : '',
        investimento: numStr(c.investimento),
        faturamento: c.receitaAds != null ? numStr(c.receitaAds) : '',
        roas: c.roas != null ? roasStr(c.roas) : '',
        novo: !!c.novo,
        mudancas: c.mudancas ? fmtMud(c.mudancas) : null,
      }));
      const meta = {
        comparadoCom: r.comparouCom || null,
        removidas: (r.removidas || []).map((x) => ({
          nome: x.nome || '',
          investimento: x.investimento != null && x.investimento !== '' ? (typeof x.investimento === 'number' ? numStr(x.investimento) : String(x.investimento)) : '',
        })),
      };
      // Comparativo em texto p/ as Observações: campanhas novas + alterações de
      // ROAS objetivo/orçamento. Substitui o bloco gerado anteriormente (sem
      // duplicar) e preserva as notas manuais que o analista escreveu.
      let obsBlock = '';
      if (r.comparouCom) {
        const novasNomes = novas.filter((c) => c.novo).map((c) => c.nome).filter(Boolean);
        const alteradas = novas.filter((c) => c.mudancas && c.mudancas.length);
        const removidasNomes = (meta.removidas || []).map((x) => x.nome).filter(Boolean);
        const per = `${brShort(r.comparouCom.periodoIni)}–${brShort(r.comparouCom.periodoFim)}`;
        const L = [`Comparativo de campanhas (vs. ${per}):`];
        if (novasNomes.length) { L.push('', 'Campanhas novas:'); novasNomes.forEach((n) => L.push(`• ${n}`)); }
        if (alteradas.length) { L.push('', 'Alterações de ROAS objetivo / orçamento:'); alteradas.forEach((c) => L.push(`• ${c.nome} — ${c.mudancas.join('; ')}`)); }
        if (removidasNomes.length) { L.push('', 'Pausadas/removidas:'); removidasNomes.forEach((n) => L.push(`• ${n}`)); }
        if (!novasNomes.length && !alteradas.length && !removidasNomes.length) L.push('', 'Sem campanhas novas, alterações de ROAS/orçamento ou pausas no período.');
        obsBlock = L.join('\n');
      }
      setD((p) => {
        // Insere o resumo como BLOCO de texto no topo das Observações (novo modelo).
        // Remove o bloco automático anterior (por id) e preserva os blocos do analista.
        const prevBlocks = p.obsBlocks || [];
        const autoId = p.campanhasObsAutoId;
        const kept = autoId ? prevBlocks.filter((b) => b.id !== autoId) : prevBlocks;
        let obsBlocks = kept;
        let campanhasObsAutoId = null;
        if (obsBlock) {
          const autoBlock = makeTextBlock(obsTextToHtml(obsBlock));
          campanhasObsAutoId = autoBlock.id;
          obsBlocks = [autoBlock, ...kept];
        }
        return { ...p, campanhas: novas, campanhasMeta: meta, obsBlocks, obs: blocksToPlainText(obsBlocks), campanhasObsAutoId };
      });
      const nNovas = novas.filter((c) => c.novo).length;
      const nMud = novas.filter((c) => c.mudancas && c.mudancas.length).length;
      const partes = [`${active.length} ativa(s) na tabela`];
      if (r.comparouCom) {
        if (nNovas) partes.push(`${nNovas} nova(s)`);
        if (nMud) partes.push(`${nMud} com mudança`);
        if (meta.removidas.length) partes.push(`${meta.removidas.length} pausada(s)/removida(s)`);
        if (!nNovas && !nMud && !meta.removidas.length) partes.push('sem alterações vs. período anterior');
      } else {
        partes.push('1º período — comparação a partir do próximo');
      }
      if (paused) partes.push(`${paused} inativa(s) ignorada(s)`);
      setCampMsg({ err: false, t: partes.join(' · ') });
    } catch (e) {
      setCampMsg({ err: true, t: (e && e.message) || 'Falha ao buscar campanhas do Mercado Livre.' });
    } finally { setCampBusy(false); }
  };

  const saveToSystem = async () => {
    if (!link || !window.P4_API) return;
    setSavingApi(true); setApiMsg(null);
    try {
      const payload = { ...d };
      if (link.marketplace) payload.marketplace = link.marketplace; // garante a conta certa
      const res = await window.P4_API.createReport(link.accId, payload);
      const c = (res && res.created) || 0;
      const o = (res && res.overwritten) || 0;
      let text;
      if (c && o) text = `${c} relatório(s) salvo(s) · período atual atualizado ✓`;
      else if (c) text = `${c} relatório(s) salvo(s) ✓ — já no histórico.`;
      else if (o) text = 'Relatório do período atualizado (sobrescrito) ✓.';
      else text = 'Nada novo a salvar.';
      setApiMsg({ ok: true, text });
    } catch (e) {
      setApiMsg({ ok: false, text: (e && e.message) || 'Falha ao salvar no sistema.' });
    } finally { setSavingApi(false); }
  };

  const Report = window.ReportA;
  const tn = (k) => d.status[k] || 'pos';
  const hasPages = (d.prev || []).length > 0;
  const pageCount = hasPages ? 2 : 1;
  const reportData = { ...d, _chartStyle: t.chartStyle };
  const acosCalc = window.calcAcos(d);
  const tacosCalc = window.calcTacos(d);
  const roasCalc = window.calcRoas(d);

  const periodDays = rangeDays(d.periodoIni, d.periodoFim);
  const essentialKeys = ['marketplace', 'periodoIni', 'periodoFim', 'faturamento', 'vendas', 'receitaAds', 'vendasAds', 'investimento'];
  const filledCount = essentialKeys.filter((k) => d[k] != null && String(d[k]).trim() !== '').length;
  const progressPct = Math.round((filledCount / essentialKeys.length) * 100);
  const obsBlocksArr = d.obsBlocks || [];
  const obsImgCount = obsBlocksArr.filter((b) => b.type === 'image').length;
  const obsHasText = obsBlocksArr.some((b) => b.type === 'text' && String(b.html || '').replace(/<[^>]+>/g, '').trim());
  const obsSummary = (obsHasText ? 'nota' : 'sem nota') + (obsImgCount ? ` · ${obsImgCount} print${obsImgCount > 1 ? 's' : ''}` : '');
  return (
    <div className="app">
      {/* ---- left: form ---- */}
      <aside className="panel">
        <div className="panel-head">
          <img src={((window.__resources && window.__resources.p4mark) || 'assets/p4-mark.png')} alt="P4" className="panel-logo" />
          <div className="ph-txt">
            <h2>Gerador de Relatório</h2>
            <p>Performance Semanal · Marketplaces</p>
          </div>
        </div>
        <div className="flow-progress" title={filledCount + ' de ' + essentialKeys.length + ' campos essenciais preenchidos'}>
          <div className="fp-bar"><span style={{ width: progressPct + '%' }}></span></div>
          <span className="fp-label">{progressPct === 100 ? '✓ Pronto para gerar' : filledCount + '/' + essentialKeys.length + ' essenciais'}</span>
        </div>

        <div className="panel-body" ref={bodyRef} onKeyDown={onFlowKey}>
          <Section title="Identificação" collapsible note={
            <span className="ml-help right-open" tabIndex={0} role="button" aria-label="Como funciona a identificação" onClick={(e) => e.stopPropagation()}>?
              <span className="ml-help-pop"><span className="ml-help-card">Marketplace, cliente e metas vêm do <b>cadastro do cliente</b> · <b>semanal</b> · ROAS/ACOS/TACOS <b>automáticos</b>.</span></span>
            </span>
          }>
            <div className="row2">
              <StaticField label="Marketplace" value={d.marketplace || '—'} />
              <StaticField label="Loja / Cliente" value={d.loja || '—'} />
            </div>
            <StaticField label="Preparado por" value={d.analista || '—'} wide />
          </Section>

          <Section title="Período" collapsible note={periodDays ? `${brShort(d.periodoIni)} – ${brShort(d.periodoFim)} · ${periodDays} dia${periodDays > 1 ? 's' : ''}` : ''}>
            <label className="field">
              <span className="field-label"><span className="fl-txt">Início e fim</span></span>
              <DateRangeInput startValue={d.periodoIni} endValue={d.periodoFim} onChange={(ini, fim) => setD((prev) => ({ ...prev, periodoIni: ini, periodoFim: fim }))} />
            </label>
          </Section>

          <Section title="Resultados do período" collapsible note="▲ pos · – neutro · ▼ neg">
            {canPullMeli ? (
              <div style={{ marginBottom: 14 }}>
                <div className="ml-row">
                  <button type="button" className="btn-meli" onClick={pullFromMeli} disabled={mlBusy}>
                    {mlBusy ? <span className="ml-spin"></span> : <span className="ml-badge">ML</span>}
                    {mlBusy ? 'Buscando dados…' : 'Puxar do Mercado Livre'}
                    {!mlBusy ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2D3277" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v10" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></svg>
                    ) : null}
                  </button>
                  <span className="ml-help" tabIndex={0} role="button" aria-label="O que este botão faz?">?
                    <span className="ml-help-pop"><span className="ml-help-card">Puxa do Mercado Livre o <b>faturamento</b> e as <b>vendas brutas</b> do período (via Pedidos) e os dados de <b>Ads</b> (investimento, receita e vendas de Ads). Valores <b>brutos</b> (sem descontar cancelamentos/devoluções) — compare com a <a href="https://www.mercadolivre.com.br/metricas" target="_blank" rel="noopener">página de Métricas</a> e ajuste à mão se precisar.</span></span>
                  </span>
                </div>
                {mlMsg ? <div style={{ fontSize: 11.5, marginTop: 8, fontWeight: 600, color: mlMsg.err ? '#ff8b83' : '#7be36f' }}>{mlMsg.t}</div> : null}
              </div>
            ) : null}
            <div className="row2">
              <Field label="Faturamento Total" prefix="R$" value={d.faturamento} onChange={set('faturamento')} placeholder="0,00" money tone={tn('faturamento')} onTone={setTone('faturamento')} />
              <Field label="Vendas Totais" suffix="ped." value={d.vendas} onChange={set('vendas')} placeholder="0" numeric />
            </div>
            <div className="row2">
              <Field label="Receita via Ads" prefix="R$" value={d.receitaAds} onChange={set('receitaAds')} placeholder="0,00" money tone={tn('receitaAds')} onTone={setTone('receitaAds')} />
              <Field label="Vendas via Ads" suffix="ped." value={d.vendasAds} onChange={set('vendasAds')} placeholder="0" numeric tone={tn('vendasAds')} onTone={setTone('vendasAds')} />
            </div>
            <Field label="Investimento em Ads" prefix="R$" value={d.investimento} onChange={set('investimento')} placeholder="0,00" wide money tone={tn('investimento')} onTone={setTone('investimento')} />
            <div className="row3 auto-row">
              <CalcField label="ROAS" suffix="x" value={roasCalc != null ? window.fmtCalc(roasCalc) : '—'} tone={tn('roas')} onTone={setTone('roas')} />
              <CalcField label="ACOS" suffix="%" value={acosCalc != null ? window.fmtCalc(acosCalc) : '—'} tone={tn('acos')} onTone={setTone('acos')} />
              <CalcField label="TACOS" suffix="%" value={tacosCalc != null ? window.fmtCalc(tacosCalc) : '—'} tone={tn('tacos')} onTone={setTone('tacos')} />
            </div>
          </Section>

          <Section title="Observações" collapsible summary={obsSummary} note={
            <span className="ml-help right-open" tabIndex={0} role="button" aria-label="Como anexar prints" onClick={(e) => e.stopPropagation()}>?
              <span className="ml-help-pop"><span className="ml-help-card">Cole (Ctrl/Cmd+V) um print nas <b>Notas</b> ou na galeria, ou clique em <b>+ Adicionar print</b> para enviar do computador.</span></span>
            </span>
          }>
            {obsMax
              ? <div className="ob-editing-note">Editando em tela cheia…</div>
              : <ObsEditor blocks={d.obsBlocks} onChange={setObsBlocks} onAddImages={addObsImages} onMaximize={() => setObsMax(true)} />}
          </Section>

          <Section title="Campanhas de Ads" collapsible note={(d.campanhas || []).length ? `${(d.campanhas || []).length} campanha(s)` : ''}>
            <div className="camp-filtros">
              <div className="camp-filtros-head">Exibição no relatório <span className="cf-tag">PDF</span></div>
              <div className="cf-row">
                <span className="cf-inline-lab">Ordenar</span>
                <div className="cf-grow">
                  <SelectMenu ariaLabel="Ordenar campanhas por"
                    value={d.campanhasOrdem || 'roasDesc'}
                    options={CAMP_ORDEM_OPTS.map((o) => ({ value: o.key, label: o.label }))}
                    onChange={(v) => set('campanhasOrdem')(v)} />
                </div>
              </div>
              <div className="cf-row">
                <span className="cf-inline-lab">Filtrar</span>
                <div className="cf-dim2">
                  <SelectMenu ariaLabel="Filtrar campanhas por"
                    value={filtroDim}
                    options={CAMP_FILTRO_DIMS.map((x) => ({ value: x.key, label: x.label }))}
                    onChange={onFiltroDim} />
                </div>
                {!filtroDimMeta.bool ? (
                  <div className="cf-in cf-valin">
                    {filtroDimMeta.money ? <span className="cf-affix">R$</span> : null}
                    <input value={filtroVal} inputMode="decimal" placeholder="0,00"
                      onChange={(e) => setFiltroVal(filtroDimMeta.money ? maskBRL(e.target.value) : e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addFiltro(); } }} />
                    {!filtroDimMeta.money ? <span className="cf-affix r">x</span> : null}
                  </div>
                ) : (
                  <div className="cf-valin cf-boolnote">clique em +</div>
                )}
                <button type="button" className="cf-add" onClick={addFiltro} title="Adicionar filtro" aria-label="Adicionar filtro">+</button>
              </div>
              {(filtrosAtivos.length || campOcultas > 0) ? (
                <div className="cf-chips">
                  {filtrosAtivos.map((x) => (
                    <span className="cf-chip" key={x.key}>
                      {x.bool ? x.chip() : x.chip(campFiltro[x.key])}
                      <button type="button" onClick={() => removeFiltro(x.key)} aria-label="Remover filtro">×</button>
                    </span>
                  ))}
                  {campOcultas > 0 ? <span className="cf-hidden">{campOcultas} ocultada(s) do PDF</span> : null}
                </div>
              ) : null}
            </div>
            {canPullMeli ? (
              <div style={{ marginBottom: 12 }}>
                <button type="button" onClick={pullCampaigns} disabled={campBusy}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid var(--panel-line)', background: 'transparent', color: 'var(--panel-txt)', fontFamily: "'Sora'", fontWeight: 600, fontSize: 12.5, padding: '8px 13px', borderRadius: 9, cursor: campBusy ? 'wait' : 'pointer', opacity: campBusy ? 0.6 : 1 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, background: '#FFE600', color: '#2D3277', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 8.5, flex: 'none' }}>ML</span>
                  {campBusy ? 'Buscando campanhas…' : 'Puxar campanhas ativas'}
                </button>
                {campMsg ? <div style={{ fontSize: 11.5, marginTop: 7, fontWeight: 600, color: campMsg.err ? '#ff8b83' : '#7be36f' }}>{campMsg.t}</div> : null}
              </div>
            ) : null}
            {(d.campanhasMeta && d.campanhasMeta.comparadoCom) ? (
              <p className="camp-cmp-note">Comparado com o período anterior · {brShort(d.campanhasMeta.comparadoCom.periodoIni)}–{brShort(d.campanhasMeta.comparadoCom.periodoFim)}</p>
            ) : null}
            {(d.campanhas || []).map((c, i) => (
              <CampCard key={i} c={c} index={i} field={campField(i)} onRemove={() => removeCampanha(i)} acosTxt={campAcosTxt} tacosTxt={campTacosTxt} />
            ))}
            {(d.campanhasMeta && d.campanhasMeta.removidas && d.campanhasMeta.removidas.length) ? (
              <p className="camp-cmp-note camp-rem-note">Pausadas/removidas vs. anterior: {d.campanhasMeta.removidas.map((r) => r.nome).filter(Boolean).join(', ')}</p>
            ) : null}
            {!(d.campanhas || []).length ? <p style={{ fontSize: 11.5, color: 'var(--panel-mut)', margin: '2px 2px 10px' }}>Nenhuma campanha. {canPullMeli ? 'Puxe do Mercado Livre ou ' : ''}adicione manualmente.</p> : null}
            <button type="button" className="add-prev" onClick={addCampanha}>+ Adicionar campanha</button>
          </Section>

          <Section title="Comparativo" collapsible note={`${(d.prev || []).length} período(s) anterior(es)`}>
            <div className="prev-list">
              {(d.prev || []).map((p, i) => (
                <PrevCard key={i} p={p} index={i} onField={prevField(i)} onDates={prevDates(i)} onRemove={() => removePrev(i)} />
              ))}
            </div>
            <button type="button" className="add-prev" onClick={addPrev}>+ Adicionar período anterior</button>
          </Section>
        </div>

        <div className="panel-foot">
          {link ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--muted)' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: '#56D54F', boxShadow: '0 0 0 3px rgba(86,213,79,.18)', flex: 'none' }}></span>
              Vinculado a <b style={{ color: 'inherit' }}>{link.loja}</b> · {link.marketplace}
            </div>
          ) : null}
          <div className="foot-main">
            {link ? (
              <button type="button" className="btn-primary" onClick={saveToSystem} disabled={savingApi || !loggedIn}
                style={{ opacity: savingApi || !loggedIn ? 0.5 : 1, cursor: savingApi || !loggedIn ? 'not-allowed' : 'pointer' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                {savingApi ? 'Salvando…' : 'Salvar no sistema'}
              </button>
            ) : null}
            <button className="btn-primary" onClick={print} title={link ? 'Salva no sistema e baixa o PDF' : 'Baixar o PDF'}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>
              Baixar PDF
            </button>
          </div>
          {link && !loggedIn ? <div style={{ fontSize: 11.5, color: '#ff7a72' }}>Entre no sistema (aba de Telas) para salvar no banco.</div> : null}
          {apiMsg ? <div style={{ fontSize: 12.5, fontWeight: 700, color: apiMsg.ok ? '#56D54F' : '#ff7a72' }}>{apiMsg.text}</div> : null}
          {link && loggedIn ? <div style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: 'center' }}>Baixar PDF já salva no sistema automaticamente.</div> : null}
          <button type="button" className="btn-ghost sm" onClick={reset} style={{ marginTop: 8, width: '100%' }}>Limpar período atual</button>
        </div>
      </aside>

      {/* ---- right: preview ---- */}
      <main className="stage" ref={stageRef}>
        <div className="stage-bar">
          <span>Pré-visualização · A4{hasPages ? ' · ' + pageCount + ' páginas' : ''}</span>
          <span className="stage-hint">Atualiza em tempo real</span>
        </div>
        <div className="stage-scroll">
          <div className="page-scale" style={{ transform: `scale(${scale})` }}>
            <div id="print-area" className={'dens-' + t.density}>
              <Report d={reportData} />
            </div>
          </div>
        </div>
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Acento da marca" />
        <TweakColor label="Cor" value={t.accent}
          options={['#56D54F', '#BAFF00', '#FF329D', '#2A6FDB', '#1C242E']}
          onChange={(v) => setTweak('accent', v)} />
        <TweakSection label="Layout do relatório" />
        <TweakRadio label="Densidade" value={t.density}
          options={[{ value: 'compacto', label: 'Compacto' }, { value: 'padrao', label: 'Padrão' }, { value: 'amplo', label: 'Amplo' }]}
          onChange={(v) => setTweak('density', v)} />
        <TweakSection label="Gráficos de evolução" />
        <TweakRadio label="Estilo" value={t.chartStyle}
          options={[{ value: 'area', label: 'Área' }, { value: 'line', label: 'Linha' }, { value: 'step', label: 'Degrau' }]}
          onChange={(v) => setTweak('chartStyle', v)} />
      </TweaksPanel>

      {obsMax ? (
        <div className="ob-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setObsMax(false); }}>
          <div className="ob-modal-card">
            <div className="ob-modal-head"><span>Observações</span><button type="button" className="ob-tool" onClick={() => setObsMax(false)}>✕ Fechar</button></div>
            <ObsEditor blocks={d.obsBlocks} onChange={setObsBlocks} onAddImages={addObsImages} large />
          </div>
        </div>
      ) : null}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
