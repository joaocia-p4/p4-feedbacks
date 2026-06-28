// p4-new-client.jsx — form to register a client. A client groups one or more
// marketplace accounts (ads run only on the supported marketplaces).

function LField({ label, hint, children }) {
  return (
    <label className="lfield">
      <span className="lf-label">{label}{hint ? <i> · {hint}</i> : null}</span>
      {children}
    </label>
  );
}

function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o} type="button" className={value === o ? 'on' : ''} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

function MetaField({ label, prefix, suffix, value, onChange }) {
  return (
    <label className="meta-field">
      <span className="mf-label">Meta {label}</span>
      <div className="lf-in">
        {prefix ? <span className="affix-l">{prefix}</span> : null}
        <input className="mono" inputMode="decimal" value={value}
               onFocus={(e) => { try { e.target.select(); } catch (_) {} }}
               onChange={(e) => onChange(e.target.value)} />
        {suffix ? <span className="affix-r">{suffix}</span> : null}
      </div>
    </label>
  );
}

// Conector do Mercado Livre por conta — compacto, dentro do cadastro do cliente.
// Só aparece para contas Mercado Livre já salvas (que têm id).
function MeliConnect({ accId, marketplace }) {
  const [st, setSt] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [link, setLink] = React.useState(null);
  const [copied, setCopied] = React.useState(false);
  const live = !!(window.P4_API && window.P4_API.isLogged());

  const refresh = React.useCallback(() => {
    if (!live || !accId) { setSt({ connected: false, configured: false }); return; }
    window.P4_API.meliStatus(accId).then(setSt).catch(() => setSt({ connected: false, configured: false }));
  }, [accId, live]);
  React.useEffect(() => { setLink(null); setCopied(false); refresh(); }, [refresh]);

  const connect = async () => {
    setBusy(true);
    try { const r = await window.P4_API.meliConnect(accId); window.location.href = r.url; }
    catch (e) { alert(e.message || 'Falha ao conectar'); setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm('Desconectar esta conta do Mercado Livre?')) return;
    setBusy(true);
    try { await window.P4_API.meliDisconnect(accId); setLink(null); refresh(); }
    catch (e) { alert(e.message || 'Falha'); } finally { setBusy(false); }
  };
  const genLink = async () => {
    setBusy(true); setCopied(false);
    try { const r = await window.P4_API.meliConnectLink(accId); setLink(r.url); }
    catch (e) { alert(e.message || 'Falha ao gerar link'); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch (e) { /* o usuário pode selecionar e copiar manualmente */ }
  };

  if (marketplace !== 'Mercado Livre') return null;

  const box = { marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--line)' };
  const row = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' };
  const badge = { width: 20, height: 20, borderRadius: 5, background: '#FFE600', color: '#2D3277', fontWeight: 800, fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' };
  const head = { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600 };
  const sm = { padding: '6px 12px', fontSize: 12.5 };

  if (!accId) {
    return (
      <div style={box}>
        <div style={row}>
          <span style={head}><span style={badge}>ML</span> Integração Mercado Livre</span>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>Salve o cliente para conectar esta conta.</span>
        </div>
      </div>
    );
  }
  if (!live || st == null) return null;

  return (
    <div style={box}>
      <div style={row}>
        <span style={head}><span style={badge}>ML</span> Integração Mercado Livre</span>
        {st.connected ? (
          <>
            <span style={{ color: 'var(--green-ink,#2f9a2b)', fontWeight: 700, fontSize: 12 }}>● Conectado{st.nickname ? ' · ' + st.nickname : ''}</span>
            <button type="button" className="btn-line" style={sm} disabled={busy} onClick={disconnect}>Desconectar</button>
          </>
        ) : st.configured ? (
          <>
            <button type="button" className="btn-accent" style={sm} disabled={busy} onClick={genLink}>{busy ? 'Gerando…' : 'Gerar link p/ o cliente'}</button>
            <button type="button" className="btn-line" style={sm} disabled={busy} onClick={connect}>Conectar eu mesmo</button>
          </>
        ) : (
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>Integração não configurada no servidor.</span>
        )}
      </div>

      {link ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...row, gap: 8 }}>
            <input readOnly value={link} onFocus={(e) => { try { e.target.select(); } catch (_) {} }}
                   style={{ flex: 1, minWidth: 240, border: '1px solid var(--line,#e9ece9)', borderRadius: 9, padding: '8px 11px', fontSize: 12, fontFamily: "'JetBrains Mono',monospace", background: '#fff', color: 'inherit' }} />
            <button type="button" className="btn-accent" style={sm} onClick={copy}>{copied ? 'Copiado! ✓' : 'Copiar'}</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            Envie este link ao cliente (dono da conta). Ele faz login no Mercado Livre dele e autoriza — não precisa ter acesso ao sistema. Válido por 7 dias.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NewClient({ user, role, client, users, onBack, onLogout, onManageUsers, onSave, onDelete, toast }) {
  const I = window.Icons;
  const editing = !!client;
  const ALL = window.P4_AD_MARKETPLACES || [];
  const analistas = (users || window.P4_USERS || []).filter((u) => u.papel === 'analista');
  const metaStr = (v) => (typeof v === 'number' ? v.toFixed(2).replace('.', ',') : (v || ''));
  const blankConta = () => ({ marketplace: '', conta: '', metaInvestimento: '20,00', metaRoas: '4,00', metaAcos: '20,00', metaTacos: '15,00' });

  const [loja, setLoja] = React.useState(client ? client.loja : '');
  const [tipo, setTipo] = React.useState(client ? client.tipo : 'Loja');
  const [analista, setAnalista] = React.useState(client ? client.analista : (role === 'analista' ? user.nome : ''));
  const [contas, setContas] = React.useState(client
    ? client.contas.map((m) => ({ id: m.id, marketplace: m.marketplace, conta: m.conta || '', metaInvestimento: metaStr(m.metaInvestimento) || '20,00', metaRoas: metaStr(m.metaRoas) || '4,00', metaAcos: metaStr(m.metaAcos) || '20,00', metaTacos: metaStr(m.metaTacos) || '15,00' }))
    : [blankConta()]);
  const [freq, setFreq] = React.useState(client && client.agenda ? client.agenda.freq : 'Semanal');
  const [diaSemana, setDiaSemana] = React.useState(client && client.agenda && client.agenda.diaSemana ? client.agenda.diaSemana : 'Segunda');
  const [diaMes, setDiaMes] = React.useState(client && client.agenda && client.agenda.diaMes ? String(client.agenda.diaMes) : '5');
  const [observacoes, setObservacoes] = React.useState(client ? (client.observacoes || '') : '');
  const [touched, setTouched] = React.useState(false);

  const setConta = (i, patch) => setContas((arr) => arr.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addConta = () => setContas((arr) => [...arr, blankConta()]);
  const removeConta = (i) => setContas((arr) => arr.filter((_, j) => j !== i));

  const validMks = contas.filter((c) => c.marketplace);
  const canSave = loja.trim() && analista && validMks.length > 0;

  const save = () => {
    setTouched(true);
    if (!canSave) { toast('Preencha nome, analista e ao menos um marketplace'); return; }
    onSave({
      id: client ? client.id : null,
      loja: loja.trim(),
      tipo,
      analista,
      // contas completas (id existente + apelido + metas) para o backend persistir
      contas: validMks.map((c) => ({
        id: c.id,
        marketplace: c.marketplace,
        conta: c.conta,
        metaInvestimento: c.metaInvestimento,
        metaRoas: c.metaRoas,
        metaAcos: c.metaAcos,
        metaTacos: c.metaTacos,
      })),
      marketplaces: validMks.map((c) => c.marketplace), // compat com o modo protótipo
      agenda: freq === 'Mensal' ? { freq, diaMes: parseInt(diaMes, 10) || 1 } : { freq, diaSemana },
      observacoes,
    });
  };

  return (
    <div className="shell">
      <window.TopBar title={editing ? 'Editar cliente' : 'Novo cliente'} user={user} role={role} onBack={onBack} onLogout={onLogout} onManageUsers={onManageUsers} />
      <div className="page">
        <div className="page-inner" style={{ maxWidth: 780 }}>

          <div className="hh" style={{ marginBottom: 20 }}>
            <div className="hh-id">
              <div className="crumb"><span onClick={onBack} style={{ cursor: 'pointer' }}>Clientes</span> / {editing ? 'Editar' : 'Novo cliente'}</div>
              <h1>{editing ? client.loja : 'Cadastrar cliente'}</h1>
              <div className="meta"><span>{editing ? 'Atualize os dados, metas e marketplaces deste cliente.' : 'Agrupe todos os marketplaces deste cliente em um único cadastro.'}</span></div>
            </div>
          </div>

          <div className="form-card">
            <div className="form-sec">
              <div className="form-sec-head"><span className="mono">01</span> Identificação</div>
              <div className="form-grid">
                <LField label="Nome do cliente">
                  <div className={'lf-in' + (touched && !loja.trim() ? ' err' : '')}>
                    <input placeholder="Ex.: Casa & Conforto" value={loja} onChange={(e) => setLoja(e.target.value)} />
                  </div>
                </LField>
                <LField label="Tipo">
                  <Seg value={tipo} options={['Loja', 'Marca']} onChange={setTipo} />
                </LField>
                <LField label="Analista responsável" hint="quem gera os relatórios">
                  <div className={'lf-in is-select' + (touched && !analista ? ' err' : '')}>
                    <select value={analista} onChange={(e) => setAnalista(e.target.value)} disabled={role === 'analista'}>
                      <option value="">Selecione…</option>
                      {analistas.map((a) => <option key={a.id} value={a.nome}>{a.nome}</option>)}
                    </select>
                    <span className="sel-caret">▾</span>
                  </div>
                </LField>
              </div>
            </div>

            <div className="form-sec">
              <div className="form-sec-head"><span className="mono">02</span> Marketplaces
                <span className="form-sec-note">fazemos ads em ML, Shopee, Magalu, Amazon e Tiktok</span>
              </div>

              {contas.map((c, i) => {
                // Todos os marketplaces ficam disponíveis — um cliente pode ter
                // mais de uma conta no mesmo marketplace (diferencie pelo apelido).
                const opts = ALL;
                return (
                  <div className="mk-card" key={i}>
                    <div className="mk-card-top">
                      <div className={'lf-in is-select mk-pick' + (touched && !c.marketplace && validMks.length === 0 ? ' err' : '')}>
                        <select value={c.marketplace} onChange={(e) => setConta(i, { marketplace: e.target.value })}>
                          <option value="">Selecione o marketplace…</option>
                          {opts.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <span className="sel-caret">▾</span>
                      </div>
                      <div className="lf-in mk-acct-id">
                        <input placeholder="apelido ou ID do seller" value={c.conta} onChange={(e) => setConta(i, { conta: e.target.value })} />
                      </div>
                      <button type="button" className="iconbtn danger" title="Remover" disabled={contas.length === 1}
                              onClick={() => removeConta(i)} style={contas.length === 1 ? { opacity: .35, cursor: 'not-allowed' } : null}>
                        <I.trash />
                      </button>
                    </div>
                    <div className="mk-metas">
                      <MetaField label="Investimento" prefix="R$" value={c.metaInvestimento} onChange={(v) => setConta(i, { metaInvestimento: v })} />
                      <MetaField label="ROAS" suffix="x" value={c.metaRoas} onChange={(v) => setConta(i, { metaRoas: v })} />
                      <MetaField label="ACOS" suffix="%" value={c.metaAcos} onChange={(v) => setConta(i, { metaAcos: v })} />
                      <MetaField label="TACOS" suffix="%" value={c.metaTacos} onChange={(v) => setConta(i, { metaTacos: v })} />
                    </div>
                    {c.marketplace === 'Mercado Livre' ? <MeliConnect accId={c.id} marketplace={c.marketplace} /> : null}
                  </div>
                );
              })}

              <button type="button" className="add-mk" onClick={addConta}>
                <I.plus size={15} /> Adicionar marketplace
              </button>
            </div>

            <div className="form-sec">
              <div className="form-sec-head"><span className="mono">03</span> Envio do feedback
                <span className="form-sec-note">quando o relatório deve ser enviado ao cliente</span>
              </div>
              <div className="sched-grid">
                <LField label="Frequência">
                  <Seg value={freq} options={['Semanal', 'Quinzenal', 'Mensal']} onChange={setFreq} />
                </LField>
                {freq === 'Mensal'
                  ? (
                    <LField label="Dia do mês" hint="1 a 28">
                      <div className="lf-in">
                        <input className="mono" inputMode="numeric" value={diaMes}
                               onChange={(e) => setDiaMes(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                               onBlur={() => setDiaMes((d) => String(Math.min(28, Math.max(1, parseInt(d, 10) || 1)))) } />
                      </div>
                    </LField>
                  )
                  : (
                    <LField label="Dia da semana">
                      <div className="wd-row">
                        {(window.P4_WEEKDAYS || []).map((d) => (
                          <button key={d} type="button" className={'wd-chip' + (diaSemana === d ? ' on' : '')} onClick={() => setDiaSemana(d)}>
                            {(window.P4_WEEKDAYS_SHORT || {})[d] || d}
                          </button>
                        ))}
                      </div>
                    </LField>
                  )}
              </div>
              <div className="sched-preview">
                <I.cal size={15} />
                <span>{window.agendaLabel(freq === 'Mensal' ? { freq, diaMes } : { freq, diaSemana })}</span>
              </div>
            </div>

            <div className="form-sec">
              <div className="form-sec-head"><span className="mono">04</span> Observações
                <span className="form-sec-note">anotações livres da equipe sobre este cliente</span>
              </div>
              <textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Ex.: contato preferencial, particularidades, histórico, próximos passos…"
                rows="4"
                style={{ width: '100%', padding: '11px 13px', borderRadius: 10, border: '1px solid var(--line)', fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', background: '#fff', color: 'inherit' }}
              />
            </div>
          </div>

          <div className="form-foot">
            {editing
              ? <button className="btn-line danger-line" onClick={() => onDelete && onDelete(client)} style={{ marginRight: 'auto' }}><I.trash /> Excluir cliente</button>
              : null}
            <button className="btn-line" onClick={onBack}>Cancelar</button>
            <button className="btn-accent" onClick={save}>
              {editing ? <I.edit size={16} /> : <I.plus size={16} />}
              {editing ? 'Salvar alterações' : 'Salvar cliente'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

window.NewClient = NewClient;
