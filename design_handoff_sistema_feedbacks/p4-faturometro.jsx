// p4-faturometro.jsx — Faturômetro: faturamento da carteira ao vivo (só admin).
// Consulta GET /faturometro a cada 30s; o backend responde do banco e conserta o
// que faltar em segundo plano, então a tela nunca espera o Mercado Livre.

const FAT_POLL_MS = 30000;

window.MESES_LONGOS = window.MESES_LONGOS || [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function brMoeda(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function brNum(n) {
  return (Number(n) || 0).toLocaleString('pt-BR');
}
// Variação como chip: null vira "—" (sem base de comparação), nunca "+∞".
function VarChip({ v }) {
  if (v == null) return <span className="fat-var fat-var-nd">—</span>;
  const pos = v >= 0;
  return (
    <span className={'fat-var ' + (pos ? 'fat-var-up' : 'fat-var-down')}>
      {pos ? '+' : ''}{(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
    </span>
  );
}

// Número grande que TRANSICIONA quando muda. Sem animação perpétua: o relógio
// correndo já comunica "ao vivo", e animação infinita distrai.
function BigNumber({ valor }) {
  const [piscou, setPiscou] = React.useState(false);
  const anterior = React.useRef(valor);
  React.useEffect(() => {
    if (anterior.current !== valor) {
      anterior.current = valor;
      setPiscou(true);
      const t = setTimeout(() => setPiscou(false), 600);
      return () => clearTimeout(t);
    }
  }, [valor]);
  return <div className={'fat-big' + (piscou ? ' fat-big-mudou' : '')}>{brMoeda(valor)}</div>;
}

function Metrica({ label, valor, chip }) {
  return (
    <div className="fat-metrica">
      <span className="fat-metrica-lbl">{label}</span>
      <b className="fat-metrica-val">{valor}{chip || null}</b>
    </div>
  );
}

function Faturometro({ user, role, onLogout, onManageUsers, onOpenClient, toast }) {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState('');
  const [relogio, setRelogio] = React.useState(() => new Date());
  const [atualizadoEm, setAtualizadoEm] = React.useState(null);
  const [forcando, setForcando] = React.useState(false);

  // Relógio de parede — é o que dá a sensação de "ao vivo" sem animação infinita.
  React.useEffect(() => {
    const t = setInterval(() => setRelogio(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Guarda de desmonte que `carregar` de fato enxerga (uma variável local ao
  // efeito de polling não alcança este callback, que sobrevive à requisição
  // em voo). Reataca `true` a cada montagem — inclusive a remontagem "fake"
  // do StrictMode em dev — e vira `false` só no cleanup.
  const vivoRef = React.useRef(true);
  React.useEffect(() => {
    vivoRef.current = true;
    return () => { vivoRef.current = false; };
  }, []);

  const carregar = React.useCallback(async () => {
    try {
      if (!window.P4_API || !window.P4_API.isLogged()) throw new Error('Faça login para ver o Faturômetro.');
      const d = await window.P4_API.getFaturometro();
      if (!vivoRef.current) return; // desmontou enquanto a requisição estava em voo
      setData(d);
      setAtualizadoEm(new Date());
      setErr('');
    } catch (e) {
      if (!vivoRef.current) return;
      // Erro não apaga o último número: a tela envelhece o selo em vez de zerar.
      setErr(e.message || 'Falha ao atualizar.');
    }
  }, []);

  // Polling pausado com a aba em segundo plano — não faz sentido consultar
  // (e gastar chamada) uma tela que ninguém está olhando. Um único
  // agendador: nunca há mais de um `setTimeout` pendente por vez — ao voltar
  // o foco, `aoVoltar` cancela o tique agendado e reentra no `ciclo` na hora,
  // em vez de deixar os dois brigarem por qual `setState` chega por último.
  React.useEffect(() => {
    let timer = null;
    const ciclo = async () => {
      if (!vivoRef.current) return;
      if (!document.hidden) await carregar();
      if (!vivoRef.current) return; // desmontou durante o await acima
      timer = setTimeout(ciclo, FAT_POLL_MS);
    };
    const aoVoltar = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      ciclo();
    };
    ciclo();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', aoVoltar); };
  }, [carregar]);

  const forcar = async () => {
    setForcando(true);
    try {
      await window.P4_API.reconciliarFaturometro();
      toast('Conferindo todas as contas — o número se ajusta em instantes.');
    } catch (e) { toast(e.message || 'Não foi possível forçar a conferência.'); }
    finally { setForcando(false); }
  };

  const h = (data && data.hoje) || {};
  const m = (data && data.mes) || {};
  const contas = (data && data.contas) || {};
  const clientes = (data && data.clientes) || [];
  const fresco = !err && atualizadoEm && Date.now() - atualizadoEm.getTime() < FAT_POLL_MS * 2;
  const mesLbl = m.ym ? window.MESES_LONGOS[+m.ym.slice(5, 7) - 1] : '';

  return (
    <div className="shell">
      <window.TopBar title="Faturômetro" user={user} role={role} onLogout={onLogout} onManageUsers={onManageUsers} />
      <div className="page">
        <div className="page-inner">

          <div className="fat-hero">
            <h1>Vendas de hoje ao vivo</h1>
            <div className="fat-pill">
              <span className={'fat-dot' + (fresco ? '' : ' fat-dot-off')}></span>
              {fresco
                ? relogio.toLocaleString('pt-BR', { day: 'numeric', month: 'long' }) + ', ' + relogio.toLocaleTimeString('pt-BR')
                : 'atualizado às ' + (atualizadoEm ? atualizadoEm.toLocaleTimeString('pt-BR') : '—')}
            </div>
            <div className="fat-hero-card">
              {data ? <BigNumber valor={h.faturamento} /> : <div className="fat-big fat-big-load">carregando…</div>}
              <div className="fat-hero-sub">
                vs ontem até {relogio.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · <VarChip v={h.variacao} />
              </div>
            </div>
          </div>

          <div className="fat-contexto">
            <span>{brNum(contas.conectadas)} contas conectadas</span>
            {contas.comErro ? <a className="fat-alerta" href="#fat-clientes">{contas.comErro} precisam reconectar</a> : null}
            <button className="btn-ghost" onClick={forcar} disabled={forcando}>
              {forcando ? 'conferindo…' : 'Conferir agora'}
            </button>
          </div>

          <div className="fat-grid">
            <div className="card">
              <b style={{ fontSize: 14 }}>Métricas-chave</b>
              <div className="fat-metricas">
                <Metrica label="Quantidade de vendas" valor={brNum(h.pedidos)} />
                <Metrica label="Total de compradores" valor={brNum(h.compradores)} />
                <Metrica label="Unidades vendidas" valor={brNum(h.unidades) + ' u.'} />
                <Metrica label="Preço médio" valor={brMoeda(h.precoMedio)} />
                <Metrica label={'Mês até agora' + (mesLbl ? ' · ' + mesLbl : '')} valor={brMoeda(m.faturamento)} />
                <Metrica
                  label={m.anteriorParcial === false ? 'vs mês anterior inteiro' : 'vs mês passado'}
                  valor={<VarChip v={m.variacao} />}
                />
              </div>
            </div>

            <window.FatChart serie={(data && data.porHora) || []} horaAtual={relogio.getHours()} />
          </div>

          <div className="card" id="fat-clientes" style={{ marginTop: 18 }}>
            <b style={{ fontSize: 14 }}>Por cliente</b>
            <window.FatClientes clientes={clientes} onOpenClient={onOpenClient} />
          </div>

          {data && data.backfill && !data.backfill.pronto
            ? <window.FatBackfill backfill={data.backfill} />
            : null}

        </div>
      </div>
    </div>
  );
}
window.Faturometro = Faturometro;
