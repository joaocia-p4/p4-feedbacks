# Tags de status (Pausado, Onboarding, Enviar hoje) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar as tags de status do cliente **Pausado** (cliente e conta, com motivo), **Onboarding** (cliente, manual) e **Enviar hoje**, cada uma com cor; pausado/onboarding não são cobrados (fora de atrasado e "para enviar").

**Architecture:** Backend calcula um `statusTag` único por precedência em `lib/clientAggregate.js` (reusa `p4.isOverdueByCycle`/`isDueOn`/`todayISO`), persistido via `clientService`/`schemas`; migração adiciona `clients.situacao`+`motivo_pausa` e `accounts.pausado`+`motivo_pausa`. Frontend renderiza `statusTag` (`StatusTag`) com cores e ajusta filtros/"para enviar"; protótipo `p4-data.jsx` espelha a regra.

**Tech Stack:** Node backend (Express + Knex, sem framework de teste), React 18 + Babel via CDN (sem build), PostgreSQL (Neon)/SQLite (dev).

## Global Constraints

- **Sem build/sem npm no front:** validar cada `.jsx` transpilando com o Babel local:
  `node "$SP/check.js" "$SP" "$BASE/<arquivo>.jsx"` onde
  `SP=/c/Users/joaop/AppData/Local/Temp/claude/c--Users-joaop-OneDrive-Desktop-Sistema-de-relatorios-de-ADS/59f43382-1538-4588-bf10-b716f3c6c583/scratchpad/jsxcheck` e
  `BASE=/c/Users/joaop/OneDrive/Desktop/Sistema de relatorios de ADS/Sistema de Feedbacks/design_handoff_sistema_feedbacks`. Esperado: `OK`.
- **Backend sem suíte:** validar com `node --check <arquivo>` e com scripts de teste Node (`node <arquivo>.js`) para a lógica de `statusTag`/`precisaHoje`.
- **`BE=/c/Users/joaop/OneDrive/Desktop/Sistema de relatorios de ADS/Sistema de Feedbacks/backend/src`** (require em Node/Windows usa caminho estilo `C:/...`).
- **Cores** (dot/tag): em-dia verde `#56D54F`, enviar hoje azul `#2A6FDB`, atrasado vermelho `#d8423a`, pausado âmbar `#E0A100`, onboarding roxo `#7A5AF0`, encerrado cinza `#6b7570`.
- **Precedência do `statusTag`:** Encerrado > Pausado > Onboarding > Atrasado > Enviar hoje > Em dia.
- **Pausado/onboarding não cobram:** fora de `atrasado`, `precisaHoje`, `due`/`para enviar`.
- **Commits/deploy adiados:** trabalhar na `main`; NÃO commitar/publicar sem o usuário pedir (a migração roda no boot do backend no deploy).
- Valores de `situacao`: `'ativo' | 'onboarding' | 'pausado'`.

---

### Task 1: Migração (schema)

**Files:**
- Create: `backend/src/db/migrations/20260708000001_status_tags.js`

**Interfaces:**
- Produces: colunas `clients.situacao` (string, default `'ativo'`), `clients.motivo_pausa` (text), `accounts.pausado` (boolean, default false), `accounts.motivo_pausa` (text).

- [ ] **Step 1: Criar a migração**

```js
// Adiciona os campos de situação do cliente (ativo/onboarding/pausado) + motivo da
// pausa, e a pausa por conta (marketplace). Roda no boot (server.js -> migrate.latest()).
exports.up = async function up(knex) {
  await knex.schema.alterTable('clients', (t) => {
    t.string('situacao').notNullable().defaultTo('ativo'); // 'ativo' | 'onboarding' | 'pausado'
    t.text('motivo_pausa');
  });
  await knex.schema.alterTable('accounts', (t) => {
    t.boolean('pausado').notNullable().defaultTo(false);
    t.text('motivo_pausa');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('clients', (t) => { t.dropColumn('situacao'); t.dropColumn('motivo_pausa'); });
  await knex.schema.alterTable('accounts', (t) => { t.dropColumn('pausado'); t.dropColumn('motivo_pausa'); });
};
```

