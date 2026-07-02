# Redesign Tela de Clientes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar no código de produção o redesign aprovado (mockup v2) da Tela de Clientes: 3 regiões (header com stats inline → filtros → grade), card com bloco de **reputação do Mercado Livre** (skeleton + carga assíncrona), sem KPI-cards, sem `.duebar`, sem layout lista.

**Architecture:** Frontend estático (React 18 UMD + Babel standalone no browser, arquivos `.jsx` carregados via `<script type="text/babel">`, componentes expostos em `window.*`). Servido pelo Vercel a partir de `design_handoff_sistema_feedbacks/`; backend Express no Render; `git push` na main = deploy automático dos dois. A reputação vem de `window.P4_API.meliReputation(contaId)` (endpoint existente), buscada por card com lazy-load (IntersectionObserver), fila com concorrência limitada e cache de sessão.

**Tech Stack:** React 18 (UMD, sem build), Babel standalone, CSS puro em `index.html`, fontes Sora + JetBrains Mono. Sem framework de teste para o frontend — verificação é manual no browser (modo demo via `file:` e/ou backend local).

**Spec:** `docs/superpowers/specs/2026-07-01-redesign-tela-clientes-design.md` (aprovado). Mockup de referência: `design_handoff_sistema_feedbacks/_mockup-clientes.html` (v2, NÃO commitar — ver Task 1).

## Global Constraints

- Todo texto de UI em **pt-BR**, mesmo tom dos existentes (ex.: "Reputação indisponível", "Sem conta no Mercado Livre").
- **Sem imports/exports ES**: arquivos `.jsx` são scripts Babel; componentes/utilitários compartilhados vão em `window.*`; helpers de dados vêm de `window.*` (`agendaShort`, `brShort`, `mkBrand`, `mkBg`, `mkColor`, `isDueOn`, `weekdayName`, `P4_TODAY`, `P4_MK`, `P4_AD_MARKETPLACES`).
- **Tokens**: verde `#56D54F` (`var(--accent)`), tinta `#1C242E`, vermelho `#d8423a`, stage `#eceeec`, radius cards 15–16px, chips 999px, mono = JetBrains Mono. Cores de reputação do ML (não usar as do tema): `1_red #e53935`, `2_orange #ff7733`, `3_yellow #ffe600`, `4_light_green #7dd956`, `5_green #00a650`.
- Papéis: `admin` vê tudo/gerencia; `analista` só os seus/gerencia os seus; `cs` vê tudo, **somente leitura** (`canManage = admin || analista`; `seesAll = admin || cs`).
- Manter funcionando: menu "⋯" (importar/exportar em massa), `exportClients`, estados vazios, ordenação (encerrados por último; com filtro de envio ativo, atrasados primeiro).
- **NÃO** commitar `_mockup-clientes.html` (é mockup; se commitado, o Vercel o publica). Adicionar ao `.gitignore`.
- `git push` publica em produção — só fazer push na Task 6, após verificação local.

## File Structure

| Arquivo | Responsabilidade nesta mudança |
|---|---|
| `design_handoff_sistema_feedbacks/index.html` | Só CSS (bloco `<style>`): novos estilos (stats, toggle c/ contador, filtros c/ contagem, bloco de reputação + skeleton, filete de atraso), remoção de CSS morto (`.duebar`, `.clist`, `.due-hint`, `.due-late`), ajustes responsivos e de print |
| `design_handoff_sistema_feedbacks/p4-clients.jsx` | Tela de Clientes: infra de reputação (cache/fila/observer) + `ClientCardReputation` + `ClientCard` novo + `Clients` reescrito; remover `ClientRow` |
| `design_handoff_sistema_feedbacks/p4-shell.jsx` | Remover tweak `layout` (grade/lista) e o prop `layout` passado a `Clients`/`Settings` |
| `.gitignore` | Ignorar `_mockup-*.html` |
| `docs/superpowers/specs/...` e `docs/superpowers/plans/...` | Commitados na Task 1 |

**Não mexer:** `p4-history.jsx` (usa `.kpis`, `StatusTag`, `MkBadge` — continuam exportados), `p4-api.js`, `p4-data.jsx`, `backend/**`, `gerador.html`.

