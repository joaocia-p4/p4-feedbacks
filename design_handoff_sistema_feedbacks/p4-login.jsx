// p4-login.jsx — login screen (e-mail + senha + Google). Accounts are created by
// an admin, so there is no open sign-up — only a "forgot password" link.

function Login({ onLogin }) {
  const I = window.Icons;
  const [email, setEmail] = React.useState('');
  const [senha, setSenha] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [lembrar, setLembrar] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const resolveUser = () => {
    const e = email.trim().toLowerCase();
    return (window.P4_USERS || []).find((u) => u.email === e);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) { setErr('Informe seu e-mail.'); return; }
    if (!senha.trim()) { setErr('Informe sua senha.'); return; }
    setErr(''); setBusy(true);

    // 1) tenta autenticar no backend de verdade
    if (window.P4_API) {
      try {
        const u = await window.P4_API.login(email.trim(), senha);
        setBusy(false);
        onLogin(u);
        return;
      } catch (apiErr) {
        if (apiErr && apiErr.status) {
          // backend respondeu (ex.: 401) → credenciais inválidas
          setBusy(false);
          setErr(apiErr.message || 'E-mail ou senha inválidos.');
          return;
        }
        // sem status = falha de rede → segue para o modo protótipo
      }
    }

    // 2) fallback protótipo (backend offline): aceita qualquer senha
    const u = resolveUser() || window.P4_USERS[0];
    setBusy(false);
    onLogin(u);
  };

  const Check = () => (
    <span className="fi"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
  );

  return (
    <div className="login">
      <aside className="login-aside">
        <div className="la-top">
          <img src="assets/p4-mark-white.png" alt="P4" />
          <span className="la-brand">Método P4</span>
        </div>
        <div className="la-mid">
          <div className="la-tag">Sistema de Feedbacks</div>
          <h2 className="la-head">Relatórios de performance dos seus clientes, sob controle.</h2>
          <ul className="la-feats">
            <li><Check /> Relatórios automáticos e padronizados</li>
            <li><Check /> Integração com o Mercado Livre</li>
            <li><Check /> Acompanhamento de metas e prazos de envio</li>
          </ul>
        </div>
        <div className="la-foot">Método P4 · Performance em marketplaces</div>
      </aside>

      <main className="login-main">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <img src="assets/p4-mark-white.png" alt="P4" />
          <div>
            <div className="lb-tag">Método P4</div>
            <div className="lb-name">Sistema de Relatórios</div>
          </div>
        </div>

        <h1>Bem-vindo de volta</h1>
        <p className="sub">Entre para gerar e acompanhar os relatórios dos seus clientes.</p>

        {err ? <div className="login-err"><span>⚠</span>{err}</div> : null}

        <label className="field">
          <span className="field-label">E-mail</span>
          <div className="field-in">
            <span className="ic"><I.mail size={16} /></span>
            <input type="email" autoComplete="username" placeholder="voce@metodop4.com"
                   value={email} onChange={(e) => { setEmail(e.target.value); setErr(''); }} />
          </div>
        </label>

        <label className="field">
          <span className="field-label">Senha</span>
          <div className="field-in">
            <span className="ic"><I.lock size={16} /></span>
            <input type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••"
                   value={senha} onChange={(e) => { setSenha(e.target.value); setErr(''); }} />
            <button type="button" className="pw-eye" onClick={() => setShow((s) => !s)} aria-label="Mostrar senha">
              {show ? <I.eyeOff size={17} /> : <I.eye size={17} />}
            </button>
          </div>
        </label>

        <div className="login-row">
          <label className="login-check">
            <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
            <span className="box"></span>
            Manter conectado
          </label>
          <a className="link" onClick={() => alert('Para redefinir sua senha, fale com o administrador do sistema.')}>Esqueci a senha</a>
        </div>

        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>

        <div className="login-foot">
          As contas são criadas pelo administrador.<br />
          Precisa de acesso? <a className="link" onClick={() => alert('Fale com o administrador do sistema.')}>Solicitar convite</a>
        </div>
      </form>
      </main>
    </div>
  );
}

window.Login = Login;