- [ ] **Step 2: Validar sintaxe**

Run: `node --check "$BE/db/migrations/20260708000001_status_tags.js"`
Expected: (sem saída) — OK.

- [ ] **Step 3: Checkpoint** — a migração só aplica no boot do backend (deploy). Não há como rodar contra o Neon localmente aqui; a validação de execução fica no deploy.

---

### Task 2: Lógica de status no backend (`clientAggregate` + testes)

**Files:**
- Modify: `backend/src/lib/clientAggregate.js` (`enrichAccount`, `enrichClient`)
- Test: script Node em scratchpad

**Interfaces:**
- Consumes: `p4.isOverdueByCycle(agenda, lastGenISO, asOf)`, `p4.isDueOn(agenda, isoStr)`, `p4.todayISO()`, `p4.lastCompleteDayISO()` (todos existentes).
- Produces (campos novos no retorno de `enrichClient`): `situacao`, `motivoPausa`, `pausado` (bool), `onboarding` (bool), `precisaHoje` (bool), `statusTag` (string). Por conta (`enrichAccount`): `pausado` (bool), `motivoPausa`, e `status` passa a poder ser `'pausado'`.

- [ ] **Step 1: `enrichAccount` — expor pausado/motivo e status pausado**

Substituir o objeto retornado por `enrichAccount` para incluir `pausado`/`motivoPausa` e refletir pausa no `status`:

```js
function enrichAccount(acc, asOf, agenda) {
  const reports = acc.reports || [];
  const last = reportDate(reports[0]);
  const lastGen = maxGen(reports);
  const pausado = acc.pausado === true;
  const overdue = p4.isOverdueByCycle(agenda, lastGen, asOf);
  return {
    id: acc.id,
    marketplace: acc.marketplace,
    conta: acc.apelido || '',
    metaInvestimento: acc.metaInvestimento,
    metaRoas: acc.metaRoas,
    metaAcos: acc.metaAcos,
    metaTacos: acc.metaTacos,
    dataEntrada: acc.dataEntrada || null,
    dataEncerramento: acc.dataEncerramento || null,
    ativo: acc.ativo === false ? false : true,
    pausado,
    motivoPausa: acc.motivoPausa || acc.motivo_pausa || '',
    last,
    lastGen,
    // conta pausada não cobra → status "pausado" (só informativo aqui)
    status: pausado ? 'pausado' : (overdue ? 'atrasado' : 'em-dia'),
    reports,
  };
}
```

- [ ] **Step 2: `enrichClient` — precedência do `statusTag`**

No `enrichClient`, após montar `contas`, substituir o bloco de status (hoje: `ativas`/`baseAtraso`/`overdueSched`/`status`) por:

```js
  const situacao = client.situacao || 'ativo';
  const encerrado = contas.length > 0 && contas.every((m) => m.ativo === false);
  const ativas = contas.filter((m) => m.ativo !== false);
  const cobraveis = ativas.filter((m) => !m.pausado); // ativas e não pausadas cobram
  const pausadoAll = ativas.length > 0 && ativas.every((m) => m.pausado);
  const pausado = situacao === 'pausado' || pausadoAll;
  const onboarding = situacao === 'onboarding';
  const atrasado = cobraveis.some((m) => p4.isOverdueByCycle(client.agenda, m.lastGen, asOf));
  const hoje = p4.todayISO();
  const precisaHoje = !encerrado && !pausado && !onboarding
    && p4.isDueOn(client.agenda, hoje)
    && cobraveis.some((m) => p4.isOverdueByCycle(client.agenda, m.lastGen, hoje));
  const statusTag = encerrado ? 'encerrado'
    : pausado ? 'pausado'
    : onboarding ? 'onboarding'
    : atrasado ? 'atrasado'
    : precisaHoje ? 'hoje'
    : 'em-dia';
  const status = atrasado ? 'atrasado' : 'em-dia'; // compat com consumidores atuais
  const lastWorst = (cobraveis.length ? cobraveis : ativas).reduce(
    (a, m) => (m.last && m.last < a ? m.last : a), '9999-12-31'
  );
```