---

### Task 1: Commit de docs + ignorar mockup

**Files:**
- Modify: `.gitignore`
- Commit: `docs/superpowers/specs/2026-07-01-redesign-tela-clientes-design.md`, `docs/superpowers/plans/2026-07-01-redesign-tela-clientes.md`

- [ ] **Step 1: Adicionar mockups ao .gitignore**

Acrescentar ao final de `.gitignore`:

```gitignore
# mockups de design (não publicar no Vercel)
design_handoff_sistema_feedbacks/_mockup-*.html
```

- [ ] **Step 2: Conferir que o mockup sumiu do git status**

Run: `git status --short`
Expected: `_mockup-clientes.html` NÃO aparece; aparecem `.gitignore` e `docs/` como novos.

- [ ] **Step 3: Commit**

```bash
git add .gitignore docs/superpowers
git commit -m "docs(clientes): spec e plano do redesign da tela de clientes"
```

---

### Task 2: CSS do redesign (index.html)

**Files:**
- Modify: `design_handoff_sistema_feedbacks/index.html` (apenas o `<style>`)

**Interfaces:**
- Produces (classes que a Task 3/4 usam no JSX): `.ch-stats`, `.stat`(.ok/.late/.send), `.ch-actions`, `.due-toggle .cnt`, `.filters`, `.filters .div`, `.chip .c`, `.ccard.late`, `.rep`, `.rep-therm`, `.rep-seg`(.on), `.rep-txt`(.lvl/.medal), `.rep.muted`, `.rep-ic`, `.rep-connect`, `.rep.loading .sk`.

- [ ] **Step 1: Substituir o CSS do subtítulo do header (manter `.ch-sub` para o Settings)**

Localizar o bloco "clients header / toolbar" e, logo após a regra `.ch-sub b{...}`, **adicionar**:

```css
/* stats inline no header (redesign clientes) */
.ch-stats{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
.ch-stats .sep{color:#c4ccc4}
.stat{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:var(--ink)}
.stat .n{font-family:'JetBrains Mono',monospace;font-weight:700}
.stat .dt{width:7px;height:7px;border-radius:50%;background:#9aa39d}
.stat.ok .dt{background:var(--green)}
.stat.late{color:var(--red)}.stat.late .dt{background:var(--red)}
.stat.send{color:var(--green-ink)}.stat.send .dt{background:var(--green-ink)}
.stat.closed{color:var(--muted)}
.ch-actions{display:flex;gap:8px;align-items:center}
```

- [ ] **Step 2: Contador no toggle + linha de filtros com contagem**

Após a regra `.due-toggle.on svg{color:var(--accent)}`, **adicionar**:

```css
.due-toggle .cnt{font-family:'JetBrains Mono',monospace;font-weight:700;background:rgba(var(--accent-rgb),.16);color:var(--green-ink);padding:2px 7px;border-radius:6px;font-size:11px}
.due-toggle.on .cnt{background:rgba(var(--accent-rgb),.22);color:var(--accent)}

/* linha de chips de status + marketplace (com contagem) */
.filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:20px}
.filters .div{width:1px;height:22px;background:var(--line);margin:0 3px;flex:none}
.chip .c{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;opacity:.7}
```

- [ ] **Step 3: Remover CSS morto**

Remover integralmente estas regras (e nada mais):
- `.duebar{...}` (a regra do container; **manter** `.due-toggle`, `.due-date`, `.due-info`)
- `.due-hint{...}` e `.due-late{...}`
- Todo o bloco `/* ---- clients as list (tweak) ---- */`: `.clist{...}`, `.clist-row{...}`, `.clist-row:last-child`, `.clist-row:hover`, `.clist-row.head`, `.clist-row.head span`, `.clist .loja`, `.clist .an`, `.clist .num` e a regra órfã `.clist-row.is-closed{opacity:.6}` (fica acima de `.cc-head`)

Na regra de print, trocar:

