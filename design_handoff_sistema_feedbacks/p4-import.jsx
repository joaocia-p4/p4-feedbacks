// p4-import.jsx — importação de clientes em lote via planilha (.xlsx / .csv), usando SheetJS (window.XLSX).
// Cada linha = um marketplace; linhas com a mesma "Loja" viram um único cliente com várias contas.

const IMP_MARKETPLACES = window.P4_AD_MARKETPLACES || ['Mercado Livre', 'Shopee', 'Magalu', 'Amazon', 'Tiktok'];
const IMP_WEEKDAYS = window.P4_WEEKDAYS || ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

// normaliza texto (sem acento, minúsculo, sem espaços nas pontas)
const impNorm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// marketplace: nome completo, código curto ou variações → nome canônico
const MK_ALIAS = {};
IMP_MARKETPLACES.forEach((m) => { MK_ALIAS[impNorm(m)] = m; });
Object.assign(MK_ALIAS, {
  ml: 'Mercado Livre', meli: 'Mercado Livre', mercadolibre: 'Mercado Livre',
  shp: 'Shopee', shopee: 'Shopee',
  mgl: 'Magalu', magazineluiza: 'Magalu', 'magazine luiza': 'Magalu',
  amz: 'Amazon',
  tt: 'Tiktok', 'tik tok': 'Tiktok', tiktokshop: 'Tiktok', 'tiktok shop': 'Tiktok',
});
const resolveMk = (v) => MK_ALIAS[impNorm(v)] || null;
const resolveTipo = (v) => { const n = impNorm(v); if (!n) return 'Loja'; if (n === 'loja') return 'Loja'; if (n === 'marca') return 'Marca'; return null; };
const resolveFreq = (v) => { const n = impNorm(v); if (!n) return 'Semanal'; if (n.indexOf('seman') === 0) return 'Semanal'; if (n.indexOf('quinz') === 0) return 'Quinzenal'; if (n.indexOf('mens') === 0) return 'Mensal'; return null; };
const resolveWeekday = (v) => { const n = impNorm(v); if (!n) return null; return IMP_WEEKDAYS.find((w) => impNorm(w) === n || impNorm(w).indexOf(n) === 0) || null; };
const resolveStatus = (v) => { const n = impNorm(v); return (n === 'encerrado' || n === 'encerrada' || n === 'inativo' || n === 'inativa' || n === 'nao' || n === 'false' || n === '0') ? false : true; };

// aliases de cabeçalho aceitos para cada campo
const FIELD_ALIASES = {
  loja: ['loja', 'cliente', 'nome', 'nome do cliente', 'empresa'],
  tipo: ['tipo'],
  analista: ['analista', 'responsavel', 'analista responsavel'],
  marketplace: ['marketplace', 'marketplaces', 'canal', 'canais'],
  conta: ['conta', 'apelido', 'identificacao', 'conta/apelido'],
  metaInvestimento: ['meta investimento', 'investimento', 'meta de investimento', 'metainvestimento'],
  metaRoas: ['meta roas', 'roas', 'meta de roas', 'metaroas'],
  metaAcos: ['meta acos', 'acos', 'meta de acos', 'metaacos'],
  metaTacos: ['meta tacos', 'tacos', 'meta de tacos', 'metatacos'],
  freq: ['frequencia', 'freq', 'periodicidade'],
  dia: ['dia', 'dia da semana', 'dia do mes', 'dia de envio', 'dia envio'],
  observacoes: ['observacoes', 'obs', 'observacao', 'notas'],
  clienteId: ['id cliente', 'id do cliente', 'clienteid'],
  contaId: ['id conta', 'id da conta', 'contaid'],
  dataEntrada: ['data entrada', 'data de entrada', 'entrada'],
  dataEncerramento: ['data encerramento', 'data de encerramento', 'encerramento'],
  status: ['status', 'ativo', 'situacao'],
};
const pick = (rowNorm, field) => {
  for (const a of FIELD_ALIASES[field]) {
    if (Object.prototype.hasOwnProperty.call(rowNorm, a) && String(rowNorm[a]).trim() !== '') return String(rowNorm[a]).trim();
  }
  return '';
};