E no objeto retornado por `enrichClient`, trocar/incluir:

```js
    situacao,
    motivoPausa: client.motivoPausa || client.motivo_pausa || '',
    pausado,
    onboarding,
    precisaHoje,
    statusTag,
    status,          // mantém
    encerrado,       // mantém
    lastWorst: lastWorst === '9999-12-31' ? null : lastWorst,
```

(Remover a antiga `const overdueSched = ...` e a linha `const status = overdueSched ? ...`; o campo `overdueSched` deixa de ser retornado — nenhum consumidor usa, confirmado.)

- [ ] **Step 3: Teste Node da precedência + precisaHoje**

Criar `"$SP/test-tags.js"`:

```js
const { enrichClient } = require('C:/Users/joaop/OneDrive/Desktop/Sistema de relatorios de ADS/Sistema de Feedbacks/backend/src/lib/clientAggregate.js');
let pass=0, fail=0; const chk=(n,g,e)=>{const ok=g===e;console.log((ok?'PASS ':'FAIL ')+n+' => '+JSON.stringify(g)+(ok?'':' EXP='+JSON.stringify(e)));ok?pass++:fail++;};
const asOf='2026-01-17'; // sáb após sexta 01-16
const ag={freq:'Semanal',diaSemana:'Sexta'};
const acc=(o)=>({id:'a1',marketplace:'Mercado Livre',apelido:'',ativo:true,pausado:false,reports:[{salvoEm:'2026-01-12',periodoFim:'2026-01-12'}],...o});
const cli=(clientPatch,accs)=>enrichClient({id:'c',loja:'X',tipo:'Loja',analista:'A',agenda:ag,...clientPatch}, accs,{asOf});

// em dia (montou 01-12 na semana do envio) -> statusTag em-dia
chk('em-dia', cli({}, [acc({})]).statusTag, 'em-dia');
// onboarding manual -> tag onboarding, mesmo com relatorio velho
chk('onboarding', cli({situacao:'onboarding'}, [acc({reports:[{salvoEm:'2025-01-01'}]})]).statusTag, 'onboarding');
// pausado manual -> tag pausado
chk('pausado cliente', cli({situacao:'pausado'}, [acc({reports:[{salvoEm:'2025-01-01'}]})]).statusTag, 'pausado');
// conta pausada (unica) -> cliente pausado (pausadoAll)
chk('conta pausada unica -> pausado', cli({}, [acc({pausado:true, reports:[{salvoEm:'2025-01-01'}]})]).statusTag, 'pausado');
// atrasado (pulou a semana) -> atrasado
chk('atrasado', cli({}, [acc({reports:[{salvoEm:'2026-01-09'}]})]).statusTag, 'atrasado');
// duas contas, uma pausada e a ativa em dia -> em-dia (pausada nao conta)
chk('conta pausada + ativa em dia', cli({}, [acc({}), acc({id:'a2',marketplace:'Shopee',pausado:true,reports:[{salvoEm:'2025-01-01'}]})]).statusTag, 'em-dia');
console.log('---'); console.log(pass+' pass, '+fail+' fail'); process.exit(fail?1:0);
```

Run: `node "$SP/test-tags.js"`
Expected: `6 pass, 0 fail`.

> Nota: "Enviar hoje" (`precisaHoje`) depende de `hoje === dia de envio`, que varia com a data real; o teste acima cobre a precedência. `precisaHoje` é validado manualmente no navegador (Task 5).

- [ ] **Step 4: Validar sintaxe**