```css
.app-side,.topbar,.twk-panel,[data-omelette-chrome],.toast,.no-print,.duebar,.toolbar{display:none !important}
```
por:
```css
.app-side,.topbar,.twk-panel,[data-omelette-chrome],.toast,.no-print,.toolbar,.filters{display:none !important}
```

- [ ] **Step 4: Card — filete de atraso, grid 310px e bloco de reputação**

Na regra `.cgrid`, trocar `minmax(296px,1fr)` por `minmax(310px,1fr)`.

Na regra `.ccard`, acrescentar `overflow:hidden` e, logo depois dela, **adicionar**:

```css
.ccard::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:transparent;transition:.16s}
.ccard.late::before{background:var(--red)}
```

Após a regra `.cc-count{...}` (fim do bloco do card), **adicionar**:

```css
/* ---- bloco de reputação (Mercado Livre) no card ---- */
.rep{display:flex;align-items:center;gap:12px;padding:13px;border-radius:13px;background:#f7f9f7;border:1px solid var(--line);margin-top:auto}
.rep-therm{display:flex;align-items:flex-end;gap:3px;flex:none}
.rep-seg{width:8px;height:15px;border-radius:3px;opacity:.28;transition:.15s}
.rep-seg.on{height:24px;opacity:1;box-shadow:0 3px 8px -3px currentColor}
.rep-txt{min-width:0;flex:1}
.rep-txt .lvl{font-size:13.5px;font-weight:700;line-height:1.15}
.rep-txt .medal{font-family:'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-top:3px;display:flex;align-items:center;gap:5px}
.rep-txt .medal svg{color:var(--amber)}
.rep.muted{background:#f4f5f4;border-style:dashed}
.rep-ic{width:34px;height:34px;border-radius:9px;background:#e9ece9;color:var(--muted);display:flex;align-items:center;justify-content:center;flex:none}
.rep.muted .lvl{font-size:12.5px;font-weight:600}
.rep.muted .medal{text-transform:none;letter-spacing:0;font-family:'Sora';font-size:11px}
.rep-connect{appearance:none;border:0;background:none;cursor:pointer;margin-left:auto;font-family:'Sora';font-size:11.5px;font-weight:700;color:var(--green-ink);display:inline-flex;align-items:center;gap:5px;flex:none;padding:4px}
.rep-connect:hover{text-decoration:underline}
/* skeleton de carregamento */
.rep .sk{background:linear-gradient(90deg,#e9ece9 25%,#f7f9f7 37%,#e9ece9 63%);background-size:400% 100%;animation:repsk 1.2s ease infinite;border-radius:6px}
@keyframes repsk{0%{background-position:100% 0}100%{background-position:0 0}}
```

- [ ] **Step 5: Responsivo**

Dentro do bloco existente `@media (max-width:720px){...}`, **adicionar**:

```css
  .ch-actions{width:100%}
  .ch-actions .btn-accent{flex:1;justify-content:center}
  .search{max-width:none}
```

- [ ] **Step 6: Verificar no browser**

Run: abrir `design_handoff_sistema_feedbacks/index.html` no browser (file:).
Expected: tela de login renderiza normal; console sem erros de CSS; nada visualmente quebrado (o JSX ainda é o antigo — as classes novas ainda não são usadas; as removidas deixam a lista antiga sem estilo, o que é esperado e será resolvido na Task 4).

- [ ] **Step 7: Commit**

```bash
git add design_handoff_sistema_feedbacks/index.html
git commit -m "ui(clientes): css do redesign (stats, filtros, reputacao, skeleton)"
```

---

