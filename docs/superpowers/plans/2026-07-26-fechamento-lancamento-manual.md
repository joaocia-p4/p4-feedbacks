# Lançamento Manual no Fechamento Mensal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os números do fechamento mensal — hoje somados dos feedbacks semanais — por valores lançados à mão, por conta e por mês, e liberar a tela para analistas.

**Architecture:** A regra continua em módulos puros sob `backend/src/lib/`, testados sem banco. Sai a consolidação de relatórios; entra uma tabela `monthly_figures` lida por `closingService` e montada por `buildMonthlyClosing`. A tela ganha campos de entrada com as razões calculadas ao vivo no navegador, mantendo o backend como fonte de verdade.

**Tech Stack:** Node 18+ / Express / Knex (SQLite em dev, Postgres em prod) / `node --test` / React 18 via Babel standalone, sem build.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-26-fechamento-lancamento-manual-design.md`. Ele **substitui** as seções 3 e 5 do spec de 2026-07-25 e altera as 4, 8, 9 e 10.
- Backend é CommonJS (`require`/`module.exports`). Nada de ESM.
- Testes rodam com `npm test` (= `node --test`) dentro de `backend/`. São puros: sem banco, sem relógio real.
- Frontend não tem build: cada `.jsx` é carregado por `<script type="text/babel">` e publica no `window`. Nada de `import`/`export`.
- Texto de UI e comentários em português, com acento.
- Migrations rodam no boot; toda migration precisa de `up` **e** `down`.
- **Colunas uuid vão como `t.string`, nunca `t.uuid`** — no Postgres `t.uuid` vira coluna nativa e a FK contra o `varchar` de `accounts.id` é rejeitada, derrubando o boot. Bug real já pego neste projeto.
- Não usar `git add -A` nem `git add .`. A árvore tem churn de fim de linha (CRLF) pendente em outros arquivos. Sempre `git add` por caminho explícito.
- Não tocar em `p4-feedbacks-transferencia/` — cópia fora do git.
- **Lançamento ausente ≠ lançamento zerado.** Sem linha em `monthly_figures` é "não lançado" (razões `null`, tela mostra `—`, conta entra em incompletos). Com linha e valor `0` é afirmação de que não faturou. Essa distinção atravessa todas as tasks.

## Pré-requisito

Branch `feat/fechamento-mensal` já contém o fechamento v1 (20 commits). Continue nela; não crie branch nova. Confirme com `git rev-parse --abbrev-ref HEAD`.

---

### Task 1: migration `monthly_figures`

**Files:**
- Create: `backend/src/db/migrations/20260726000001_monthly_figures.js`

**Interfaces:**
- Produces: tabela `monthly_figures` com `id, account_id, ym, faturamento, investimento, receita_ads, criado_em, atualizado_em, atualizado_por` e índice único em (`account_id`, `ym`).

- [ ] **Step 1: Escrever a migration**

```js
// Lançamento manual dos números do mês, por conta. Substitui a soma dos
// relatórios semanais no fechamento: semana não respeita virada de mês, então
// quem lança é quem sabe separar o que foi de cada mês.
// LINHA AUSENTE != LINHA ZERADA: sem linha = "não lançado"; com 0 = não faturou.