// linhas cruas (objetos por cabeçalho) → grupos por loja
function impGroupRows(rawRows) {
  const groups = new Map();
  rawRows.forEach((r) => {
    const rn = {};
    Object.keys(r).forEach((k) => { rn[impNorm(k)] = r[k]; });
    const loja = pick(rn, 'loja');
    if (!loja) return;
    const key = impNorm(loja);
    if (!groups.has(key)) {
      groups.set(key, { loja, clienteId: '', tipoRaw: '', analistaRaw: '', freqRaw: '', diaRaw: '', observacoes: '', rows: [] });
    }
    const g = groups.get(key);
    // campos no nível do cliente: a primeira linha com valor não-vazio vence
    const setIf = (field, val) => { if (val && !g[field]) g[field] = val; };
    setIf('clienteId', pick(rn, 'clienteId'));
    setIf('tipoRaw', pick(rn, 'tipo'));
    setIf('analistaRaw', pick(rn, 'analista'));
    setIf('freqRaw', pick(rn, 'freq'));
    setIf('diaRaw', pick(rn, 'dia'));
    setIf('observacoes', pick(rn, 'observacoes'));
    const metas = { metaInvestimento: pick(rn, 'metaInvestimento'), metaRoas: pick(rn, 'metaRoas'), metaAcos: pick(rn, 'metaAcos'), metaTacos: pick(rn, 'metaTacos') };
    const conta = pick(rn, 'conta');
    const dataEntrada = pick(rn, 'dataEntrada');
    const dataEncerramento = pick(rn, 'dataEncerramento');
    const status = pick(rn, 'status');
    const mks = pick(rn, 'marketplace').split(/[,;/|]+/).map((s) => s.trim()).filter(Boolean);
    const contaId = pick(rn, 'contaId');
    mks.forEach((mk) => g.rows.push({ mkRaw: mk, conta, contaId: mks.length === 1 ? contaId : '', dataEntrada, dataEncerramento, status, ...metas }));
  });
  return [...groups.values()];
}

// grupo → cliente validado { loja, errors, warnings, payload, ... }
function impBuildClient(g, ctx) {
  const errors = [];
  const warnings = [];
  // ID Cliente preenchido e existente → ATUALIZA; senão → cria novo
  const cid = (g.clienteId || '').trim();
  const existing = cid ? ctx.existingById.get(cid) : null;
  const isUpdate = !!existing;
  if (cid && !existing) warnings.push('ID Cliente não encontrado — será criado um novo cliente');

  const tipo = resolveTipo(g.tipoRaw);
  if (tipo === null) errors.push(`Tipo inválido: "${g.tipoRaw}" (use Loja ou Marca)`);

  let analistaId = null;
  let analistaNome = '';
  if (ctx.isAdmin) {
    if (!g.analistaRaw) errors.push('Analista não informado');
    else {
      const u = ctx.users.find((x) => impNorm(x.nome) === impNorm(g.analistaRaw) || impNorm(x.email) === impNorm(g.analistaRaw));
      if (!u) errors.push(`Analista não encontrado: "${g.analistaRaw}"`);
      else { analistaId = u.id; analistaNome = u.nome; }
    }
  } else { analistaId = ctx.selfUser.id; analistaNome = ctx.selfUser.nome; }

  const freq = resolveFreq(g.freqRaw);
  if (freq === null) errors.push(`Frequência inválida: "${g.freqRaw}" (Semanal, Quinzenal ou Mensal)`);
  let agenda = { freq: 'Semanal', diaSemana: 'Segunda' };
  if (freq === 'Mensal') {
    const d = parseInt(g.diaRaw, 10);
    agenda = { freq: 'Mensal', diaMes: d >= 1 && d <= 28 ? d : 5 };
  } else if (freq) {
    const wd = g.diaRaw ? resolveWeekday(g.diaRaw) : 'Segunda';
    if (g.diaRaw && !wd) errors.push(`Dia da semana inválido: "${g.diaRaw}"`);
    agenda = { freq, diaSemana: wd || 'Segunda' };
  }

  const contas = [];
  const seen = new Set();
  g.rows.forEach((c) => {
    const mk = resolveMk(c.mkRaw);
    if (!mk) { errors.push(`Marketplace inválido: "${c.mkRaw}"`); return; }
    // dedup por ID da conta (ou marketplace+apelido) — permite 2 contas do mesmo mk
    const dedupKey = (c.contaId && String(c.contaId).trim()) || (mk + '|' + impNorm(c.conta || ''));
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    contas.push({
      id: c.contaId ? String(c.contaId).trim() : undefined,
      marketplace: mk,
      conta: c.conta || '',
      metaInvestimento: c.metaInvestimento || '',
      metaRoas: c.metaRoas || '',
      metaAcos: c.metaAcos || '',
      metaTacos: c.metaTacos || '',
      dataEntrada: c.dataEntrada || '',
      dataEncerramento: c.dataEncerramento || '',
      ativo: resolveStatus(c.status),
    });
  });
  if (!contas.length) errors.push('Nenhum marketplace válido');

  if (!isUpdate && ctx.existingNames && ctx.existingNames.has(impNorm(g.loja))) warnings.push('Já existe um cliente com este nome (será criado outro)');

  const payload = {
    id: isUpdate ? existing.id : null,
    loja: g.loja,
    tipo: tipo || 'Loja',
    analistaId: analistaId || undefined,
    contas,
    marketplaces: contas.map((c) => c.marketplace),
    agenda,
    observacoes: g.observacoes || '',
  };
  return { loja: g.loja, analistaNome, tipo: tipo || 'Loja', agenda, marketplaces: contas.map((c) => c.marketplace), errors, warnings, isUpdate, clienteId: isUpdate ? existing.id : null, payload };
}