### Task 3: Infra de reputação + componente `ClientCardReputation`

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-clients.jsx` (adicionar no topo, após `MkRow`)

**Interfaces:**
- Consumes: `window.P4_API.meliReputation(contaId)` → resolve `{ ok, colorLabel, levelId, powerSeller, nickname, ... }`; rejeita com `e.status` (400 = não conectado). `window.P4_API.isLogged()`.
- Produces: `ClientCardReputation({ client, canManage, onConnect })` — componente React; `window.ClientCardReputation` exportado. `client` é o objeto da lista (`contas[]` com `marketplace`, `id`, `ativo`; `encerrado`). `onConnect` é `() => void` ou `null`.

- [ ] **Step 1: Adicionar infra + componente**

Inserir em `p4-clients.jsx`, logo após a função `MkRow` (antes de `ClientCard`):

```jsx
// ---------------------------------------------------------------- reputação (Mercado Livre)
// Cache de sessão + fila com concorrência limitada: cada card busca a própria
// reputação quando entra na viewport (IntersectionObserver), no máx. 3 de cada vez.
const REP_LEVELS_UI = [
  { id: '1_red', hex: '#e53935' },
  { id: '2_orange', hex: '#ff7733' },
  { id: '3_yellow', hex: '#ffe600' },
  { id: '4_light_green', hex: '#7dd956' },
  { id: '5_green', hex: '#00a650' },
];
const REP_MEDALS = { platinum: 'MercadoLíder Platinum', gold: 'MercadoLíder Gold', silver: 'MercadoLíder' };
const repCache = {};            // contaId -> { state: 'ok'|'notconnected'|'error', rep? }
const repQueue = [];            // jobs pendentes
let repActive = 0;
const REP_MAX_CONCURRENT = 3;

function repPump() {
  while (repActive < REP_MAX_CONCURRENT && repQueue.length) {
    const job = repQueue.shift();
    repActive++;
    job().finally(() => { repActive--; repPump(); });
  }
}

function repFetch(contaId, cb) {
  if (repCache[contaId]) { cb(repCache[contaId]); return; }
  repQueue.push(async () => {
    let res;
    try {
      const d = await window.P4_API.meliReputation(contaId);
      res = (d && d.ok) ? { state: 'ok', rep: d } : { state: 'notconnected' };
    } catch (e) {
      res = (e && e.status === 400) ? { state: 'notconnected' } : { state: 'error' };
    }
    if (res.state !== 'error') repCache[contaId] = res; // erro não entra no cache (permite "tentar de novo")
    cb(res);
  });
  repPump();
}

function RepShield() {
  return (
    <span className="rep-ic">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3Z" /></svg>
    </span>
  );
}

function RepMuted({ title, sub, action, onAction }) {
  return (
    <div className="rep muted">
      <RepShield />
      <div className="rep-txt">
        <div className="lvl">{title}</div>
        <div className="medal">{sub}</div>
      </div>
      {action
        ? <button className="rep-connect" onClick={(e) => { e.stopPropagation(); onAction(); }}>{action} →</button>
        : null}
    </div>
  );
}