Run: `node --check "$BE/lib/clientAggregate.js"`
Expected: OK.

---

### Task 3: Validação + persistência (`schemas` + `clientService`)

**Files:**
- Modify: `backend/src/validators/schemas.js` (`createClientSchema`, `updateClientSchema`, `contaSchema`)
- Modify: `backend/src/services/clientService.js` (`normalizeContas`, `createClient`, `updateClient`, `rowToClientBase`, `assembleClient`, `normalizeStatus`, `applyFilters`, `listClients`)

**Interfaces:**
- Consumes: campos do cadastro (`situacao`, `motivoPausa`, e por conta `pausado`, `motivoPausa`).
- Produces: persistência dessas colunas + status novos reconhecidos nos filtros.

- [ ] **Step 1: schemas — aceitar os campos**

Em `contaSchema` (dentro do `z.object({...})`), adicionar:

```js
  pausado: z.boolean().default(false),
  motivoPausa: z.string().trim().optional(),
```

Em `createClientSchema` e `updateClientSchema`, adicionar dentro do `z.object({...})`:

```js
  situacao: z.enum(['ativo', 'onboarding', 'pausado']).default('ativo'),
  motivoPausa: z.string().trim().optional(),
```

- [ ] **Step 2: clientService.normalizeContas — carregar pausado/motivo**

Dentro do `body.contas.map((c) => ({...}))`, adicionar:

```js
      pausado: c.pausado === true,
      motivoPausa: (c.motivoPausa ?? '').trim(),
```

E no fallback `(body.marketplaces || []).map(...)` incluir `pausado: false, motivoPausa: ''`.

- [ ] **Step 3: clientService — gravar no create/update**

Em `createClient`, no `trx('clients').insert({...})` adicionar `situacao: body.situacao || 'ativo', motivo_pausa: body.motivoPausa || ''`. No `trx('accounts').insert(contas.map((c) => ({...})))` adicionar `pausado: c.pausado, motivo_pausa: c.motivoPausa`.

Em `updateClient`: no `patch` (quando `body.situacao !== undefined`) setar `patch.situacao = body.situacao` e `patch.motivo_pausa = body.motivoPausa || ''`. No `vals` das contas (insert e update) adicionar `pausado: c.pausado, motivo_pausa: c.motivoPausa`.

- [ ] **Step 4: clientService — expor no read**

Em `rowToClientBase(row)` incluir `situacao: row.situacao || 'ativo', motivoPausa: row.motivo_pausa || ''`.
Em `assembleClient`, no map das contas, incluir `pausado: a.pausado === true, motivoPausa: a.motivo_pausa || ''` (para o `enrichAccount` receber).

- [ ] **Step 5: clientService — filtros e "para enviar"**

Em `normalizeStatus(s)`, reconhecer os novos: retornar `'pausado'`, `'onboarding'`, `'hoje'` quando o texto casar (`'pausado'`, `'onboarding'`, `'enviar hoje'`/`'hoje'`).

Em `applyFilters`, trocar as comparações de status para usar `statusTag`:
```js
    if (status && status !== c.statusTag) return false;
```
(substitui os `if (status === 'em-dia' && ...)` etc.) — mantendo o filtro `due` como `!c.encerrado && !c.pausado && !c.onboarding && (p4.isDueOn(c.agenda, due) || c.status === 'atrasado')`.

Em `listClients`, na `meta`: `scheduled`/`toSend` passam a excluir pausado/onboarding:
```js
    meta.scheduled = enriched.filter((c) => !c.encerrado && !c.pausado && !c.onboarding && p4.isDueOn(c.agenda, filters.due)).length;
    meta.toSend = enriched.filter((c) => !c.encerrado && !c.pausado && !c.onboarding && (p4.isDueOn(c.agenda, filters.due) || c.status === 'atrasado')).length;
```

- [ ] **Step 6: Validar sintaxe**

