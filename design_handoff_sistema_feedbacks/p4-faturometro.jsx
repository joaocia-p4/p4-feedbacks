// p4-faturometro.jsx — Faturômetro: faturamento da carteira ao vivo (só admin).
// Consulta GET /faturometro a cada 30s; o backend responde do banco e conserta o
// que faltar em segundo plano, então a tela nunca espera o Mercado Livre.

const FAT_POLL_MS = 30000;

// Fuso do NEGÓCIO (o mesmo BUSINESS_TZ do backend). "Hoje", "ontem até agora" e
// a curva por hora são todos cortados em São Paulo lá; a tela precisa mostrar a
// MESMA hora, senão um navegador em outro fuso exibe um rótulo que não bate com
// o número ao lado.
const FAT_TZ = 'America/Sao_Paulo';

function horaDoNegocio(d, comSegundos) {
  if (!d) return '—';
  const opts = { timeZone: FAT_TZ, hour: '2-digit', minute: '2-digit' };
  if (comSegundos) opts.second = '2-digit';
  return d.toLocaleTimeString('pt-BR', opts);
}
function dataDoNegocio(d) {
  return d.toLocaleDateString('pt-BR', { timeZone: FAT_TZ, day: 'numeric', month: 'long' });
}
// Hora cheia (0-23) no fuso do negócio — é o índice da curva por hora, que o
// backend monta com o mesmo critério.
function horaCheiaDoNegocio(d) {
  const h = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: FAT_TZ, hour: '2-digit', hourCycle: 'h23',
  }).format(d));
  return isNaN(h) ? 0 : h;
}

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