function ImportClients({ user, role, users, existing, live, onClose, onDone, toast }) {
  const I = window.Icons;
  const isAdmin = role === 'admin';
  const [step, setStep] = React.useState('upload'); // upload | preview | importing | done
  const [parsed, setParsed] = React.useState([]);
  const [err, setErr] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const [prog, setProg] = React.useState({ i: 0, n: 0, loja: '' });
  const [result, setResult] = React.useState(null);
  const fileRef = React.useRef(null);

  const usersList = users && users.length ? users : (window.P4_USERS || []);
  const existingNames = new Set((existing || []).map((c) => impNorm(c.loja)));
  const existingById = new Map((existing || []).map((c) => [String(c.id), c]));
  const ctx = { isAdmin, users: usersList, selfUser: user, existingNames, existingById };
  const hasXLSX = !!window.XLSX;

  const handleFile = async (file) => {
    if (!file) return;
    setErr(''); setFileName(file.name);
    if (!window.XLSX) { setErr('A leitura de planilhas ainda está carregando. Recarregue a página (Ctrl+Shift+R) e tente de novo.'); return; }
    try {
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = window.XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      const groups = impGroupRows(raw);
      if (!groups.length) { setErr('Nenhum cliente encontrado. A planilha precisa de um cabeçalho com a coluna "Loja" e ao menos uma linha preenchida.'); return; }
      setParsed(groups.map((g) => impBuildClient(g, ctx)));
      setStep('preview');
    } catch (e) {
      setErr('Não foi possível ler o arquivo. Use um .xlsx ou .csv exportado da sua planilha. (' + (e.message || 'erro') + ')');
    }
  };

  const downloadTemplate = () => {
    if (!window.XLSX) { toast('Recarregue a página e tente novamente.'); return; }
    const exA = (usersList.find((u) => u.papel === 'analista') || usersList[0] || user || {}).nome || 'Nome do analista';
    const headers = ['Loja', 'Tipo', 'Analista', 'Marketplace', 'Conta', 'Meta Investimento', 'Meta ROAS', 'Meta ACOS', 'Meta TACOS', 'Frequência', 'Dia', 'Observações'];
    const rows = [
      headers,
      ['Casa & Conforto', 'Loja', exA, 'Mercado Livre', 'Loja oficial', '20,00', '4,00', '20,00', '15,00', 'Semanal', 'Segunda', 'Cliente novo'],
      ['Casa & Conforto', 'Loja', exA, 'Shopee', '', '', '', '', '', 'Semanal', 'Segunda', '(2º marketplace da mesma loja)'],
      ['Top Marca', 'Marca', exA, 'Amazon', '', '25,00', '4,50', '', '', 'Mensal', '5', 'Metas opcionais — pode deixar em branco'],
    ];
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
    window.XLSX.writeFile(wb, 'modelo-clientes.xlsx');
  };

  const valids = parsed.filter((p) => p.errors.length === 0);
  const invalids = parsed.filter((p) => p.errors.length > 0);
  const totalMk = valids.reduce((a, p) => a + p.marketplaces.length, 0);
  const updateN = valids.filter((p) => p.isUpdate).length;
  const createN = valids.length - updateN;

  const runImport = async () => {
    if (!live) { toast('Conecte-se ao servidor para importar.'); return; }
    if (!valids.length) return;
    setStep('importing');
    let created = 0; let updated = 0; const fails = [];
    for (let i = 0; i < valids.length; i++) {
      const v = valids[i];
      setProg({ i: i + 1, n: valids.length, loja: v.loja });
      try {
        if (v.isUpdate) { await window.P4_API.updateClient(v.clienteId, v.payload); updated += 1; }
        else { await window.P4_API.createClient(v.payload); created += 1; }
      } catch (e) { fails.push({ loja: v.loja, msg: e.message || 'erro ao salvar' }); }
    }
    setResult({ created, updated, fail: fails.length, fails });
    setStep('done');
  };

  const finish = () => { if (onDone) onDone(); onClose(); };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(13,20,16,.55)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 };
  const card = { background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 16, width: '100%', maxWidth: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 30px 70px -28px rgba(0,0,0,.5)' };
  const body = { padding: '20px 22px', overflowY: 'auto' };
  const errBox = { marginTop: 14, padding: '11px 13px', borderRadius: 9, background: 'rgba(216,66,58,.1)', border: '1px solid rgba(216,66,58,.3)', color: 'var(--red)', fontSize: 12.5, fontWeight: 500, lineHeight: 1.5 };
  const xBtn = { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--paper)', cursor: 'pointer', color: 'var(--muted)', fontSize: 15, flex: 'none' };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '17px 22px', borderBottom: '1px solid var(--line)', flex: 'none' }}>
          <span className="set-ic"><I.upload size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Importar clientes via planilha</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Cadastre vários clientes de uma vez · arquivo .xlsx ou .csv</div>
          </div>
          <button style={xBtn} onClick={onClose} title="Fechar">✕</button>
        </div>

        {step === 'upload' ? (
          <div style={body}>
            {!live ? <div style={{ ...errBox, marginTop: 0, marginBottom: 16, background: 'rgba(224,146,47,.12)', borderColor: 'rgba(224,146,47,.35)', color: '#9a6a18' }}>Você está em modo demonstração. Conecte-se ao servidor (faça login) para que a importação salve de verdade.</div> : null}
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Como funciona</div>
            <ol style={{ margin: '0 0 4px 18px', padding: 0, fontSize: 12.8, color: 'var(--muted)', lineHeight: 1.7 }}>
              <li><b>Editar em massa:</b> use o <b>Exportar planilha</b>, edite e reimporte aqui — linhas com <b>ID Cliente</b> atualizam o cliente (não duplicam).</li>
              <li>Para <b>criar novos</b>, baixe o modelo e preencha <b>uma linha por marketplace</b> (deixe o ID Cliente em branco).</li>
              <li>Cliente com vários marketplaces: <b>repita o nome da loja</b> em várias linhas. <b>Metas são opcionais.</b></li>
              <li>Salve e envie o arquivo (<b>.xlsx</b> ou <b>.csv</b>).</li>
            </ol>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn-line" onClick={downloadTemplate}><I.upload size={15} /> Baixar modelo (.xlsx)</button>
              <button className="btn-accent" onClick={() => fileRef.current && fileRef.current.click()}><I.upload size={16} /> Escolher arquivo</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files && e.target.files[0])} />
            </div>
            {fileName && !err ? <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--muted)' }}>Arquivo selecionado: <b style={{ color: 'var(--ink)' }}>{fileName}</b></div> : null}
            {err ? <div style={errBox}>{err}</div> : null}

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>Colunas aceitas</div>
              <div style={{ fontSize: 12.3, color: 'var(--muted)', lineHeight: 1.7 }}>
                <b style={{ color: 'var(--ink)' }}>Loja*</b>, <b style={{ color: 'var(--ink)' }}>Analista*</b> (nome ou e-mail), <b style={{ color: 'var(--ink)' }}>Marketplace*</b> ({IMP_MARKETPLACES.join(', ')}), Tipo (Loja/Marca), Conta, Meta Investimento/ROAS/ACOS/TACOS, Data entrada, Data encerramento, Status (Ativo/Encerrado), Frequência (Semanal/Quinzenal/Mensal), Dia, Observações. <b style={{ color: 'var(--ink)' }}>ID Cliente</b>/<b style={{ color: 'var(--ink)' }}>ID Conta</b> vêm da exportação — não preencha à mão.
                <div style={{ marginTop: 6 }}>* obrigatórios{!isAdmin ? ' — como analista, todos os clientes serão atribuídos a você (a coluna Analista é ignorada).' : '.'}</div>
              </div>
            </div>
          </div>
        ) : null}

        {step === 'preview' ? (
          <>
            <div style={{ ...body, flex: 1 }}>
              <div style={{ fontSize: 13, marginBottom: 14 }}>
                <b style={{ color: 'var(--green-ink)' }}>{valids.length}</b> {valids.length === 1 ? 'cliente pronto' : 'clientes prontos'}
                {updateN ? <> · <b style={{ color: '#2a6fdb' }}>{updateN}</b> p/ atualizar</> : null}
                {createN ? <> · <b>{createN}</b> novo{createN === 1 ? '' : 's'}</> : null}
                {invalids.length ? <> · <b style={{ color: 'var(--red)' }}>{invalids.length}</b> com erro (serão ignorados)</> : null}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {parsed.map((p, i) => {
                  const bad = p.errors.length > 0;
                  return (
                    <div key={i} style={{ border: '1px solid var(--line)', borderLeft: `3px solid ${bad ? 'var(--red)' : p.warnings.length ? 'var(--amber)' : 'var(--green)'}`, borderRadius: 10, padding: '11px 13px', background: bad ? 'rgba(216,66,58,.04)' : 'transparent' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                        <b style={{ fontSize: 13.5 }}>{p.loja}</b>
                        {!bad ? <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 6, alignSelf: 'center', background: p.isUpdate ? 'rgba(42,111,219,.14)' : 'rgba(86,213,79,.16)', color: p.isUpdate ? '#2a6fdb' : 'var(--green-ink)' }}>{p.isUpdate ? 'Atualizar' : 'Novo'}</span> : null}
                        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{p.tipo}{p.analistaNome ? ` · ${p.analistaNome}` : ''}</span>
                        {!bad ? <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>{p.marketplaces.join(' · ')}</span> : null}
                      </div>
                      {p.errors.map((e, j) => <div key={j} style={{ fontSize: 11.8, color: 'var(--red)', fontWeight: 500, marginTop: 4 }}>✕ {e}</div>)}
                      {p.warnings.map((w, j) => <div key={j} style={{ fontSize: 11.8, color: '#9a6a18', fontWeight: 500, marginTop: 4 }}>⚠ {w}</div>)}
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '14px 22px', borderTop: '1px solid var(--line)', flex: 'none' }}>
              <button className="btn-line" onClick={() => { setStep('upload'); setParsed([]); setErr(''); }}>Voltar</button>
              <button className="btn-accent" onClick={runImport} disabled={!valids.length || !live} style={(!valids.length || !live) ? { opacity: .5, cursor: 'not-allowed' } : null}>
                Aplicar em {valids.length} {valids.length === 1 ? 'cliente' : 'clientes'}
              </button>
            </div>
          </>
        ) : null}

        {step === 'importing' ? (
          <div style={{ ...body, textAlign: 'center', padding: '40px 22px' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Importando… {prog.i} de {prog.n}</div>
            <div style={{ height: 8, borderRadius: 99, background: 'var(--line)', overflow: 'hidden', maxWidth: 360, margin: '0 auto' }}>
              <div style={{ height: '100%', width: `${prog.n ? (prog.i / prog.n) * 100 : 0}%`, background: 'var(--accent)', transition: '.2s' }}></div>
            </div>
            <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--muted)' }}>{prog.loja}</div>
          </div>
        ) : null}

        {step === 'done' && result ? (
          <>
            <div style={body}>
              <div style={{ textAlign: 'center', padding: '8px 0 18px' }}>
                <div style={{ fontSize: 32 }}>{result.fail ? '⚠️' : '✅'}</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>
                  {result.updated ? <><b style={{ color: '#2a6fdb' }}>{result.updated}</b> atualizado{result.updated === 1 ? '' : 's'}</> : null}
                  {result.updated && result.created ? ' · ' : null}
                  {result.created ? <><b style={{ color: 'var(--green-ink)' }}>{result.created}</b> criado{result.created === 1 ? '' : 's'}</> : null}
                  {!result.updated && !result.created ? 'Nada aplicado' : null}
                </div>
                {result.fail ? <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>{result.fail} {result.fail === 1 ? 'falhou' : 'falharam'}</div> : null}
              </div>
              {result.fails.length ? (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Não aplicados</div>
                  {result.fails.map((f, i) => <div key={i} style={{ fontSize: 12.3, marginBottom: 5 }}><b>{f.loja}</b> <span style={{ color: 'var(--red)' }}>— {f.msg}</span></div>)}
                </div>
              ) : null}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 22px', borderTop: '1px solid var(--line)', flex: 'none' }}>
              <button className="btn-accent" onClick={finish}>Concluir</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

window.ImportClients = ImportClients;