Run: `node --check "$BE/validators/schemas.js"` e `node --check "$BE/services/clientService.js"`
Expected: OK nos dois.

---

### Task 4: Cadastro (`p4-new-client.jsx`)

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-new-client.jsx`

**Interfaces:**
- Produces: no `onSave`, envia `situacao`/`motivoPausa` (cliente) e por conta `pausado`/`motivoPausa`.

- [ ] **Step 1: Estado + blankConta**

Em `blankConta()` adicionar `pausado: false, motivoPausa: ''`. No `useState(contas...)` do modo edição, mapear `pausado: m.pausado === true, motivoPausa: m.motivoPausa || ''`.

Adicionar estados do cliente:
```js
  const [situacao, setSituacao] = React.useState(client ? (client.situacao || 'ativo') : 'ativo');
  const [motivoPausaCliente, setMotivoPausaCliente] = React.useState(client ? (client.motivoPausa || '') : '');
```

- [ ] **Step 2: Conta — status Ativo/Pausado/Encerrado + motivo**

Substituir o `Seg` de status da conta:
```jsx
              <LField label="Status">
                <Seg value={c.ativo === false ? 'Encerrado' : (c.pausado ? 'Pausado' : 'Ativo')}
                  options={['Ativo', 'Pausado', 'Encerrado']}
                  onChange={(v) => setConta(i, { ativo: v !== 'Encerrado', pausado: v === 'Pausado' })} />
              </LField>
```
E, logo abaixo do bloco de ciclo de vida da conta, quando `c.pausado`:
```jsx
              {c.pausado ? (
                <LField label="Motivo da pausa" hint="opcional">
                  <div className="lf-in"><input placeholder="Ex.: pendência de pagamento" value={c.motivoPausa || ''} onChange={(e) => setConta(i, { motivoPausa: e.target.value })} /></div>
                </LField>
              ) : null}
```

- [ ] **Step 3: Cliente — seletor de situação + motivo**

Na seção de Identificação (ou logo antes de Observações), adicionar:
```jsx
              <LField label="Situação do cliente">
                <Seg value={situacao === 'pausado' ? 'Pausado' : situacao === 'onboarding' ? 'Onboarding' : 'Ativo'}
                  options={['Ativo', 'Onboarding', 'Pausado']}
                  onChange={(v) => setSituacao(v === 'Pausado' ? 'pausado' : v === 'Onboarding' ? 'onboarding' : 'ativo')} />
              </LField>
              {situacao === 'pausado' ? (
                <LField label="Motivo da pausa" hint="aparece na tag">
                  <div className="lf-in"><input placeholder="Ex.: cliente pediu para pausar" value={motivoPausaCliente} onChange={(e) => setMotivoPausaCliente(e.target.value)} /></div>
                </LField>
              ) : null}
```

- [ ] **Step 4: onSave — enviar os campos**

No objeto do `onSave`, adicionar no cliente `situacao, motivoPausa: motivoPausaCliente` e por conta `pausado: c.pausado, motivoPausa: c.motivoPausa`.

- [ ] **Step 5: Transpilar**

Run: `node "$SP/check.js" "$SP" "$BASE/p4-new-client.jsx"`
Expected: OK.

---

### Task 5: Tags + filtros (`p4-clients.jsx`, `index.html`, `p4-cs-dashboard.jsx`)

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-clients.jsx` (`StatusTag`, `ClientCard`, `Clients` filtros)
- Modify: `design_handoff_sistema_feedbacks/index.html` (CSS `.status-tag.*`)
- Modify: `design_handoff_sistema_feedbacks/p4-cs-dashboard.jsx` (usar statusTag)

**Interfaces:**
- Consumes: `c.statusTag`, `c.motivoPausa`, `c.pausado`, `c.onboarding`, `c.precisaHoje`.

- [ ] **Step 1: `StatusTag` por `statusTag`**