function ClientCardReputation({ client, canManage, onConnect }) {
  const live = !!(window.P4_API && window.P4_API.isLogged());
  const mlConta = (client.contas || []).find((m) => m.marketplace === 'Mercado Livre' && m.ativo !== false);
  const contaId = mlConta ? mlConta.id : null;
  const enabled = !!(live && contaId && !client.encerrado);
  const [st, setSt] = React.useState(() => (enabled && repCache[contaId]) ? repCache[contaId] : { state: 'loading' });
  const ref = React.useRef(null);

  // lazy-load: só busca quando o bloco entra na viewport
  React.useEffect(() => {
    if (!enabled || st.state !== 'loading') return;
    let cancel = false;
    const load = () => repFetch(contaId, (res) => { if (!cancel) setSt(res); });
    const el = ref.current;
    if (el && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { io.disconnect(); load(); }
      }, { rootMargin: '120px' });
      io.observe(el);
      return () => { cancel = true; io.disconnect(); };
    }
    load(); // fallback sem IntersectionObserver
    return () => { cancel = true; };
  }, [enabled, contaId, st.state]);

  if (client.encerrado) return <RepMuted title="Cliente encerrado" sub="Sem monitoramento ativo" />;
  if (!mlConta) return <RepMuted title="Reputação indisponível" sub="Sem conta no Mercado Livre" />;
  if (!live) return <RepMuted title="Reputação indisponível" sub="Modo demonstração" />;

  if (st.state === 'loading') {
    return (
      <div className="rep loading" ref={ref}>
        <div className="rep-therm">
          {REP_LEVELS_UI.map((l) => <span key={l.id} className="rep-seg" style={{ background: '#c9cfca' }}></span>)}
        </div>
        <div className="rep-txt">
          <div className="sk" style={{ height: 13, width: '55%' }}></div>
          <div className="sk" style={{ height: 9, width: '40%', marginTop: 6 }}></div>
        </div>
      </div>
    );
  }
  if (st.state === 'notconnected') {
    return (
      <RepMuted title="Reputação indisponível" sub="Mercado Livre não conectado"
        action={canManage && onConnect ? 'Conectar' : null} onAction={onConnect} />
    );
  }
  if (st.state === 'error') {
    return (
      <RepMuted title="Não foi possível carregar" sub="Reputação do Mercado Livre"
        action="Tentar de novo" onAction={() => setSt({ state: 'loading' })} />
    );
  }

  const r = st.rep;
  if (!r.levelId) return <RepMuted title="Sem nível de reputação" sub={r.nickname ? `Conta ${r.nickname}` : 'Conta nova no Mercado Livre'} />;
  const medal = REP_MEDALS[r.powerSeller];
  return (
    <div className="rep" title={r.nickname ? `Conta ${r.nickname}` : undefined}>
      <div className="rep-therm">
        {REP_LEVELS_UI.map((l) => (
          <span key={l.id} className={'rep-seg' + (l.id === r.levelId ? ' on' : '')} style={{ background: l.hex, color: l.hex }}></span>
        ))}
      </div>
      <div className="rep-txt">
        <div className="lvl">Reputação {String(r.colorLabel || '').toLowerCase()}</div>
        <div className="medal">
          {medal
            ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="9" r="6" /><path d="M8 14l-2 8 6-3 6 3-2-8" /></svg>{medal}</>
            : 'Sem medalha'}
        </div>
      </div>
    </div>
  );
}
window.ClientCardReputation = ClientCardReputation;
```

- [ ] **Step 2: Verificar que compila (Babel)**

Run: abrir `index.html` no browser (file:), abrir o console.
Expected: sem erro de sintaxe do Babel; a tela antiga continua funcionando (o componente novo ainda não é usado).

- [ ] **Step 3: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-clients.jsx
git commit -m "feat(clientes): componente de reputacao ML (lazy-load, fila, cache de sessao)"
```

---