// Curva por hora, Hoje × Ontem. SVG à mão, no padrão do MiniLineChart de
// report.jsx — o front não tem build step e não traz biblioteca de gráfico.
//
// As duas séries se distinguem por ESTILO DE LINHA (sólida × tracejada), não só
// por cor: é o que mantém o gráfico legível para daltônicos. Não troque o
// tracejado por uma segunda cor sólida.
function FatChart({ serie, horaAtual }) {
  const W = 720;
  const H = 260;
  const PL = 54; // respiro à esquerda para os rótulos do eixo Y
  const PB = 26;
  const PT = 12;
  const dados = serie && serie.length === 24 ? serie : Array.from({ length: 24 }, (_, h) => ({ h, hoje: 0, ontem: 0 }));
  const max = Math.max(1, ...dados.map((d) => Math.max(d.hoje, d.ontem)));

  const x = (h) => PL + (h / 23) * (W - PL - 10);
  const y = (v) => PT + (1 - v / max) * (H - PT - PB);
  const linha = (campo, ate) => dados
    .filter((d) => (ate == null ? true : d.h <= ate))
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(d.h).toFixed(1)},${y(d[campo]).toFixed(1)}`)
    .join(' ');

  const hojeAte = Math.min(23, Math.max(0, horaAtual == null ? 23 : horaAtual));
  // Busca por `h` (não por índice): mesmo critério já usado por `linha()` e
  // pelas faixas de tooltip — não assume que `dados[i].h === i`.
  const pontoHoje = dados.find((d) => d.h === hojeAte) || { hoje: 0 };
  const areaHoje = `${linha('hoje', hojeAte)} L${x(hojeAte).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const compacto = (v) => v >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : String(Math.round(v));

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b style={{ fontSize: 14 }}>Tendências em vendas brutas</b>
        <span style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', gap: 12 }}>
          <span><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="var(--brand)" strokeWidth="2.5" /></svg> Hoje</span>
          <span><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="var(--muted)" strokeWidth="2.5" strokeDasharray="5 4" /></svg> Ontem</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 10 }} role="img"
        aria-label={`Faturamento por hora. Hoje acumula ${dados.reduce((s, d) => s + d.hoje, 0).toFixed(2)} reais; ontem, ${dados.reduce((s, d) => s + d.ontem, 0).toFixed(2)}.`}>
        {marcas.map((v, i) => (
          <g key={i}>
            <line x1={PL} y1={y(v)} x2={W - 10} y2={y(v)} stroke="var(--line)" strokeDasharray="3 4" />
            <text x={PL - 8} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{compacto(v)}</text>
          </g>
        ))}
        <path d={areaHoje} fill="var(--brand)" opacity=".2" />
        <path d={linha('ontem')} fill="none" stroke="var(--muted)" strokeWidth="2.5" strokeDasharray="5 4" strokeLinejoin="round" />
        <path d={linha('hoje', hojeAte)} fill="none" stroke="var(--brand)" strokeWidth="2.8" strokeLinejoin="round" />
        <circle cx={x(hojeAte)} cy={y(pontoHoje.hoje)} r="5" fill="var(--brand)" stroke="#fff" strokeWidth="2.5" />
        {dados.filter((d) => d.h % 2 === 0).map((d) => (
          <text key={d.h} x={x(d.h)} y={H - 6} textAnchor="middle" fontSize="10.5" fill="var(--muted)">
            {String(d.h).padStart(2, '0')}
          </text>
        ))}
        {/* faixas invisíveis por hora: dão o tooltip nativo sem JS de hover */}
        {dados.map((d) => (
          <rect key={'t' + d.h} x={x(d.h) - 8} y={PT} width="16" height={H - PT - PB} fill="transparent">
            <title>{`${String(d.h).padStart(2, '0')}h — hoje ${brMoeda(d.hoje)} · ontem ${brMoeda(d.ontem)}`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
window.FatChart = FatChart;

// Lista por cliente. Quem não vendeu hoje vai para o fim, zerado e em cinza —
// zero é resposta legítima, não erro.
function FatClientes({ clientes, onOpenClient }) {
  if (!clientes || !clientes.length) {
    return (
      <div style={{ padding: '28px 8px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Nenhuma conta do Mercado Livre conectada ainda.<br />
        Conecte uma conta na tela do cliente para o Faturômetro começar a contar.
      </div>
    );
  }
  return (
    <table className="fat-tab">
      <thead>
        <tr><th>Cliente</th><th>Hoje</th><th>Mês</th><th>vs mês passado</th></tr>
      </thead>
      <tbody>
        {clientes.map((c) => (
          <tr key={c.clienteId} className={c.hoje ? '' : 'fat-zerado'} onClick={() => onOpenClient && onOpenClient(c.clienteId)}>
            <td>
              {c.cliente}
              {c.contas > 1 ? <span className="fat-chip fat-chip-neutro">{c.contas} contas</span> : null}
              {/* "reconectar" é o conselho, não o diagnóstico: nem toda falha é
                  token expirado. O motivo real vem em `c.erro` e ia embora sem
                  ser mostrado — o title devolve ele a quem passar o mouse. */}
              {c.erro ? <span className="fat-chip" title={c.erro}>reconectar</span> : null}
            </td>
            <td>{brMoeda(c.hoje)}</td>
            <td>{brMoeda(c.mes)}</td>
            <td><VarChip v={c.variacaoMes} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
window.FatClientes = FatClientes;

// Aviso de histórico em construção. O backfill do mês corrente e do anterior são
// milhares de chamadas ao ML: roda em lotes, em segundo plano, e a tela já é útil
// desde o primeiro lote (hoje) — este aviso explica por que o mês ainda cresce.
function FatBackfill({ backfill }) {
  const pc = Math.round((backfill.progresso || 0) * 100);
  return (
    <div className="fat-backfill">
      Montando histórico… {pc}%{backfill.etapa ? ' · ' + backfill.etapa : ''}
      <div className="fat-backfill-bar"><div style={{ width: pc + '%' }}></div></div>
      <div style={{ marginTop: 6, fontWeight: 500, color: 'var(--muted)' }}>
        Os números de hoje já estão corretos. Os totais do mês e as comparações crescem conforme o histórico é montado.
      </div>
    </div>
  );
}
window.FatBackfill = FatBackfill;

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
  // O instante do CORTE é o do servidor (vem no payload), não o do navegador: é
  // ele que define até onde "ontem até agora" foi somado e até onde a curva de
  // hoje vai. Sem payload ainda, cai no relógio local só para não ficar vazio.
  const agoraServidor = data && data.agora ? new Date(data.agora) : relogio;

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
                ? dataDoNegocio(relogio) + ', ' + horaDoNegocio(relogio, true)
                : 'atualizado às ' + horaDoNegocio(atualizadoEm, true)}
            </div>
            <div className="fat-hero-card">
              {data
                ? <BigNumber valor={h.faturamento} />
                : <div className="fat-big fat-big-load">{err ? '—' : 'carregando…'}</div>}
              {/* O erro precisa VIRAR TEXTO: sem isso, uma primeira carga que
                  falha deixa a tela em "carregando…" para sempre, sem explicação. */}
              {err ? <div className="fat-erro" role="status">{err}</div> : null}
              <div className="fat-hero-sub">
                vs ontem até {horaDoNegocio(agoraServidor)} · <VarChip v={h.variacao} />
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

            <window.FatChart serie={(data && data.porHora) || []} horaAtual={horaCheiaDoNegocio(agoraServidor)} />
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