Substituir o componente:
```jsx
const STATUS_LABEL = { 'em-dia': 'Em dia', hoje: 'Enviar hoje', atrasado: 'Atrasado', pausado: 'Pausado', onboarding: 'Onboarding', encerrado: 'Encerrado' };
const STATUS_CLASS = { 'em-dia': 'ok', hoje: 'today', atrasado: 'late', pausado: 'paused', onboarding: 'onboarding', encerrado: 'closed' };
function StatusTag({ statusTag, motivo }) {
  const tag = statusTag || 'em-dia';
  return (
    <span className={'status-tag ' + (STATUS_CLASS[tag] || 'ok')} title={tag === 'pausado' && motivo ? 'Motivo: ' + motivo : undefined}>
      <span className="d"></span>{STATUS_LABEL[tag] || tag}
    </span>
  );
}
```
No `ClientCard`, trocar `<StatusTag status={c.status} encerrado={c.encerrado} />` por `<StatusTag statusTag={c.statusTag} motivo={c.motivoPausa} />`. E o realce do card: `const isLate = c.statusTag === 'atrasado'; const isPaused = c.pausado || c.onboarding;` → `className={'ccard' + (c.encerrado ? ' is-closed' : '') + (isLate ? ' late' : '') + (isPaused ? ' is-paused' : '')}`.

- [ ] **Step 2: CSS das cores (`index.html`, ao lado de `.status-tag.closed`)**

```css
.status-tag.today,.tag.today{background:rgba(42,111,219,.13);color:#2A6FDB}
.status-tag.today .d,.tag.today .d{background:#2A6FDB}
.status-tag.paused,.tag.paused{background:rgba(224,161,0,.15);color:#9a6f00}
.status-tag.paused .d,.tag.paused .d{background:#E0A100}
.status-tag.onboarding,.tag.onboarding{background:rgba(122,90,240,.14);color:#5b40c9}
.status-tag.onboarding .d,.tag.onboarding .d{background:#7A5AF0}
.ccard.is-paused{opacity:.72}
```

- [ ] **Step 3: Filtros + "para enviar" no front**

Chips de status:
```jsx
              {['Todos', 'Em dia', 'Enviar hoje', 'Atrasado', 'Pausado', 'Onboarding', 'Encerrado'].map((s) => (
```
Mapa label→statusTag e o filtro:
```js
  const ST_MAP = { 'Em dia': 'em-dia', 'Enviar hoje': 'hoje', 'Atrasado': 'atrasado', 'Pausado': 'pausado', 'Onboarding': 'onboarding', 'Encerrado': 'encerrado' };
```
Substituir as três linhas `if (st === 'Em dia' ...)` / `'Atrasado'` / `'Encerrado'` por:
```js
    if (st !== 'Todos' && c.statusTag !== ST_MAP[st]) return false;
```
`dueMatch` e `dueTodayCount` passam a excluir pausado/onboarding:
```js
  const dueMatch = (c) => !c.encerrado && !c.pausado && !c.onboarding && (window.isDueOn(c.agenda, dueDate) || c.status === 'atrasado');
  const dueTodayCount = scoped.filter((c) => !c.encerrado && !c.pausado && !c.onboarding && (window.isDueOn(c.agenda, window.P4_TODAY) || c.status === 'atrasado')).length;
```
`activeScoped` (métricas) passa a excluir pausado/onboarding: `const activeScoped = scoped.filter((c) => !c.encerrado && !c.pausado && !c.onboarding);`. Ordenação por `statusTag === 'atrasado'`.

- [ ] **Step 4: `p4-cs-dashboard.jsx`**

Onde usa `StatusTag`/`c.status`/conta atrasados, trocar para `statusTag` e não contar `pausado`/`onboarding` como atrasado (`c.statusTag === 'atrasado'`). (Ler o arquivo e ajustar os pontos de status; reaproveitar `window.StatusTag` com `statusTag={c.statusTag}`.)