exports.up = async function up(knex) {
  await knex.schema.createTable('monthly_figures', (t) => {
    // uuid vai como string, NUNCA t.uuid: as demais tabelas usam string e no
    // Postgres t.uuid viraria coluna nativa, com FK incompatível contra o
    // varchar de accounts.id — o que derruba o boot.
    t.string('id').primary();
    t.string('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('ym', 7).notNullable(); // '2026-07'
    t.decimal('faturamento', 14, 2).notNullable().defaultTo(0);
    t.decimal('investimento', 14, 2).notNullable().defaultTo(0);
    t.decimal('receita_ads', 14, 2).notNullable().defaultTo(0);
    t.timestamp('criado_em').notNullable().defaultTo(knex.fn.now());
    t.timestamp('atualizado_em').notNullable().defaultTo(knex.fn.now());
    t.string('atualizado_por').references('id').inTable('users').onDelete('SET NULL');
    t.unique(['account_id', 'ym']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('monthly_figures');
};
```

- [ ] **Step 2: Rodar e conferir colunas e tipos**

```bash
cd backend && npm run migrate && node -e "
const db=require('./src/db/knex');
(async()=>{
  const c=await db('monthly_figures').columnInfo();
  console.log('colunas:', Object.keys(c).join(', '));
  console.log('id:', c.id.type, '| account_id:', c.account_id.type);
  const a=await db('accounts').columnInfo();
  console.log('accounts.id:', a.id.type, '<- tem que casar com account_id');
  await db.destroy();
})();"
```
Expected: colunas `id, account_id, ym, faturamento, investimento, receita_ads, criado_em, atualizado_em, atualizado_por`; `id` e `account_id` do mesmo tipo que `accounts.id` (`varchar`).

- [ ] **Step 3: Conferir a restrição única**

```bash
cd backend && node -e "
const db=require('./src/db/knex');
(async()=>{
  const a=await db('accounts').first('id');
  const linha={account_id:a.id, ym:'2026-01', faturamento:1, investimento:1, receita_ads:1};
  await db('monthly_figures').insert({id:'t1', ...linha});
  try { await db('monthly_figures').insert({id:'t2', ...linha}); console.log('FALHOU: aceitou duplicata'); }
  catch(e){ console.log('ok, duplicata rejeitada'); }
  await db('monthly_figures').whereIn('id',['t1','t2']).del();
  console.log('limpo:', await db('monthly_figures').count({n:'*'}));
  await db.destroy();
})();"
```
Expected: "ok, duplicata rejeitada" e a tabela termina vazia.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/20260726000001_monthly_figures.js
git commit -m "feat(db): tabela monthly_figures para lancamento manual do mes"
```

---

### Task 2: `accountInMonth` passa a olhar lançamento, e `consolidate` sai

**Files:**
- Modify: `backend/src/lib/monthlyClosing.js`
- Modify: `backend/test/monthly-closing.test.js`

**Interfaces:**
- Produces: `accountInMonth(conta, ym, temLancamento)` — mesma assinatura, terceiro argumento agora significa "tem linha em `monthly_figures` para este mês". `consolidate` deixa de existir.

- [ ] **Step 1: Ajustar os testes**

Em `backend/test/monthly-closing.test.js`:

1. Remova o bloco inteiro de testes de `consolidate` (do comentário `// ── consolidação ───` até antes do próximo bloco de seção), inclusive o helper `rel(...)` se ele não for usado por mais nada no arquivo.
2. Remova `consolidate` do `require` do topo.
3. Renomeie os testes de `accountInMonth` que falam em relatório:

```js
test('conta com lançamento no mês entra, mesmo já encerrada hoje', () => {
  const conta = { dataEntrada: '2025-01-10', dataEncerramento: '2026-08-15' };
  assert.equal(accountInMonth(conta, JUL, true), true);
});
```

4. Acrescente:

```js
test('conta sem lançamento e fora da janela de datas não entra', () => {
  const conta = { dataEntrada: null, criadoEm: '2026-09-02', dataEncerramento: null };
  assert.equal(accountInMonth(conta, JUL, false), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npm test`
Expected: FAIL — `consolidate is not a function` nos testes que ainda a chamam, se algum sobrou; se você removeu todos, os testes passam e o próximo passo é só limpar a implementação. Confirme que a contagem de testes caiu.

- [ ] **Step 3: Limpar a implementação**

Em `backend/src/lib/monthlyClosing.js`:

Apague a função `consolidate` inteira. Mantenha `const num = (v) => (Number(v) || 0);` — a Task 3 usa.

Troque o comentário e a assinatura de `accountInMonth`:

```js
// Uma conta entra no mês por duas portas independentes:
//  1. tem lançamento naquele mês — se alguém registrou número ali, a conta
//     aparece, mesmo que a janela de datas diga o contrário;
//  2. a janela de datas cobre o mês.
// A porta 2 é o que evita listar conta cadastrada em setembro no fechamento de
// julho; a porta 1 é o que mantém conta encerrada em agosto no fechamento de
// julho, se julho foi lançado.
function accountInMonth(conta, ym, temLancamento) {
  if (temLancamento) return true;
  const { ini, fim } = monthRange(ym);
  const entrada = conta.dataEntrada || conta.criadoEm || null;
  if (entrada && String(entrada).slice(0, 10) > fim) return false;
  const saida = conta.dataEncerramento || null;
  if (saida && String(saida).slice(0, 10) < ini) return false;
  return true; // sem data de entrada conhecida: assume que já existia
}
```

Remova `consolidate` do `module.exports`. Remova `reportMonth` do `require` de `./metrics` se `buildMonthlyClosing` ainda o usa — **não remova ainda**, a Task 3 cuida disso; deixe o require como está para o arquivo continuar carregando.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npm test`
Expected: PASS. `buildMonthlyClosing` ainda chama `consolidate` — se isso quebrar algum teste dele, é esperado; a Task 3 corrige. **Se quebrar, pare aqui e não commite**: significa que Tasks 2 e 3 precisam ser feitas juntas. Nesse caso avise no relatório e implemente a Task 3 em seguida no mesmo commit.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/monthlyClosing.js backend/test/monthly-closing.test.js
git commit -m "refactor(fechamento): accountInMonth olha lancamento e consolidate sai"
```

---

### Task 3: `buildMonthlyClosing` monta a partir dos lançamentos

**Files:**
- Modify: `backend/src/lib/monthlyClosing.js`
- Modify: `backend/test/monthly-closing.test.js`

**Interfaces:**
- Consumes: `accountInMonth(conta, ym, temLancamento)` (Task 2), `ratios` de `lib/metrics`.
- Produces: `buildMonthlyClosing({ clients, figures, closings, ym })`. `figures` são linhas cruas de `monthly_figures` (`account_id`, `ym`, `faturamento`, `investimento`, `receita_ads`). Cada conta do payload ganha `lancado: boolean`; cada cliente ganha `incompleto: boolean`; o resumo troca `semRelatorio` por `incompletos`. `nReports` some de conta e de cliente.

- [ ] **Step 1: Escrever os testes**

Em `backend/test/monthly-closing.test.js`, substitua o bloco de testes de `buildMonthlyClosing` por:

```js
// ── montagem ─────────────────────────────────────────────────────────────────
function conta(id, extra) {
  return {
    id, marketplace: 'Mercado Livre', conta: '',
    metaInvestimento: '', metaRoas: '', metaAcos: '', metaTacos: '',
    dataEntrada: '2025-01-01', dataEncerramento: null, criadoEm: '2025-01-01',
    ...extra,
  };
}
function cliente(id, loja, contas, extra) {
  return { id, loja, analista: 'Ana', statusTag: 'em-dia', contas, ...extra };
}
function lanc(account_id, faturamento, investimento, receita_ads) {
  return { account_id, ym: '2026-07', faturamento, investimento, receita_ads };
}

test('conta sem lançamento vem com valores nulos e marcada como não lançada', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    figures: [], closings: [],
  });
  const a = out.clients[0].contas[0];
  assert.equal(a.lancado, false);
  assert.equal(a.totals.faturamento, null);
  assert.equal(a.totals.roas, null);
});

test('lançamento zerado é diferente de ausente', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    figures: [lanc('a1', 0, 0, 0)], closings: [],
  });
  const a = out.clients[0].contas[0];
  assert.equal(a.lancado, true);
  assert.equal(a.totals.faturamento, 0); // zero, não null
  assert.equal(a.totals.roas, null);     // divisor zero
  assert.equal(out.clients[0].incompleto, false);
});

test('razões saem dos valores lançados', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    figures: [lanc('a1', 10000, 1000, 5000)], closings: [],
  });
  const t = out.clients[0].contas[0].totals;
  assert.equal(t.roas, 5);    // 5000/1000
  assert.equal(t.acos, 20);   // 1000/5000
  assert.equal(t.tacos, 10);  // 1000/10000
});

test('lançamento de outro mês não conta', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    figures: [{ account_id: 'a1', ym: '2026-06', faturamento: 999, investimento: 9, receita_ads: 9 }],
    closings: [],
  });
  assert.equal(out.clients[0].contas[0].lancado, false);
  assert.equal(out.clients[0].totals.faturamento, null);
});

test('conta com lançamento entra mesmo fora da janela de datas', () => {
  const fora = conta('a1', { dataEntrada: '2026-09-01', criadoEm: '2026-09-01' });
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [fora])],
    figures: [lanc('a1', 100, 10, 40)], closings: [],
  });
  assert.equal(out.clients.length, 1);
  assert.equal(out.clients[0].contas[0].lancado, true);
});

test('totais do cliente somam só as contas lançadas e recalculam as razões', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1'), conta('a2', { marketplace: 'Shopee' })])],
    figures: [lanc('a1', 39100, 5200, 25000), lanc('a2', 9100, 1210, 5000)],
    closings: [],
  });
  const t = out.clients[0].totals;
  assert.equal(t.faturamento, 48200);
  assert.equal(t.investimento, 6410);
  assert.equal(t.roas, +((30000 / 6410).toFixed(2))); // da soma, não média das razões
  assert.equal(out.clients[0].incompleto, false);
});

test('cliente sem nenhuma conta lançada tem totais nulos e fica incompleto', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    figures: [], closings: [],
  });
  assert.equal(out.clients[0].totals.faturamento, null);
  assert.equal(out.clients[0].totals.roas, null);
  assert.equal(out.clients[0].incompleto, true);
});

test('uma conta lançada e outra não deixa o cliente incompleto', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1'), conta('a2', { marketplace: 'Shopee' })])],
    figures: [lanc('a1', 100, 10, 40)], closings: [],
  });
  assert.equal(out.clients[0].incompleto, true);
  assert.equal(out.clients[0].totals.faturamento, 100); // soma só a lançada
});

test('atingiu vem resolvido por conta, com null para meta ausente', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1', { metaRoas: '4,00', metaAcos: '20,00' })])],
    figures: [lanc('a1', 10000, 1000, 5000)], closings: [],
  });
  const a = out.clients[0].contas[0];
  assert.equal(a.atingiu.roas, true);
  assert.equal(a.atingiu.acos, true);
  assert.equal(a.atingiu.tacos, null);
});

test('resumo conta incompletos, que cruzam com pendentes', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'A', [conta('a1')]), cliente('c2', 'B', [conta('a2')])],
    figures: [lanc('a1', 100, 10, 40)],
    closings: [{ client_id: 'c1', ym: '2026-07', observacoes: 'ok', fechado_em: '2026-08-01', fechado_por: 'u1' }],
  });
  assert.equal(out.resumo.clientes, 2);
  assert.equal(out.resumo.fechados, 1);
  assert.equal(out.resumo.pendentes, 1);
  assert.equal(out.resumo.incompletos, 1); // c2, que também é pendente
});

test('cliente fechado pode estar incompleto', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'A', [conta('a1')])],
    figures: [],
    closings: [{ client_id: 'c1', ym: '2026-07', observacoes: '', fechado_em: '2026-08-01', fechado_por: 'u1' }],
  });
  assert.equal(out.resumo.fechados, 1);
  assert.equal(out.resumo.incompletos, 1);
});

test('ordena pendentes antes de fechados, depois por faturamento desc', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [
      cliente('c1', 'Fechado grande', [conta('a1')]),
      cliente('c2', 'Pendente pequeno', [conta('a2')]),
      cliente('c3', 'Pendente grande', [conta('a3')]),
    ],
    figures: [lanc('a1', 90000, 1, 1), lanc('a2', 100, 1, 1), lanc('a3', 5000, 1, 1)],
    closings: [{ client_id: 'c1', ym: '2026-07', observacoes: '', fechado_em: '2026-08-01', fechado_por: 'u1' }],
  });
  assert.deepEqual(out.clients.map((c) => c.loja), ['Pendente grande', 'Pendente pequeno', 'Fechado grande']);
});

test('cliente sem lançamento não quebra a ordenação por faturamento', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Sem nada', [conta('a1')]), cliente('c2', 'Com valor', [conta('a2')])],
    figures: [lanc('a2', 500, 1, 1)], closings: [],
  });
  assert.deepEqual(out.clients.map((c) => c.loja), ['Com valor', 'Sem nada']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npm test`
Expected: FAIL — os testes novos quebram porque `buildMonthlyClosing` ainda espera `reports` e não devolve `lancado`/`incompleto`/`incompletos`.

- [ ] **Step 3: Reescrever `buildMonthlyClosing`**

Em `backend/src/lib/monthlyClosing.js`, troque o `require` do topo (some `reportMonth`, que só o Painel CS usa agora):

```js
const { ratios } = require('./metrics');
```

Acrescente, logo antes de `buildMonthlyClosing`:

```js
// Conta sem lançamento: tudo nulo, para a tela mostrar "—". Nunca zero — zero
// seria afirmar que não faturou, e ninguém afirmou nada.
const SEM_LANCAMENTO = {
  faturamento: null, investimento: null, receitaAds: null,
  roas: null, acos: null, tacos: null,
};

// Números de um lançamento, com as razões derivadas deles.
function totaisDoLancamento(fig) {
  const faturamento = num(fig.faturamento);
  const investimento = num(fig.investimento);
  const receitaAds = num(fig.receita_ads);
  return { faturamento, investimento, receitaAds, ...ratios(faturamento, investimento, receitaAds) };
}
```

E troque `buildMonthlyClosing` inteira por:

```js
// Monta a tela: uma linha por cliente com conta no mês, cada uma detalhada por
// conta. Recebe tudo pronto do service e não toca o banco.
function buildMonthlyClosing({ clients, figures, closings, ym }) {
  const porConta = new Map();
  for (const f of figures || []) {
    if (f.ym !== ym) continue;
    porConta.set(f.account_id, f);
  }
  const fechamentos = new Map((closings || []).map((c) => [c.client_id, c]));

  const linhas = [];
  for (const c of clients || []) {
    const contas = [];
    for (const a of c.contas || []) {
      const fig = porConta.get(a.id) || null;
      if (!accountInMonth(a, ym, !!fig)) continue;
      const totals = fig ? totaisDoLancamento(fig) : SEM_LANCAMENTO;
      contas.push({
        accountId: a.id,
        marketplace: a.marketplace,
        conta: a.conta || '',
        lancado: !!fig,
        totals,
        metas: {
          investimento: a.metaInvestimento || '',
          roas: a.metaRoas || '',
          acos: a.metaAcos || '',
          tacos: a.metaTacos || '',
        },
        atingiu: {
          roas: metaStatus(totals.roas, a.metaRoas, 'piso'),
          acos: metaStatus(totals.acos, a.metaAcos, 'teto'),
          tacos: metaStatus(totals.tacos, a.metaTacos, 'teto'),
        },
      });
    }
    if (!contas.length) continue; // nenhuma conta no mês → cliente fora

    // total do cliente: soma só as contas lançadas e recalcula as razões DA
    // SOMA. Nenhuma lançada → tudo nulo, mesmo critério da conta.
    const lancadas = contas.filter((x) => x.lancado);
    const soma = lancadas.reduce(
      (a, x) => ({
        faturamento: a.faturamento + x.totals.faturamento,
        investimento: a.investimento + x.totals.investimento,
        receitaAds: a.receitaAds + x.totals.receitaAds,
      }),
      { faturamento: 0, investimento: 0, receitaAds: 0 }
    );
    const totals = lancadas.length
      ? { ...soma, ...ratios(soma.faturamento, soma.investimento, soma.receitaAds) }
      : SEM_LANCAMENTO;

    const f = fechamentos.get(c.id) || null;
    linhas.push({
      clientId: c.id,
      loja: c.loja,
      analista: c.analista || '—',
      statusTag: c.statusTag,
      incompleto: contas.some((x) => !x.lancado),
      totals,
      contas,
      closing: f
        ? { observacoes: f.observacoes || '', fechadoEm: f.fechado_em || null, fechadoPor: f.fechado_por || null }
        : null,
    });
  }

  // pendentes primeiro (é o que falta fazer), depois faturamento desc, depois
  // nome. Faturamento nulo entra como 0 na comparação, senão a subtração vira NaN.
  const fat = (l) => l.totals.faturamento || 0;
  linhas.sort((a, b) => {
    const fa = a.closing && a.closing.fechadoEm ? 1 : 0;
    const fb = b.closing && b.closing.fechadoEm ? 1 : 0;
    return fa - fb
      || fat(b) - fat(a)
      || String(a.loja).localeCompare(String(b.loja), 'pt-BR');
  });

  const fechados = linhas.filter((l) => l.closing && l.closing.fechadoEm).length;
  return {
    ym,
    resumo: {
      clientes: linhas.length,
      fechados,
      pendentes: linhas.length - fechados,
      incompletos: linhas.filter((l) => l.incompleto).length,
    },
    clients: linhas,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npm test`
Expected: PASS, suíte inteira verde.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/monthlyClosing.js backend/test/monthly-closing.test.js
git commit -m "feat(fechamento): montagem a partir dos lancamentos manuais"
```

---

### Task 4: `closingService` lê e grava lançamentos

**Files:**
- Modify: `backend/src/services/closingService.js`

**Interfaces:**
- Consumes: `buildMonthlyClosing({ clients, figures, closings, ym })` (Task 3).
- Produces: `saveFigures(user, clientId, ym, contas)` → `{ salvos, removidos }`. `contas` é um array de `{ accountId, faturamento, investimento, receitaAds }`, com valores `number | null`.

- [ ] **Step 1: Trocar a leitura**

Em `backend/src/services/closingService.js`:

Apague a função `queryWindow` inteira e o `monthRange` do `require` (ninguém mais usa). O require vira:

```js
const { buildMonthlyClosing } = require('../lib/monthlyClosing');
```

Troque o corpo de `getMonthlyClosing` que buscava relatórios:

```js
  let figures = [];
  if (accountIds.length) {
    figures = await db('monthly_figures')
      .whereIn('account_id', accountIds)
      .andWhere({ ym })
      .select('account_id', 'ym', 'faturamento', 'investimento', 'receita_ads');
  }

  const closings = clientIds.length
    ? await db('monthly_closings').whereIn('client_id', clientIds).andWhere({ ym })
    : [];

  return buildMonthlyClosing({ clients, figures, closings, ym });
```

- [ ] **Step 2: Extrair o check de escopo**

`saveClosing` já faz o check de escopo. Extraia para reuso, logo antes de `saveClosing`:

```js
// Escopo de escrita: analista só mexe no próprio cliente. Devolve o cliente
// enriquecido, que já vem filtrado por papel do listClients.
async function clienteNoEscopo(user, clientId) {
  const { clients } = await clientService.listClients(user, {});
  const alvo = clients.find((c) => c.id === clientId);
  if (!alvo) throw notFound('Cliente não encontrado.');
  if (user.papel === 'analista' && alvo.analistaId !== user.id) {
    throw forbidden('Você só pode fechar o mês dos seus clientes.');
  }
  return alvo;
}
```

E em `saveClosing`, troque as seis linhas do check por:

```js
  await clienteNoEscopo(user, clientId);
```

- [ ] **Step 3: Escrever `saveFigures`**

Logo depois de `saveClosing`:

```js
// Grava em lote os lançamentos das contas de um cliente no mês.
// Conta com os três valores nulos tem a linha REMOVIDA (volta a "não lançado") —
// é a única forma de desfazer um lançamento feito na conta errada, já que
// gravar 0 afirmaria que não faturou.
async function saveFigures(user, clientId, ym, contas) {
  const alvo = await clienteNoEscopo(user, clientId);
  const doCliente = new Set((alvo.contas || []).map((a) => a.id));
  for (const c of contas || []) {
    if (!doCliente.has(c.accountId)) {
      throw badRequest(`A conta ${c.accountId} não pertence a este cliente.`);
    }
  }

  const agora = new Date().toISOString();
  let salvos = 0;
  let removidos = 0;

  for (const c of contas || []) {
    const vazio = c.faturamento == null && c.investimento == null && c.receitaAds == null;
    if (vazio) {
      removidos += await db('monthly_figures').where({ account_id: c.accountId, ym }).del();
      continue;
    }
    const valores = {
      faturamento: c.faturamento || 0,
      investimento: c.investimento || 0,
      receita_ads: c.receitaAds || 0,
      atualizado_em: agora,
      atualizado_por: user.id,
    };
    const existente = await db('monthly_figures').where({ account_id: c.accountId, ym }).first();
    if (existente) {
      await db('monthly_figures').where({ id: existente.id }).update(valores);
    } else {
      await db('monthly_figures').insert({
        id: uuid(), account_id: c.accountId, ym, criado_em: agora, ...valores,
      });
    }
    salvos++;
  }

  return { salvos, removidos };
}
```

Acrescente `badRequest` ao require de errors e `saveFigures` ao `module.exports`:

```js
const { notFound, forbidden, badRequest } = require('../lib/errors');
...
module.exports = { getMonthlyClosing, saveClosing, saveFigures, isValidYm };
```

- [ ] **Step 4: Conferir contra o banco local**

```bash
cd backend && node -e "
const db=require('./src/db/knex');
const svc=require('./src/services/closingService');
(async()=>{
  const u=await db('users').where({papel:'admin'}).first();
  let out=await svc.getMonthlyClosing(u,'2026-07');
  const c=out.clients[0]; const a=c.contas[0];
  console.log('antes  ->', c.loja, '| lancado:', a.lancado, '| fat:', a.totals.faturamento, '| incompleto:', c.incompleto);

  console.log('grava  ->', JSON.stringify(await svc.saveFigures(u, c.clientId, '2026-07',
    [{accountId:a.accountId, faturamento:10000, investimento:1000, receitaAds:5000}])));
  out=await svc.getMonthlyClosing(u,'2026-07');
  const a2=out.clients.find(x=>x.clientId===c.clientId).contas[0];
  console.log('depois ->', 'lancado:', a2.lancado, '| fat:', a2.totals.faturamento, '| roas:', a2.totals.roas);

  console.log('apaga  ->', JSON.stringify(await svc.saveFigures(u, c.clientId, '2026-07',
    [{accountId:a.accountId, faturamento:null, investimento:null, receitaAds:null}])));
  out=await svc.getMonthlyClosing(u,'2026-07');
  const a3=out.clients.find(x=>x.clientId===c.clientId).contas[0];
  console.log('final  ->', 'lancado:', a3.lancado, '| fat:', a3.totals.faturamento);
  console.log('tabela vazia?', await db('monthly_figures').count({n:'*'}));
  await db.destroy();
})();"
```
Expected: antes `lancado: false / fat: null`; depois `lancado: true / fat: 10000 / roas: 5`; final volta a `lancado: false / fat: null` e a tabela termina vazia.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/closingService.js
git commit -m "feat(fechamento): service le e grava lancamentos manuais"
```

---

### Task 5: rota de gravação dos lançamentos

**Files:**
- Modify: `backend/src/routes/closings.js`

**Interfaces:**
- Consumes: `closingService.saveFigures(user, clientId, ym, contas)` (Task 4).
- Produces: `PUT /closings/:clientId/:ym/figures`, body `{ contas: [{ accountId, faturamento, investimento, receitaAds }] }` → `{ salvos, removidos }`.

- [ ] **Step 1: Acrescentar a rota**

Em `backend/src/routes/closings.js`, depois do `PUT` que já existe:

```js
// Valor de lançamento: número finito e não negativo, ou null (campo em branco).
function valorValido(v) {
  return v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
}

router.put(
  '/:clientId/:ym/figures',
  asyncHandler(async (req, res) => {
    const { clientId, ym } = req.params;
    if (!closingService.isValidYm(ym)) throw badRequest('Mês inválido. Use o formato AAAA-MM.');
    const contas = (req.body || {}).contas;
    if (!Array.isArray(contas)) throw badRequest('Informe contas como uma lista.');
    for (const c of contas) {
      if (!c || typeof c.accountId !== 'string' || !c.accountId) {
        throw badRequest('Cada conta precisa de um accountId.');
      }
      if (!valorValido(c.faturamento) || !valorValido(c.investimento) || !valorValido(c.receitaAds)) {
        throw badRequest('Faturamento, investimento e receita de Ads devem ser números não negativos ou vazios.');
      }
    }
    res.json(await closingService.saveFigures(req.user, clientId, ym, contas));
  })
);
```

- [ ] **Step 2: Testar a rota de ponta a ponta**

Suba o backend (`cd backend && npm run dev`) e, com um token válido em `$TK` e um `clientId`/`accountId` reais:

```bash
curl -s -X PUT -H "Authorization: Bearer $TK" -H 'Content-Type: application/json' \
  -d '{"contas":[{"accountId":"'$ACC'","faturamento":10000,"investimento":1000,"receitaAds":5000}]}' \
  "http://localhost:4000/closings/$CLI/2026-07/figures"; echo
curl -s -X PUT -H "Authorization: Bearer $TK" -H 'Content-Type: application/json' \
  -d '{"contas":[{"accountId":"'$ACC'","faturamento":-5,"investimento":1,"receitaAds":1}]}' \
  "http://localhost:4000/closings/$CLI/2026-07/figures"; echo
curl -s -X PUT -H "Authorization: Bearer $TK" -H 'Content-Type: application/json' \
  -d '{"contas":"nao é lista"}' "http://localhost:4000/closings/$CLI/2026-07/figures"; echo
```
Expected: o primeiro devolve `{"salvos":1,"removidos":0}`; o segundo e o terceiro devolvem 400 com mensagem em português. Apague a linha criada e derrube o servidor ao terminar.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/closings.js
git commit -m "feat(fechamento): rota de gravacao dos lancamentos"
```

---

### Task 6: método `saveFigures` no cliente HTTP

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-api.js`

**Interfaces:**
- Produces: `window.P4_API.saveFigures(clientId, ym, contas)` → `{ salvos, removidos }`.

- [ ] **Step 1: Acrescentar o método**

Logo depois de `saveClosing` em `design_handoff_sistema_feedbacks/p4-api.js`:

```js
  async function saveFigures(clientId, ym, contas) {
    return apiFetch('/closings/' + encodeURIComponent(clientId) + '/' + encodeURIComponent(ym) + '/figures',
      { method: 'PUT', body: { contas } });
  }
```

E no objeto `window.P4_API`, na linha que já exporta os métodos do fechamento:

```js
    getDashboard, getClosings, saveClosing, saveFigures,
```

- [ ] **Step 2: Validar sintaxe**

Run: `node --check design_handoff_sistema_feedbacks/p4-api.js`
Expected: sem saída (arquivo válido).

- [ ] **Step 3: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-api.js
git commit -m "feat(fechamento): metodo saveFigures no cliente HTTP"
```

---

### Task 7: campos de lançamento na tela, com razões ao vivo

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-closing.jsx`

**Interfaces:**
- Consumes: cada conta do payload agora tem `lancado: boolean` e `totals` com `null` quando não lançada (Task 3).
- Produces: estado `figs` — objeto `{ [accountId]: { faturamento: string, investimento: string, receitaAds: string } }` com o texto cru dos campos; e `mcRatios(fat, inv, rec)`.

- [ ] **Step 1: Helpers de número**

Em `design_handoff_sistema_feedbacks/p4-closing.jsx`, depois de `mcParseNum`:

```js
// Número -> texto do campo, em formato BR. null/undefined vira campo vazio:
// campo em branco é "não lançado", e pré-preencher com zero empurraria o
// usuário a confirmar um dado que ninguém informou (spec §9).
function mcFmtInput(v) {
  if (v === null || v === undefined) return '';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Mesma fórmula do `ratios()` do backend (backend/src/lib/metrics.js). A cópia
// é deliberada: serve só para dar retorno imediato enquanto se digita. A fonte
// de verdade continua sendo o backend, que volta no refetch depois de salvar.
function mcRatios(fat, inv, rec) {
  return {
    roas: inv > 0 ? +(rec / inv).toFixed(2) : null,
    acos: rec > 0 ? +((inv / rec) * 100).toFixed(1) : null,
    tacos: fat > 0 ? +((inv / fat) * 100).toFixed(1) : null,
  };
}

// Mesma regra do `metaStatus()` do backend, pelo mesmo motivo: prévia ao digitar.
function mcMetaStatus(valor, metaRaw, direcao) {
  const meta = mcParseNum(metaRaw);
  if (!(meta > 0)) return null;
  if (valor === null || valor === undefined) return null;
  return direcao === 'piso' ? valor >= meta : valor <= meta;
}
```

- [ ] **Step 2: Estado dos campos**

Junto dos outros `useState`:

```js
  const [figs, setFigs] = React.useState({}); // accountId -> { faturamento, investimento, receitaAds } como texto
```

Em `expandir`, semeie os campos a partir do que veio do backend:

```js
  const expandir = (c) => {
    if (aberto === c.clientId) { setAberto(null); return; }
    setAberto(c.clientId);
    setObs((c.closing && c.closing.observacoes) || '');
    const seed = {};
    for (const a of c.contas) {
      seed[a.accountId] = a.lancado
        ? { faturamento: mcFmtInput(a.totals.faturamento), investimento: mcFmtInput(a.totals.investimento), receitaAds: mcFmtInput(a.totals.receitaAds) }
        : { faturamento: '', investimento: '', receitaAds: '' };
    }
    setFigs(seed);
  };
```

No efeito que já limpa `aberto` e `obs` ao trocar de mês, limpe também os campos:

```js
  React.useEffect(() => {
    setAberto(null);
    setObs('');
    setFigs({});
  }, [ym]);
```

- [ ] **Step 3: Abrir espaço para a quarta coluna de número**

Hoje `MC_COLS` tem 5 colunas e é compartilhada pela tabela principal e pelo
painel expandido. Receita Ads precisa de coluna própria, então passa a ter 6:

```js
const MC_COLS = '1.6fr 1fr 1fr 1fr .7fr 1fr';
//               conta  fatur invest recAds roas  metas/situação
```

Isso obriga a acrescentar uma célula em **três** lugares — os dois cabeçalhos e a
linha de cliente da tabela principal. Erre um e as colunas desalinham.

1. **Cabeçalho da tabela principal:** insira `<span style={{ textAlign: 'right' }}>Receita Ads</span>` entre "Investimento" e "ROAS".
2. **Linha de cliente da tabela principal:** insira, entre a célula de investimento e a de ROAS:

```jsx
                      <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcMoney(c.totals.receitaAds)}</span>
```

3. **Cabeçalho do painel expandido** (criado no próximo passo): já nasce com as 6.

- [ ] **Step 4: Renderizar os campos no painel expandido**

Acrescente a linha de rótulos logo antes do `c.contas.map`:

```jsx
                        <div style={{ display: 'grid', gridTemplateColumns: MC_COLS, gap: 10, padding: '0 0 6px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                          <span>Conta</span>
                          <span style={{ textAlign: 'right' }}>Faturamento</span>
                          <span style={{ textAlign: 'right' }}>Investimento</span>
                          <span style={{ textAlign: 'right' }}>Receita Ads</span>
                          <span style={{ textAlign: 'right' }}>ROAS</span>
                          <span style={{ textAlign: 'right' }}>Metas</span>
                        </div>
```

Dentro do `c.contas.map((a) => {...})`, troque o cálculo de `orcamento`/`pctOrcamento` por:

```js
                          const f = figs[a.accountId] || { faturamento: '', investimento: '', receitaAds: '' };
                          const vFat = mcParseNum(f.faturamento);
                          const vInv = mcParseNum(f.investimento);
                          const vRec = mcParseNum(f.receitaAds);
                          const vazio = vFat == null && vInv == null && vRec == null;
                          // razões ao vivo do que está digitado; nulas enquanto nada foi lançado
                          const viva = vazio ? { roas: null, acos: null, tacos: null }
                                             : mcRatios(vFat || 0, vInv || 0, vRec || 0);
                          const orcamento = mcParseNum(a.metas.investimento);
                          const pctOrcamento = orcamento && vInv != null ? (vInv / orcamento) * 100 : null;
                          const campo = (chave) => (
                            <input value={f[chave]}
                                   onChange={(e) => setFigs((m) => ({ ...m, [a.accountId]: { ...f, [chave]: e.target.value } }))}
                                   inputMode="decimal" placeholder="—"
                                   style={{ width: '100%', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5, padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 7, background: 'var(--paper)', color: 'var(--ink)' }} />
                          );
```

E o corpo da linha da conta vira, na ordem das 6 colunas:

```jsx
                            <span style={{ color: 'var(--ink-2)' }}>
                              {a.marketplace}{a.conta ? ' · ' + a.conta : ''}
                              {vazio ? <span title="conta sem lançamento neste mês" style={{ color: 'var(--amber-ink)', marginLeft: 6 }}>⚠</span> : null}
                            </span>
                            {campo('faturamento')}
                            {campo('investimento')}
                            {campo('receitaAds')}
                            <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcRoas(viva.roas)}</span>
                            <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                              <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                                <McMeta ok={mcMetaStatus(viva.roas, a.metas.roas, 'piso')} meta={a.metas.roas} sufixo="x" />
                              </span>
                              <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                                <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{mcPct(viva.acos)}</span>
                                <McMeta ok={mcMetaStatus(viva.acos, a.metas.acos, 'teto')} meta={a.metas.acos} sufixo="%" />
                              </span>
                              <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                                <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{mcPct(viva.tacos)}</span>
                                <McMeta ok={mcMetaStatus(viva.tacos, a.metas.tacos, 'teto')} meta={a.metas.tacos} sufixo="%" />
                              </span>
                              {pctOrcamento != null ? (
                                <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                                  <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{mcPct(pctOrcamento)}</span>
                                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>do orçamento</span>
                                </span>
                              ) : null}
                            </span>
```

- [ ] **Step 5: Validar sintaxe e o alinhamento das colunas**

Run: `npx --yes esbuild@0.24 --loader:.jsx=jsx --outfile=/dev/null design_handoff_sistema_feedbacks/p4-closing.jsx`
Expected: compila sem erro.

Depois confirme que os três blocos que usam `MC_COLS` têm **6 filhos diretos cada**:
o cabeçalho da tabela, a linha de cliente e as duas linhas do painel (rótulos e
conta). Contar à mão aqui é mais barato que descobrir na tela.

- [ ] **Step 6: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-closing.jsx
git commit -m "feat(fechamento): campos de lancamento com razoes ao vivo"
```

---

### Task 8: gravação dos lançamentos e resumo de incompletos

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-closing.jsx`

**Interfaces:**
- Consumes: `window.P4_API.saveFigures(clientId, ym, contas)` (Task 6); `resumo.incompletos` e `client.incompleto` (Task 3).

- [ ] **Step 1: Gravar os números antes da observação**

Troque `gravar` por:

```js
  // Uma ação para o usuário, duas chamadas por baixo, NESTA ORDEM: primeiro os
  // lançamentos, depois a observação/estado. Se a primeira falhar a segunda nem
  // dispara — fechar um mês cujos números não gravaram é pior que o inverso.
  const gravar = async (c, fechado) => {
    if (salvando) return;
    setSalvando(true);
    try {
      const contas = c.contas.map((a) => {
        const f = figs[a.accountId] || {};
        return {
          accountId: a.accountId,
          faturamento: mcParseNum(f.faturamento),
          investimento: mcParseNum(f.investimento),
          receitaAds: mcParseNum(f.receitaAds),
        };
      });
      await window.P4_API.saveFigures(c.clientId, ym, contas);
      await window.P4_API.saveClosing(c.clientId, ym, { observacoes: obs, fechado });
      toast(fechado === true ? 'Mês fechado.' : fechado === false ? 'Mês reaberto.' : 'Lançamentos salvos.');
      setRecarregar((n) => n + 1);
    } catch (e) {
      toast(e.message || 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  };
```

Renomeie o botão: `Salvar observação` vira `Salvar`.

**Reabrir não grava números.** Troque o botão de reabrir para chamar uma função própria:

```js
  const reabrir = async (c) => {
    if (salvando) return;
    setSalvando(true);
    try {
      await window.P4_API.saveClosing(c.clientId, ym, { fechado: false });
      toast('Mês reaberto.');
      setRecarregar((n) => n + 1);
    } catch (e) {
      toast(e.message || 'Falha ao reabrir.');
    } finally {
      setSalvando(false);
    }
  };
```

e no JSX: `onClick={() => reabrir(c)}`.

- [ ] **Step 2: Trocar o resumo e o aviso da linha**

No resumo do topo, troque o bloco de `semRelatorio` por:

```jsx
                {r.incompletos ? (
                  <>
                    <span style={{ color: 'var(--muted)' }}>·</span>
                    <span style={{ color: 'var(--amber-ink)' }}>⚠ <b>{r.incompletos}</b> incompletos</span>
                  </>
                ) : null}
```

Na linha do cliente, troque o aviso que olhava `nReports` por:

```jsx
                        {c.incompleto ? <span title="cliente com conta sem lançamento neste mês" style={{ color: 'var(--amber-ink)' }}>⚠ </span> : null}
```

Apague a constante `MC_SEM_RELATORIO_ESPERADO` — ela existia para suprimir o aviso de "sem relatório" em cliente pausado/onboarding/encerrado, e agora o aviso é sobre lançamento, que se aplica a qualquer cliente listado.

- [ ] **Step 3: Ajustar textos que ainda falam em relatório**

- O estado de carregamento diz "Buscando os relatórios do mês." → "Buscando os lançamentos do mês."
- O subtítulo diz "Consolidado do mês por cliente, comparado com as metas cadastradas" → "Números lançados no mês por cliente, comparados com as metas cadastradas".
- O comentário do topo do arquivo diz "Consolidado do mês por cliente (expansível em contas) contra as metas." → "Números do mês lançados por conta, comparados com as metas."

- [ ] **Step 4: Validar sintaxe**

Run: `npx --yes esbuild@0.24 --loader:.jsx=jsx --outfile=/dev/null design_handoff_sistema_feedbacks/p4-closing.jsx`
Expected: compila sem erro. Depois releia o arquivo e confirme que `nReports` não aparece mais em lugar nenhum (`grep -n nReports design_handoff_sistema_feedbacks/p4-closing.jsx` deve não retornar nada).

- [ ] **Step 5: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-closing.jsx
git commit -m "feat(fechamento): salvar lancamentos e resumo de incompletos"
```

---

### Task 9: liberar a tela para analistas

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-shell.jsx`

- [ ] **Step 1: Tirar o gate da sidebar**

Em `design_handoff_sistema_feedbacks/p4-shell.jsx`, o item "Fechamento" está dentro de um ternário condicionado a `seesPanel`. Troque-o por um botão sem condição, no mesmo formato dos outros itens incondicionais (como "Clientes" e "Configurações"):

```jsx
        <button className={'as-item' + (screen === 'closing' ? ' on' : '')} onClick={() => onNav('closing')} title="Fechamento mensal">
          {docIcon}<span>Fechamento</span>
        </button>
```

Deixe o item "Painel CS" como está — ele continua restrito a admin e CS.

O backend já escopa: `listClients` filtra por `analista_id` e `clienteNoEscopo` recusa cliente de outro analista. Nenhuma mudança de permissão é necessária.

- [ ] **Step 2: Validar sintaxe e conferir o diff**

```bash
npx --yes esbuild@0.24 --loader:.jsx=jsx --outfile=/dev/null design_handoff_sistema_feedbacks/p4-shell.jsx
git diff --stat design_handoff_sistema_feedbacks/p4-shell.jsx
```
Expected: compila sem erro, e o diff mostra poucas linhas. Se mostrar centenas, o arquivo teve os fins de linha reescritos — corrija antes de commitar.

- [ ] **Step 3: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-shell.jsx
git commit -m "feat(fechamento): liberar a tela para analistas"
```

---

## Self-review deste plano

**Cobertura do spec:**

| seção do spec | task |
|---|---|
| 2 — o que sai (`consolidate`, consulta de relatórios, `nReports`) | 2, 3, 4, 8 |
| 3 — modelo de dados `monthly_figures` | 1 |
| 4 — só três campos, razões calculadas | 3 (backend), 7 (tela) |
| 5 — quem entra no mês | 2 |
| 6 — resumo com `incompletos` | 3 (backend), 8 (tela) |
| 7 — acesso do analista | 9 |
| 8 — fechar com conta incompleta permitido | 8 (nenhum bloqueio no botão) |
| 9 — tela, campos, ordem de gravação | 7, 8 |
| 10 — backend | 3, 4, 5 |
| 11 — testes | 2, 3 |

**Consistência de tipos:** `figures` são linhas snake_case (`account_id`, `receita_ads`) em 3 e 4. `contas` no `saveFigures` e na rota é camelCase (`accountId`, `receitaAds`) em 4, 5, 6 e 8. `lancado`/`incompleto` são booleanos em 3, 7 e 8. `totals.*` é `number | null` em 3, 7 e 8.

**Ponto de atenção:** a Task 2 pode não fechar sozinha, porque `buildMonthlyClosing` ainda chama `consolidate`. O Step 4 dela diz explicitamente o que fazer nesse caso — juntar com a Task 3 no mesmo commit — em vez de deixar o implementador improvisar.

**Risco de layout na Task 7:** `MC_COLS` muda de 5 para 6 colunas e isso afeta a tabela principal e o painel expandido, que compartilham a constante. O Step 3 isola essa mudança e lista as três posições que precisam ganhar célula; o Step 5 manda contar os filhos de cada bloco. É a parte mais fácil de errar por descuido, e a conferência visual final fica com o humano.
