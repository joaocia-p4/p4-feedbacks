// p4-settings.jsx — página de Configurações: conta, aparência, equipe, integrações, sobre.

function Settings({ user, role, accent, layout, onSetAccent, onSetLayout, onManageUsers, onLogout, toast }) {
  const I = window.Icons;
  const isAdmin = role === 'admin';
  const live = !!(window.P4_API && window.P4_API.isLogged());
  const accents = [
    { v: '#56D54F', n: 'Verde' },
    { v: '#2A6FDB', n: 'Azul' },
    { v: '#E0922F', n: 'Âmbar' },
    { v: '#7A5AE0', n: 'Roxo' },
  ];

  return (
    <div className="shell">
      <window.TopBar title="Configurações" user={user} role={role} onLogout={onLogout} onManageUsers={onManageUsers} />
      <div className="page">
        <div className="page-inner">
          <div className="ch-top">
            <div>
              <div className="ch-eyebrow">Preferências</div>
              <h1>Configurações</h1>
              <div className="ch-sub">Ajuste sua conta, a aparência do sistema e as integrações.</div>
            </div>
          </div>

          <div className="set-grid">
            {/* Conta */}
            <section className="set-card">
              <div className="set-h"><span className="set-ic"><I.user size={16} /></span><b>Conta</b></div>
              <div className="set-acct">
                <div className="set-av">{user.iniciais}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="set-acct-nm">{user.nome}</div>
                  <div className="set-acct-em">{user.email}</div>
                </div>
                <span className={'role-pill ' + role} style={{ marginLeft: 'auto', flex: 'none' }}>{role}</span>
              </div>
              <button className="btn-line" style={{ marginTop: 14 }} onClick={() => alert('Para alterar sua senha, fale com o administrador do sistema.')}>
                <I.lock size={15} /> Alterar senha
              </button>
            </section>

            {/* Aparência */}
            <section className="set-card">
              <div className="set-h"><span className="set-ic"><I.cog size={16} /></span><b>Aparência</b></div>
              <div className="set-row">
                <div>
                  <div className="set-row-t">Cor de destaque</div>
                  <div className="set-row-s">Usada em botões e indicadores.</div>
                </div>
                <div className="set-accs">
                  {accents.map((a) => (
                    <button key={a.v} className={'set-acc' + (accent === a.v ? ' on' : '')} title={a.n}
                            style={{ background: a.v }} onClick={() => onSetAccent(a.v)} aria-label={a.n} />
                  ))}
                </div>
              </div>
              <div className="set-row">
                <div>
                  <div className="set-row-t">Lista de clientes</div>
                  <div className="set-row-s">Como exibir os clientes na tela inicial.</div>
                </div>
                <div className="seg" style={{ width: 190, flex: 'none' }}>
                  <button className={layout === 'grade' ? 'on' : ''} onClick={() => onSetLayout('grade')}>Grade</button>
                  <button className={layout === 'lista' ? 'on' : ''} onClick={() => onSetLayout('lista')}>Lista</button>
                </div>
              </div>
            </section>

            {/* Equipe (admin) */}
            {isAdmin ? (
              <section className="set-card">
                <div className="set-h"><span className="set-ic"><I.users size={16} /></span><b>Equipe</b></div>
                <div className="set-row">
                  <div>
                    <div className="set-row-t">Usuários do sistema</div>
                    <div className="set-row-s">Adicione e gerencie analistas, CS e administradores.</div>
                  </div>
                  <button className="btn-line" style={{ flex: 'none' }} onClick={onManageUsers}><I.users size={15} /> Gerenciar</button>
                </div>
              </section>
            ) : null}

            {/* Integrações */}
            <section className="set-card">
              <div className="set-h"><span className="set-ic"><I.bolt size={16} /></span><b>Integrações</b></div>
              <div className="set-row">
                <div>
                  <div className="set-row-t">Mercado Livre</div>
                  <div className="set-row-s">A conexão é feita por cliente, na tela de edição de cada cliente.</div>
                </div>
                <span className="set-tag">por cliente</span>
              </div>
            </section>

            {/* Sobre */}
            <section className="set-card">
              <div className="set-h"><span className="set-ic"><I.bolt size={16} /></span><b>Sobre</b></div>
              <div className="set-about">
                <div className="set-kv"><span>Sistema</span><b>Feedbacks · Método P4</b></div>
                <div className="set-kv"><span>Conexão</span><b style={{ color: live ? 'var(--green-ink)' : 'var(--amber)' }}>{live ? 'Online (servidor)' : 'Demonstração'}</b></div>
                <div className="set-kv"><span>Gerador</span><a className="link" href="gerador.html" target="_blank" rel="noopener">Abrir ↗</a></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

window.Settings = Settings;