- [ ] **Step 5: Transpilar**

Run: `node "$SP/check.js" "$SP" "$BASE/p4-clients.jsx" "$BASE/p4-cs-dashboard.jsx"`
Expected: OK nos dois.

- [ ] **Step 6: Verificação manual** (após servir o app/telas)

Cadastrar/editar clientes com Situação Onboarding e Pausado (com motivo); marcar uma conta como Pausado. Conferir na lista: tags nas cores certas, motivo no tooltip do Pausado, filtros novos funcionando, pausado/onboarding fora de "para enviar", e "Enviar hoje" num cliente cujo dia de envio é hoje e sem relatório do ciclo.

---

### Task 6: Espelho no protótipo (`p4-data.jsx`)

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-data.jsx`

- [ ] **Step 1: Campos + statusTag no mock**

Em `conta(...)`, incluir `pausado: seed.pausado === true, motivoPausa: seed.motivoPausa || ''`. Em alguns `RAW` clientes, adicionar `situacao: 'onboarding'` / `'pausado'` (+ `motivoPausa`) para ilustrar.

No `CLIENTS = RAW.map(...)`, após computar `agenda`/`asOfRef`, calcular a precedência igual ao backend:
```js
  const situacao = c.situacao || 'ativo';
  const encerrado = contas.length > 0 && contas.every((m) => m.ativo === false);
  const ativas2 = contas.filter((m) => m.ativo !== false);
  const cobraveis = ativas2.filter((m) => !m.pausado);
  const pausado = situacao === 'pausado' || (ativas2.length > 0 && ativas2.every((m) => m.pausado));
  const onboarding = situacao === 'onboarding';
  const atrasado = cobraveis.some((m) => isOverdueByCycle(agenda, m.last, asOfRef));
  const precisaHoje = !encerrado && !pausado && !onboarding && isDueOn(agenda, P4_TODAY) && cobraveis.some((m) => isOverdueByCycle(agenda, m.last, P4_TODAY));
  const statusTag = encerrado ? 'encerrado' : pausado ? 'pausado' : onboarding ? 'onboarding' : atrasado ? 'atrasado' : precisaHoje ? 'hoje' : 'em-dia';
  const status = atrasado ? 'atrasado' : 'em-dia';
```
E no objeto retornado incluir `situacao, motivoPausa: c.motivoPausa || '', pausado, onboarding, precisaHoje, statusTag, encerrado` (mantendo `status`).

- [ ] **Step 2: Transpilar**

Run: `node "$SP/check.js" "$SP" "$BASE/p4-data.jsx"`
Expected: OK.

- [ ] **Step 3: Checkpoint final** — rodar a verificação da spec (seção 12). Reportar; commit/deploy só quando o usuário pedir.

---

## Self-Review

- **Cobertura da spec:** §2 schema → Task 1; §3 status/precedência/precisaHoje → Task 2; §4 filtros/para-enviar → Task 3 (backend) + Task 5 (front); §5 cadastro → Task 4; §6 tags/cores → Task 5; §7 validação → Task 3; §8 persistência → Task 3; §9 protótipo → Task 6. ✔
- **Placeholders:** nenhum passo de código sem código; comandos com saída esperada. ✔
- **Consistência de tipos:** `statusTag` (`'em-dia'|'hoje'|'atrasado'|'pausado'|'onboarding'|'encerrado'`), `situacao` (`'ativo'|'onboarding'|'pausado'`), `pausado`/`onboarding`/`precisaHoje` booleans — usados igual em backend (Task 2/3), front (Task 5) e mock (Task 6). `ST_MAP`/`STATUS_CLASS`/`STATUS_LABEL` cobrem os mesmos valores. ✔
- **Risco:** `applyFilters`/`dueMatch` dependem de `c.statusTag`/`c.pausado`/`c.onboarding` existirem no retorno — garantidos pela Task 2/3 antes de a Task 5 consumi-los.