### Task 4: Reescrever a tela `Clients` (header + filtros + grade)

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-clients.jsx`

**Interfaces:**
- Consumes: `ClientCardReputation` (Task 3); helpers `window.agendaShort/brShort/mkBrand/mkBg/mkColor/isDueOn/weekdayName/P4_TODAY/P4_AD_MARKETPLACES`; props existentes de `Clients` vindas do shell (`user, role, clients, loading, onOpenClient, onEditClient, onLogout, onManageUsers, onNewClient, onImport, toast` — o prop `layout` deixa de ser usado e será removido do shell na Task 5).
- Produces: `window.Clients`, `window.StatusTag`, `window.MkBadge` (inalterados na assinatura). `ClientRow` é REMOVIDO.

- [ ] **Step 1: Substituir `ClientCard` e remover `ClientRow`**

Substituir a função `ClientCard` inteira por:

```jsx
function ClientCard({ c, onOpen, onEdit, canManage }) {
  const I = window.Icons;
  const isLate = !c.encerrado && c.status === 'atrasado';
  return (
    <div className={'ccard' + (c.encerrado ? ' is-closed' : '') + (isLate ? ' late' : '')} onClick={() => onOpen(c.id)}>
      <div className="cc-head">
        <div className="nm">
          <div className="loja">{c.loja}</div>
          <div className="an">{c.tipo} · {c.analista}</div>
        </div>
        <StatusTag status={c.status} encerrado={c.encerrado} />
      </div>
      <MkRow contas={c.contas} />
      <ClientCardReputation client={c} canManage={canManage} onConnect={onEdit ? () => onEdit(c.id) : null} />
      <div className="cc-foot">
        <span className="cc-sched"><I.cal size={13} /> {window.agendaShort(c.agenda)}</span>
        <span className="lr">Último<b>{window.brShort(c.last)}</b></span>
      </div>
    </div>
  );
}
```

Remover a função `ClientRow` inteira (e não exportá-la).

Ajustar o CSS-side no rodapé do card: a classe `.cc-foot .lr b` já vira bloco (Task 2). O lápis `cc-edit` deixa de existir — **edição** passa a ser via Histórico → "Editar" (e via "Conectar" na reputação). Decisão registrada no spec.

- [ ] **Step 2: Reescrever o corpo de `Clients`**

Manter: estados `q, mk, st, dueOn, dueDate, an, menuOpen`, o `menuRef`/efeito de fechar menu, `isAdmin/canManage/seesAll/all/scoped/activeScoped/closedN`, `markets` (sem 'Todos' — ver abaixo), `analistOptions`, `dueMatch`, o filtro/sort de `list`, `dueCount`, `schedCount`, `isToday`, `lateN`, `emDia`, `greeting`, `firstName` e `exportClients` **exatamente como estão**, com estas mudanças:

```jsx
// ANTES: const markets = ['Todos', ...(window.P4_AD_MARKETPLACES || []).filter(...)]
// DEPOIS (sem 'Todos'; chip ativo clicado de novo limpa o filtro):
const markets = (window.P4_AD_MARKETPLACES || []).filter((m) => scoped.some((c) => c.marketplaces.includes(m)));
const mkCount = (m) => activeScoped.filter((c) => c.marketplaces.includes(m)).length;
// contagem "para enviar hoje" fixa no header (independe da data escolhida no toggle)
const dueTodayCount = scoped.filter((c) => !c.encerrado && (window.isDueOn(c.agenda, window.P4_TODAY) || c.status === 'atrasado')).length;
```

E substituir todo o JSX do `return` por:

```jsx
return (
  <div className="shell">
    <window.TopBar title="Clientes" user={user} role={role} onLogout={onLogout} onManageUsers={onManageUsers} />
    <div className="page">
      <div className="page-inner">

        <div className="ch-top">
          <div>
            <div className="ch-eyebrow">{greeting}, {firstName} 👋</div>
            <h1>{dueOn ? 'Feedbacks para enviar' : (seesAll ? 'Todos os clientes' : 'Meus clientes')}</h1>
            <div className="ch-stats">
              <span className="stat ok"><span className="dt"></span><span className="n">{activeScoped.length}</span> {activeScoped.length === 1 ? 'ativo' : 'ativos'}</span>
              <span className="sep">·</span>
              {lateN > 0
                ? <span className="stat late"><span className="dt"></span><span className="n">{lateN}</span> {lateN === 1 ? 'atrasado' : 'atrasados'}</span>
                : <span className="stat ok"><span className="dt"></span>tudo em dia</span>}
              <span className="sep">·</span>
              <span className="stat send"><span className="dt"></span><span className="n">{dueTodayCount}</span> para enviar hoje</span>
              {closedN > 0 ? <><span className="sep">·</span><span className="stat closed"><span className="dt"></span>{closedN} {closedN === 1 ? 'encerrado' : 'encerrados'}</span></> : null}
            </div>
          </div>
          <div className="ch-actions">
            {canManage ? (
              <div style={{ position: 'relative' }} ref={menuRef}>
                <button className={'km-btn' + (menuOpen ? ' on' : '')} onClick={() => setMenuOpen((o) => !o)} title="Ações em massa" aria-label="Ações em massa">
                  <I.dots size={18} />
                </button>
                {menuOpen ? (
                  <div className="km-menu">
                    {onImport ? <button className="km-item" onClick={() => { setMenuOpen(false); onImport(); }}><I.upload size={16} /> Adicionar clientes em massa</button> : null}
                    <button className="km-item" onClick={() => { setMenuOpen(false); exportClients(); }}><I.edit size={16} /> Editar clientes em massa</button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {canManage ? <button className="btn-accent" onClick={onNewClient}><I.plus size={16} /> Adicionar cliente</button> : null}
          </div>
        </div>

        <div className="toolbar">
          <div className="search">
            <I.search size={17} />
            <input placeholder="Buscar por loja, analista ou marketplace…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className={'due-toggle' + (dueOn ? ' on' : '')} onClick={() => setDueOn((v) => !v)}>
            <I.cal size={15} /> Para enviar {isToday ? 'hoje' : ''} <span className="cnt">{dueCount}</span>
          </button>
          {dueOn ? (
            <>
              <div className="due-date">
                <I.cal size={14} />
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value || window.P4_TODAY)} />
              </div>
              {!isToday ? <button className="chip" onClick={() => setDueDate(window.P4_TODAY)}>Hoje</button> : null}
              <span className="due-info">{window.weekdayName(dueDate)}</span>
            </>
          ) : null}
          {seesAll && analistOptions.length > 1 ? (
            <div className={'filter-select' + (an !== 'Todos' ? ' on' : '')}>
              <I.users size={16} />
              <select value={an} onChange={(e) => setAn(e.target.value)} title="Filtrar por analista">
                <option value="Todos">Todos os analistas</option>
                {analistOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          ) : null}
        </div>

        <div className="filters">
          <div className="chips">
            {['Todos', 'Em dia', 'Atrasado', 'Encerrado'].map((s) => (
              <button key={s} className={'chip' + (st === s ? ' on' : '')} onClick={() => setSt(s)}>{s}</button>
            ))}
          </div>
          {markets.length > 1 ? <div className="div"></div> : null}
          {markets.length > 1 ? (
            <div className="chips">
              {markets.map((m) => (
                <button key={m} className={'chip' + (mk === m ? ' on' : '')} onClick={() => setMk(mk === m ? 'Todos' : m)}>
                  <span className="dot" style={{ background: window.mkBrand(m) }}></span>{m} <span className="c">{mkCount(m)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {loading && all.length === 0
          ? <div className="empty"><b>Carregando clientes…</b>Buscando os dados no servidor.</div>
          : list.length === 0
          ? <div className="empty"><b>{dueOn ? 'Nada para enviar' : 'Nenhum cliente encontrado'}</b>{dueOn ? 'Nenhum feedback agendado para a data e nenhum atrasado.' : 'Ajuste a busca ou os filtros acima.'}</div>
          : (
            <div className="cgrid">
              {list.map((c) => <ClientCard key={c.id} c={c} onOpen={onOpenClient} onEdit={canManage ? onEditClient : null} canManage={canManage} />)}
              {canManage
                ? <button className="add-card" onClick={onNewClient}>
                    <span className="plus"><I.plus size={22} /></span>
                    Adicionar cliente
                  </button>
                : null}
            </div>
          )}
      </div>
    </div>
  </div>
);
```

Notar: o parâmetro `layout` sai da assinatura de `Clients` (vira `function Clients({ user, role, clients, loading, onOpenClient, onEditClient, onLogout, onManageUsers, onNewClient, onImport, onGotoDashboard, toast })`).

- [ ] **Step 3: Verificar no browser (modo demo)**

Run: abrir `index.html` (file:), logar no modo demo (qualquer e-mail/senha com backend desligado).
Expected:
- Header com stats inline (dados mock: contagens coerentes com os 9 clientes mock);
- Toggle "Para enviar hoje" filtra a grade (atrasados primeiro) e mostra contador; seletor de data + "Hoje" + dia da semana aparecem só com o toggle ativo;
- Chips de status funcionam; chips de marketplace com contagem funcionam (clicar de novo limpa);
- Grade sem opção de lista; cards com bloco de reputação "Modo demonstração" (mutado) — correto, pois demo não chama a API;
- Cards atrasados com filete vermelho; encerrado esmaecido por último;
- Console sem erros.

- [ ] **Step 4: Verificar responsivo**

Run: DevTools → toggle device toolbar → 1280px / 900px / 390px.
Expected: 900px sidebar em trilho; 390px sem sidebar, header empilhado com botão largura total, grade em 1 coluna, sem scroll horizontal.

- [ ] **Step 5: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-clients.jsx
git commit -m "feat(clientes): redesign da home (stats inline, filtros compactos, card com reputacao)"
```

---

### Task 5: Remover o tweak de layout (p4-shell.jsx)

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-shell.jsx`

**Interfaces:**
- Consumes: `Clients` sem prop `layout` (Task 4). `Settings` já ignora `layout`/`onSetLayout`.
- Produces: shell sem estado `layout`.

- [ ] **Step 1: Remover o tweak**

Em `App()`:
1. No `useTweaks({...})`, remover a linha `layout: 'grade',`.
2. Na chamada `<window.Clients ... layout={t.layout} ... />`, remover `layout={t.layout}`.
3. Na chamada `<window.Settings ... layout={t.layout} ... onSetLayout={(v) => setTweak('layout', v)} ... />`, remover `layout={t.layout}` e `onSetLayout={(v) => setTweak('layout', v)}`.
4. No `<window.TweaksPanel>`, remover:
```jsx
<window.TweakSection label="Layout" />
<window.TweakRadio label="Lista de clientes" value={t.layout}
  options={['grade', 'lista']} onChange={(v) => setTweak('layout', v)} />
```

- [ ] **Step 2: Conferir que nada mais usa `layout`**

Run: `grep -rn "t.layout\|layout===\|layout ===\|'lista'" design_handoff_sistema_feedbacks --include=*.jsx`
Expected: nenhuma ocorrência restante (fora comentários).

- [ ] **Step 3: Verificar no browser**

Run: recarregar `index.html`, abrir o painel Tweaks.
Expected: sem a opção "Lista de clientes"; app navega normal (clients → history → voltar).

- [ ] **Step 4: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-shell.jsx
git commit -m "chore(tweaks): remove layout de lista da tela de clientes"
```

---

### Task 6: Verificação end-to-end + deploy

**Files:** nenhum novo — verificação e publicação.

- [ ] **Step 1: Smoke com backend local (estados reais de reputação)**

Run:
```bash
cd backend && npm start
```
Abrir `index.html` via `http://localhost` ou file:, logar com usuário real do banco local.
Expected: grade carrega do banco; cards de clientes com conta ML **conectada** mostram skeleton → termômetro; contas ML sem conexão mostram "Mercado Livre não conectado · Conectar" (Conectar leva à edição); clientes sem ML mostram "Sem conta no Mercado Livre". Máx. 3 requests de reputação simultâneos (aba Network). Se o banco local não tiver conexões ML, validar ao menos skeleton→notconnected e demais estados.

- [ ] **Step 2: Revisão final do diff**

Run: `git log --oneline main -6` e `git diff HEAD~4 --stat`
Expected: 4–5 commits da feature; só os 3 arquivos do frontend + docs/.gitignore alterados; nenhum arquivo de backend tocado; `_mockup-clientes.html` fora do índice.

- [ ] **Step 3: Push (deploy automático Vercel + Render)**

```bash
git push
```

- [ ] **Step 4: Verificar produção**

Run: abrir a URL do Vercel (produção), Ctrl+Shift+R.
Expected: novo layout no ar; login real; reputação carregando nos cards com ML conectado; sem erros no console. Lembrar do cold start do Render (~30–50s no primeiro request).

---

## Self-review (do plano)

- **Cobertura do spec:** header/stats (§4.1 → Task 4), filtros/toggle/contagens (§4.2 → Tasks 2/4), grade e card (§5 → Tasks 2/4), 7 estados de reputação (§5.1 → Task 3: encerrado, sem-ML, demo, loading, ok, notconnected, error), carga skeleton+lazy+fila+cache (§6 → Task 3), responsivo (§7 → Tasks 2/4), remoção da lista + tweak (§3 → Tasks 4/5), arquivos (§8 → todos cobertos), critérios de aceite (§10 → verificações das Tasks 4/6). ✅
- **Sem placeholders:** todo passo de código tem o código. ✅
- **Consistência de tipos/nomes:** `ClientCardReputation({client, canManage, onConnect})` idêntico entre Tasks 3 e 4; classes CSS da Task 2 = as usadas na Task 4; `Clients` sem `layout` consistente entre Tasks 4 e 5. ✅
- **Observação de escopo:** o lápis de edição no hover do card foi removido (não existe no design aprovado); edição continua via Histórico → Editar. Registrado na Task 4.
