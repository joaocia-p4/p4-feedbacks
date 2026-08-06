# Faturômetro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir uma tela exclusiva de admin que mostra, ao vivo, quanto a carteira inteira de clientes está faturando no Mercado Livre hoje e no mês.

**Architecture:** Um **livro de pedidos** (`faturometro_orders`, chaveado pelo `order_id` do ML) é alimentado por três caminhos idempotentes — webhook `orders_v2` em tempo real, reconciliação de segurança e backfill histórico. Um consolidado por conta/dia (`faturometro_daily`) é o que a tela lê, mantendo o `GET` em uma consulta. Toda a matemática vive em funções puras testáveis (`lib/faturometro.js`); o I/O vive em `lib/faturometroSync.js` (escrita) e `services/faturometroService.js` (leitura).

**Tech Stack:** Node 18+, Express, Knex (SQLite em dev / Postgres em prod), `node --test`. Frontend estático em JSX transpilado no browser por Babel standalone — **sem build step e sem bibliotecas novas**.

**Spec:** `docs/superpowers/specs/2026-08-06-faturometro-design.md`

## Global Constraints

- **Ids em migrations vão como `t.string`, NUNCA `t.uuid`.** No Postgres a coluna nativa quebra a FK contra o `varchar` de `accounts.id` e derruba o boot.
- **Fuso do negócio:** sempre via `lib/p4.js` (`businessDateISO`, `todayISO`, `businessTimezone`). Nunca reimplementar conversão de fuso. Testes fixam `process.env.BUSINESS_TZ = 'America/Sao_Paulo'`.
- **Faturamento é BRUTO:** Σ `total_amount` de todo pedido criado no recorte, **sem filtrar status**. Mesma definição do relatório.
- **Escopo da soma:** contas com conexão ativa e `accounts.ativo !== false`. Isso implementa "cliente Encerrado fora" (encerrado = todas as contas com `ativo=false`) e ainda descarta contas encerradas de clientes ativos.
- **Preço médio = faturamento ÷ unidades** (não ÷ pedidos).
- **A tela é só para `papel === 'admin'`.**
- **Nenhuma dependência nova**, nem no backend nem no frontend. Gráfico é SVG à mão, no padrão do `MiniLineChart` de `report.jsx`.
- **Testes:** `node --test`, `fetch` do ML sempre mockado, nenhuma chamada de rede real. Os testes que tocam banco usam SQLite descartável via `process.env.SQLITE_FILE`, no padrão de `test/update-client.test.js`, e ligam `FATUROMETRO_BACKGROUND=off` para o motor de segundo plano não sair batendo na API real no meio da suíte.
- **`clients` exige `analista_id` e `agenda_freq`** (ambos NOT NULL): todo seed de teste precisa criar um usuário antes do cliente.
- Comentários e mensagens de commit em **português**, como o resto do repositório.

## File Structure

**Criados**

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/db/migrations/20260806000001_faturometro.js` | As três tabelas |
| `backend/src/lib/faturometro.js` | Matemática pura: fuso, somas, curva por hora, janelas de comparação, normalização do pedido |
| `backend/src/lib/faturometroSync.js` | Escrita: webhook, reconciliação, backfill, expurgo |
| `backend/src/services/faturometroService.js` | Leitura: monta o payload do `GET` a partir do banco |
| `backend/src/routes/faturometro.js` | Rotas |
| `backend/test/faturometro.test.js` | Funções puras |
| `backend/test/faturometro-sync.test.js` | Escrita, contra SQLite descartável |
| `design_handoff_sistema_feedbacks/p4-faturometro.jsx` | A tela |

**Modificados**

| Arquivo | Mudança |
|---|---|
| `backend/src/services/meliService.js` | Ganha `ordersOfDay()` e `fetchOrder()`; `ordersTotals()` passa a somar em cima de `ordersOfDay()` |
| `backend/src/routes/integrations.js` | Webhook processa `orders_v2` |
| `backend/src/app.js` | Registra `/faturometro` |
| `design_handoff_sistema_feedbacks/p4-api.js` | `getFaturometro()`, `reconciliarFaturometro()` |
| `design_handoff_sistema_feedbacks/p4-shell.jsx` | Item no Sidebar (só admin) + rota da tela |
| `design_handoff_sistema_feedbacks/index.html` | `<script>` da tela + CSS |

---

### Task 1: Funções puras do Faturômetro

Toda a matemática, sem tocar banco nem rede. É o que torna o resto testável.

**Files:**
- Create: `backend/src/lib/faturometro.js`
- Test: `backend/test/faturometro.test.js`

**Interfaces:**
- Consumes: `lib/p4.js` → `businessDateISO(value)`, `businessTimezone()`; `lib/monthlyClosing.js` → `monthRange(ym)`
- Produces:
  - `businessTimeOf(value) → 'HH:MM:SS'`
  - `businessHourOf(value) → 0..23`
  - `round2(n) → number`
  - `addDaysISO(iso, n) → 'YYYY-MM-DD'`
  - `sumOrders(orders) → { faturamento, pedidos, unidades, compradores, precoMedio }`
  - `untilTimeOfDay(orders, 'HH:MM:SS') → orders[]`
  - `hourlySeries(hoje, ontem) → [{ h, hoje, ontem }]` (24 itens)
  - `variacao(atual, anterior) → number | null`
  - `previousMonthWindow(hojeISO) → { ym, completosAte, diaParcial, parcial }`
  - `orderRow(raw, accountId) → { order_id, account_id, dia, criado_em_ml, total_amount, unidades, comprador_id } | null`

  Um "order" nas funções acima é sempre uma **linha do livro** (campos `total_amount`, `unidades`, `comprador_id`, `criado_em_ml`), nunca a resposta crua do ML — `orderRow` é quem converte uma na outra.

- [ ] **Step 1: Escrever os testes que falham**

Crie `backend/test/faturometro.test.js`:

```js
// Testes de lib/faturometro — matemática do Faturômetro. Puros, sem banco.
// Roda com `npm test` (node --test).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BUSINESS_TZ = 'America/Sao_Paulo';

const {
  businessTimeOf, businessHourOf, round2, addDaysISO, sumOrders,
  untilTimeOfDay, hourlySeries, variacao, previousMonthWindow, orderRow,
} = require('../src/lib/faturometro');

// Pedido do livro (não a resposta crua do ML).
function ped(criado, valor, unidades, comprador) {
  return { criado_em_ml: criado, total_amount: valor, unidades, comprador_id: comprador };
}

// ── fuso ─────────────────────────────────────────────────────────────────────
test('horário sai no fuso de São Paulo, não em UTC', () => {
  // 2026-08-06T13:45:28Z = 10:45:28 em São Paulo (-03:00)
  assert.equal(businessTimeOf('2026-08-06T13:45:28.000Z'), '10:45:28');
});

test('meia-noite em São Paulo vira 00, não 24', () => {
  assert.equal(businessTimeOf('2026-08-06T03:00:00.000Z'), '00:00:00');
  assert.equal(businessHourOf('2026-08-06T03:00:00.000Z'), 0);
});

test('hora sai como número de 0 a 23', () => {
  assert.equal(businessHourOf('2026-08-06T13:45:28.000Z'), 10);
  assert.equal(businessHourOf('2026-08-07T02:59:00.000Z'), 23); // 23h59 do dia 6 em SP
});

test('pedido às 23h50 de São Paulo fica no dia de São Paulo', () => {
  // 2026-08-07T02:50:00Z = 23:50 do dia 06 em SP
  const row = orderRow(
    { id: 1, date_created: '2026-08-07T02:50:00.000Z', total_amount: 100, order_items: [] },
    'acc-1'
  );
  assert.equal(row.dia, '2026-08-06');
});

// ── arredondamento e datas ───────────────────────────────────────────────────
test('round2 corta na segunda casa', () => {
  assert.equal(round2(219.8586), 219.86);
  assert.equal(round2(null), 0);
});

test('addDaysISO anda para frente e para trás atravessando o mês', () => {
  assert.equal(addDaysISO('2026-08-01', -1), '2026-07-31');
  assert.equal(addDaysISO('2026-08-06', 1), '2026-08-07');
  assert.equal(addDaysISO('2026-02-28', 1), '2026-03-01');
});

// ── soma ─────────────────────────────────────────────────────────────────────
test('soma faturamento, pedidos, unidades e compradores distintos', () => {
  const r = sumOrders([
    ped('2026-08-06T12:00:00Z', 100.5, 2, 'b1'),
    ped('2026-08-06T13:00:00Z', 200.25, 3, 'b2'),
    ped('2026-08-06T14:00:00Z', 50, 1, 'b1'), // comprador repetido
  ]);
  assert.equal(r.faturamento, 350.75);
  assert.equal(r.pedidos, 3);
  assert.equal(r.unidades, 6);
  assert.equal(r.compradores, 2);
});

test('preço médio é faturamento dividido por UNIDADES', () => {
  const r = sumOrders([ped('2026-08-06T12:00:00Z', 4836.89, 22, 'b1')]);
  assert.equal(r.precoMedio, 219.86);
});

test('sem unidades o preço médio é zero, não infinito', () => {
  const r = sumOrders([ped('2026-08-06T12:00:00Z', 100, 0, 'b1')]);
  assert.equal(r.precoMedio, 0);
});

test('lista vazia soma zero', () => {
  const r = sumOrders([]);
  assert.deepEqual(
    { f: r.faturamento, p: r.pedidos, u: r.unidades, c: r.compradores },
    { f: 0, p: 0, u: 0, c: 0 }
  );
});

// ── corte "até o mesmo horário" ──────────────────────────────────────────────
test('corte por horário mantém o que veio antes e descarta o resto', () => {
  const pedidos = [
    ped('2026-08-05T12:00:00Z', 10, 1, 'b1'), // 09:00 SP
    ped('2026-08-05T16:00:00Z', 20, 1, 'b2'), // 13:00 SP
  ];
  assert.equal(untilTimeOfDay(pedidos, '10:45:28').length, 1);
  assert.equal(untilTimeOfDay(pedidos, '23:59:59').length, 2);
  assert.equal(untilTimeOfDay(pedidos, '00:00:01').length, 0);
});

// ── curva por hora ───────────────────────────────────────────────────────────
test('curva por hora tem 24 baldes e soma bate com o dia', () => {
  const hoje = [ped('2026-08-06T13:00:00Z', 100, 1, 'b1'), ped('2026-08-06T13:30:00Z', 50, 1, 'b2')];
  const ontem = [ped('2026-08-05T15:00:00Z', 80, 1, 'b3')];
  const serie = hourlySeries(hoje, ontem);

  assert.equal(serie.length, 24);
  assert.equal(serie[10].hoje, 150); // 13Z = 10h SP
  assert.equal(serie[12].ontem, 80); // 15Z = 12h SP
  assert.equal(serie.reduce((s, x) => s + x.hoje, 0), 150);
  assert.equal(serie.reduce((s, x) => s + x.ontem, 0), 80);
});

test('curva por hora com listas vazias devolve 24 zeros', () => {
  const serie = hourlySeries([], []);
  assert.equal(serie.length, 24);
  assert.equal(serie.every((x) => x.hoje === 0 && x.ontem === 0), true);
});

// ── variação ─────────────────────────────────────────────────────────────────
test('variação é a diferença relativa', () => {
  assert.equal(variacao(118, 100), 0.18);
  assert.equal(variacao(90, 100), -0.1);
});

test('anterior zerado devolve null, não infinito', () => {
  assert.equal(variacao(100, 0), null);
  assert.equal(variacao(0, 0), null);
});

// ── janela do mês anterior ───────────────────────────────────────────────────
test('mês anterior: dias completos até D-1 mais o dia D parcial', () => {
  assert.deepEqual(previousMonthWindow('2026-08-06'), {
    ym: '2026-07', completosAte: '2026-07-05', diaParcial: '2026-07-06', parcial: true,
  });
});

test('no dia 1 não há dias completos, só o parcial', () => {
  assert.deepEqual(previousMonthWindow('2026-08-01'), {
    ym: '2026-07', completosAte: null, diaParcial: '2026-07-01', parcial: true,
  });
});

test('mês anterior sem o dia equivalente compara com o mês inteiro', () => {
  // 31 de agosto: julho tem 31, mas junho (visto de 31/07) não teria.
  assert.deepEqual(previousMonthWindow('2026-07-31'), {
    ym: '2026-06', completosAte: '2026-06-30', diaParcial: null, parcial: false,
  });
});

test('janeiro compara com dezembro do ano anterior', () => {
  assert.equal(previousMonthWindow('2026-01-10').ym, '2025-12');
});

// ── normalização do pedido do ML ─────────────────────────────────────────────
test('orderRow extrai valor, unidades e comprador da resposta do ML', () => {
  const row = orderRow({
    id: 2000003508419013,
    date_created: '2026-08-06T13:45:28.000-03:00',
    total_amount: 219.9,
    order_items: [{ quantity: 2 }, { quantity: 1 }],
    buyer: { id: 987654 },
  }, 'acc-1');

  assert.equal(row.order_id, '2000003508419013');
  assert.equal(row.account_id, 'acc-1');
  assert.equal(row.total_amount, 219.9);
  assert.equal(row.unidades, 3);
  assert.equal(row.comprador_id, '987654');
});

test('orderRow devolve null quando falta id ou data', () => {
  assert.equal(orderRow({ total_amount: 10 }, 'acc-1'), null);
  assert.equal(orderRow({ id: 1 }, 'acc-1'), null);
  assert.equal(orderRow(null, 'acc-1'), null);
});

test('orderRow aguenta pedido sem itens e sem comprador', () => {
  const row = orderRow({ id: 5, date_created: '2026-08-06T13:00:00Z', total_amount: 10 }, 'acc-1');
  assert.equal(row.unidades, 0);
  assert.equal(row.comprador_id, null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npm test -- test/faturometro.test.js`
Expected: FAIL — `Cannot find module '../src/lib/faturometro'`

- [ ] **Step 3: Implementar**

Crie `backend/src/lib/faturometro.js`:

```js
// faturometro — matemática pura do Faturômetro. Sem banco, sem rede.
// Um "pedido" aqui é sempre uma LINHA DO LIVRO (faturometro_orders); a resposta
// crua da API do Mercado Livre só aparece em orderRow(), que converte uma na outra.
const { businessDateISO, businessTimezone } = require('./p4');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// 'HH:MM:SS' de um instante no fuso do negócio. hourCycle:'h23' é o que garante
// 00 (e não 24) à meia-noite — hour12:false varia entre versões do ICU.
function businessTimeOf(value) {
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d)) return '00:00:00';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: businessTimezone(),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

function businessHourOf(value) {
  return Number(businessTimeOf(value).slice(0, 2)) || 0;
}

// Anda dias numa data pura. Meio-dia UTC para não escorregar por fuso/DST.
function addDaysISO(iso, n) {
  const d = new Date(String(iso) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}

function sumOrders(orders) {
  const list = orders || [];
  let faturamento = 0;
  let unidades = 0;
  const compradores = new Set();
  for (const o of list) {
    faturamento += Number(o.total_amount) || 0;
    unidades += Number(o.unidades) || 0;
    if (o.comprador_id) compradores.add(String(o.comprador_id));
  }
  faturamento = round2(faturamento);
  return {
    faturamento,
    pedidos: list.length,
    unidades,
    compradores: compradores.size,
    // Preço médio é por UNIDADE, não por pedido — é assim que o painel do ML mostra.
    precoMedio: unidades > 0 ? round2(faturamento / unidades) : 0,
  };
}

// Recorte "até o mesmo horário": o que impede a tela de acusar queda toda manhã
// por comparar meio dia contra um dia inteiro.
function untilTimeOfDay(orders, hhmmss) {
  const limite = String(hhmmss || '23:59:59');
  return (orders || []).filter((o) => businessTimeOf(o.criado_em_ml) <= limite);
}

function hourlySeries(hoje, ontem) {
  const zeros = () => Array.from({ length: 24 }, () => 0);
  const a = zeros();
  const b = zeros();
  for (const o of hoje || []) a[businessHourOf(o.criado_em_ml)] += Number(o.total_amount) || 0;
  for (const o of ontem || []) b[businessHourOf(o.criado_em_ml)] += Number(o.total_amount) || 0;
  return a.map((_, h) => ({ h, hoje: round2(a[h]), ontem: round2(b[h]) }));
}

// null quando não há base de comparação — a tela mostra "—", nunca "+∞".
function variacao(atual, anterior) {
  const base = Number(anterior) || 0;
  if (base === 0) return null;
  return Math.round(((Number(atual) || 0) - base) / base * 10000) / 10000;
}

// Janela equivalente do mês anterior. `parcial:false` sinaliza a borda em que o
// mês anterior não tem o dia de hoje (hoje é 31, ele tem 30) — aí compara-se com
// o mês INTEIRO e a tela troca o rótulo.
function previousMonthWindow(hojeISO) {
  const [y, m, d] = String(hojeISO).split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const ym = `${py}-${String(pm).padStart(2, '0')}`;
  const dd = (n) => `${ym}-${String(n).padStart(2, '0')}`;
  const ultimoDia = new Date(Date.UTC(py, pm, 0)).getUTCDate();

  if (d > ultimoDia) {
    return { ym, completosAte: dd(ultimoDia), diaParcial: null, parcial: false };
  }
  return { ym, completosAte: d === 1 ? null : dd(d - 1), diaParcial: dd(d), parcial: true };
}

// Resposta crua de GET /orders/{id} → linha do livro. null quando o pedido não
// tem o mínimo (id + data de criação) para ser contado.
function orderRow(raw, accountId) {
  if (!raw || raw.id == null || !raw.date_created) return null;
  const unidades = (raw.order_items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  return {
    order_id: String(raw.id),
    account_id: accountId,
    dia: businessDateISO(raw.date_created),
    criado_em_ml: String(raw.date_created),
    total_amount: round2(raw.total_amount),
    unidades,
    comprador_id: raw.buyer && raw.buyer.id != null ? String(raw.buyer.id) : null,
  };
}

module.exports = {
  round2, businessTimeOf, businessHourOf, addDaysISO, sumOrders,
  untilTimeOfDay, hourlySeries, variacao, previousMonthWindow, orderRow,
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npm test -- test/faturometro.test.js`
Expected: PASS, 22 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/faturometro.js backend/test/faturometro.test.js
git commit -m "feat(faturometro): matematica pura (fuso, somas, curva por hora, janelas)"
```

---

### Task 2: Migration das três tabelas

**Files:**
- Create: `backend/src/db/migrations/20260806000001_faturometro.js`
- Test: `backend/test/faturometro-sync.test.js` (criado aqui, cresce nas tasks seguintes)

**Interfaces:**
- Produces: tabelas `faturometro_orders`, `faturometro_daily`, `faturometro_sync` com as colunas usadas por todas as tasks seguintes.

- [ ] **Step 1: Escrever o teste que falha**

Crie `backend/test/faturometro-sync.test.js`:

```js
// Testes da escrita do Faturômetro (livro de pedidos, reconciliação, backfill).
// Roda contra um SQLite descartável — mesmo padrão de update-client.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-fat-'));
process.env.SQLITE_FILE = path.join(tmpDir, 'test.sqlite');
process.env.BUSINESS_TZ = 'America/Sao_Paulo';
process.env.FATUROMETRO_BACKGROUND = 'off'; // sem motor de segundo plano no teste
delete process.env.DATABASE_URL; // garante SQLite mesmo com .env de produção

const db = require('../src/db/knex');

test.before(async () => {
  await db.migrate.latest();
});

test.after(async () => {
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── esquema ──────────────────────────────────────────────────────────────────
test('as três tabelas do Faturômetro existem', async () => {
  assert.equal(await db.schema.hasTable('faturometro_orders'), true);
  assert.equal(await db.schema.hasTable('faturometro_daily'), true);
  assert.equal(await db.schema.hasTable('faturometro_sync'), true);
});

test('o livro tem as colunas que a curva por hora e os compradores exigem', async () => {
  for (const col of ['order_id', 'account_id', 'dia', 'criado_em_ml', 'total_amount', 'unidades', 'comprador_id']) {
    assert.equal(await db.schema.hasColumn('faturometro_orders', col), true, `faltou ${col}`);
  }
});

test('o consolidado tem as colunas dos totais do mês', async () => {
  for (const col of ['account_id', 'dia', 'faturamento', 'unidades', 'pedidos']) {
    assert.equal(await db.schema.hasColumn('faturometro_daily', col), true, `faltou ${col}`);
  }
});

test('o estado de sincronismo guarda backfill, reconciliação e erro', async () => {
  for (const col of ['account_id', 'backfill_dia', 'backfill_status', 'reconciliado_em', 'erro']) {
    assert.equal(await db.schema.hasColumn('faturometro_sync', col), true, `faltou ${col}`);
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npm test -- test/faturometro-sync.test.js`
Expected: FAIL — `hasTable('faturometro_orders')` devolve `false`.

- [ ] **Step 3: Implementar a migration**

Crie `backend/src/db/migrations/20260806000001_faturometro.js`:

```js
// Faturômetro — faturamento da carteira ao vivo.
//
// faturometro_orders é o LIVRO: uma linha por pedido do Mercado Livre, chaveada
// pelo id do pedido. É essa chave que torna webhook, reconciliação e backfill
// idempotentes — gravar o mesmo pedido de novo atualiza, nunca soma em dobro.
//
// faturometro_daily é o CONSOLIDADO que a tela lê. Sobrevive ao expurgo do livro
// (70 dias), então o histórico não se perde, só a granularidade por hora.
//
// Ids vão como t.string, NUNCA t.uuid: no Postgres a coluna nativa quebraria a FK
// contra o varchar de accounts.id e derrubaria o boot.

exports.up = async function up(knex) {
  await knex.schema.createTable('faturometro_orders', (t) => {
    t.string('order_id').primary(); // id do pedido no ML
    t.string('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('dia', 10).notNullable(); // 'YYYY-MM-DD' no fuso de São Paulo
    t.string('criado_em_ml').notNullable(); // ISO do pedido — dá a curva por hora
    t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
    t.integer('unidades').notNullable().defaultTo(0);
    t.string('comprador_id'); // alimenta "Total de compradores"
    t.string('atualizado_em').notNullable();
    t.index(['account_id', 'dia']);
    t.index(['dia']);
  });

  await knex.schema.createTable('faturometro_daily', (t) => {
    t.string('id').primary();
    t.string('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('dia', 10).notNullable();
    t.decimal('faturamento', 14, 2).notNullable().defaultTo(0);
    t.integer('unidades').notNullable().defaultTo(0);
    t.integer('pedidos').notNullable().defaultTo(0);
    t.string('atualizado_em').notNullable();
    t.unique(['account_id', 'dia']);
  });

  await knex.schema.createTable('faturometro_sync', (t) => {
    t.string('account_id').primary().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('backfill_dia', 10); // dia mais antigo já preenchido; null = nunca rodou
    t.string('backfill_status').notNullable().defaultTo('pendente'); // pendente|rodando|pronto
    t.string('reconciliado_em'); // ISO da última conferência de hoje
    t.text('erro'); // último erro (ex.: token expirado); null quando deu certo
    t.string('atualizado_em').notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('faturometro_sync');
  await knex.schema.dropTableIfExists('faturometro_daily');
  await knex.schema.dropTableIfExists('faturometro_orders');
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npm test -- test/faturometro-sync.test.js`
Expected: PASS, 4 testes.

Depois confirme que a migration também sobe e desce no banco de desenvolvimento:

Run: `cd backend && npm run migrate && npx knex migrate:down && npm run migrate`
Expected: as três saídas terminam sem erro.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrations/20260806000001_faturometro.js backend/test/faturometro-sync.test.js
git commit -m "feat(faturometro): migration do livro de pedidos, consolidado e sync"
```

---

### Task 3: `ordersOfDay()` e `fetchOrder()` no meliService

Hoje `ordersTotals()` varre o `/orders/search` e **descarta** os pedidos, guardando só a soma. O Faturômetro precisa dos pedidos em si. Extraímos a varredura e fazemos `ordersTotals()` somar em cima dela — uma varredura só, sem código duplicado.

**Files:**
- Modify: `backend/src/services/meliService.js:190-218` (`ordersTotals`) e o `module.exports` no fim do arquivo
- Test: `backend/test/faturometro-meli.test.js` (novo)

**Interfaces:**
- Consumes: `meliService.apiGet(accountId, path, opts)` (já existe)
- Produces:
  - `meliService.ordersOfDay(accountId, sellerId, dia) → { pedidos: rawOrder[], erro }`
  - `meliService.fetchOrder(accountId, orderId) → { ok, status, data }`
  - `meliService.ordersTotals(...)` mantém a assinatura e o retorno atuais

- [ ] **Step 1: Escrever o teste que falha**

Crie `backend/test/faturometro-meli.test.js`:

```js
// ordersOfDay/fetchOrder do meliService, com a API do ML mockada.
// Nenhuma chamada de rede real: trocamos global.fetch por um stub.
//
// Por que um SQLite descartável em vez de trocar meli.getValidAccessToken por um
// stub: apiGet chama a função LOCAL do módulo, não a exportada — reatribuir
// meli.getValidAccessToken não teria efeito nenhum. Então damos a ele uma
// conexão de verdade no banco. Sem ENCRYPTION_KEY o token é gravado em texto
// puro (ver lib/secrets.js), o que serve perfeitamente ao teste.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-meli-'));
process.env.SQLITE_FILE = path.join(tmpDir, 'test.sqlite');
process.env.BUSINESS_TZ = 'America/Sao_Paulo';
process.env.MELI_APP_ID = 'app';
process.env.MELI_SECRET = 'segredo';
process.env.MELI_REDIRECT_URI = 'https://exemplo.test/integrations/mercadolivre/callback';
delete process.env.DATABASE_URL;
delete process.env.ENCRYPTION_KEY;

const db = require('../src/db/knex');
const meli = require('../src/services/meliService');

// Guarda as URLs chamadas e devolve as respostas na ordem em que foram enfileiradas.
function mockFetch(respostas) {
  const chamadas = [];
  global.fetch = async (url) => {
    chamadas.push(String(url));
    const body = respostas.shift() || { results: [], paging: { total: 0 } };
    return { ok: true, status: 200, json: async () => body };
  };
  return chamadas;
}

test.before(async () => {
  await db.migrate.latest();
  await db('users').insert({ id: 'u-1', nome: 'Ana', email: 'ana@meli.test', senha_hash: 'x', papel: 'analista' });
  await db('clients').insert({
    id: 'c-1', loja: 'Loja', tipo: 'Loja',
    analista_id: 'u-1', agenda_freq: 'Semanal', agenda_dia_semana: 'Segunda',
  });
  await db('accounts').insert({ id: 'acc-1', client_id: 'c-1', marketplace: 'Mercado Livre', apelido: 'conta', ativo: true });
  await db('meli_connections').insert({
    id: 'conn-1', account_id: 'acc-1', ml_user_id: '9',
    access_token: 'token-de-teste',
    expires_at: new Date(Date.now() + 3600e3).toISOString(),
  });
});

test.after(async () => {
  await db.destroy();
  global.fetch = undefined;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const pedido = (id, valor) => ({ id, date_created: '2026-08-06T13:00:00.000-03:00', total_amount: valor, order_items: [{ quantity: 1 }] });

test('ordersOfDay devolve os pedidos crus do dia', async () => {
  mockFetch([{ results: [pedido(1, 100), pedido(2, 50)], paging: { total: 2 } }]);

  const r = await meli.ordersOfDay('acc-1', 'seller-9', '2026-08-06');

  assert.equal(r.erro, null);
  assert.equal(r.pedidos.length, 2);
  assert.equal(r.pedidos[0].id, 1);
});

test('ordersOfDay pede a janela do dia no fuso -03:00', async () => {
  const chamadas = mockFetch([{ results: [], paging: { total: 0 } }]);

  await meli.ordersOfDay('acc-1', 'seller-9', '2026-08-06');

  assert.match(decodeURIComponent(chamadas[0]), /2026-08-06T00:00:00\.000-03:00/);
  assert.match(decodeURIComponent(chamadas[0]), /2026-08-06T23:59:59\.999-03:00/);
});

test('ordersOfDay pagina até trazer tudo', async () => {
  const pagina1 = { results: Array.from({ length: 50 }, (_, i) => pedido(i, 10)), paging: { total: 60 } };
  const pagina2 = { results: Array.from({ length: 10 }, (_, i) => pedido(100 + i, 10)), paging: { total: 60 } };
  mockFetch([pagina1, pagina2]);

  const r = await meli.ordersOfDay('acc-1', 'seller-9', '2026-08-06');

  assert.equal(r.pedidos.length, 60);
});

test('ordersOfDay devolve o erro do ML sem lançar', async () => {
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'invalid token' }) });

  const r = await meli.ordersOfDay('acc-1', 'seller-9', '2026-08-06');

  assert.equal(r.pedidos.length, 0);
  assert.ok(r.erro);
});

test('ordersTotals continua somando o mesmo, agora em cima de ordersOfDay', async () => {
  mockFetch([{ results: [pedido(1, 100), pedido(2, 50)], paging: { total: 2 } }]);

  const r = await meli.ordersTotals('acc-1', 'seller-9', '2026-08-06', '2026-08-06');

  assert.equal(r.faturamento, 150);
  assert.equal(r.vendas, 2);
  assert.equal(r.pedidos, 2);
});

test('fetchOrder busca um pedido pelo id', async () => {
  const chamadas = mockFetch([pedido(2000003508419013, 219.9)]);

  const r = await meli.fetchOrder('acc-1', '2000003508419013');

  assert.equal(r.ok, true);
  assert.equal(r.data.total_amount, 219.9);
  assert.match(chamadas[0], /\/orders\/2000003508419013$/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npm test -- test/faturometro-meli.test.js`
Expected: FAIL — `meli.ordersOfDay is not a function`

- [ ] **Step 3: Implementar**

Em `backend/src/services/meliService.js`, **substitua** a função `ordersTotals` inteira (linhas 186-218, incluindo o bloco de comentário acima dela) por:

```js
// Pedidos CRUS de um dia (fuso -03:00), paginando o /orders/search. O offset do
// endpoint trava em 1000, por isso a varredura é dia a dia. Não filtra status:
// faturamento é BRUTO, igual ao relatório.
async function ordersOfDay(accountId, sellerId, dia) {
  const pedidos = [];
  let erro = null;
  let offset = 0;
  for (let i = 0; i < 25 && offset < 1000; i++) {
    const q =
      `/orders/search?seller=${encodeURIComponent(sellerId)}` +
      `&order.date_created.from=${encodeURIComponent(dia + 'T00:00:00.000-03:00')}` +
      `&order.date_created.to=${encodeURIComponent(dia + 'T23:59:59.999-03:00')}` +
      `&sort=date_desc&limit=50&offset=${offset}`;
    const r = await apiGet(accountId, q);
    if (!r.ok) { erro = r.data; break; }
    const results = r.data.results || [];
    pedidos.push(...results);
    const total = r.data.paging ? r.data.paging.total : results.length;
    offset += 50;
    if (offset >= total || results.length === 0) break;
  }
  return { pedidos, erro };
}

// Um pedido específico — é o que o webhook chama ao receber uma notificação.
function fetchOrder(accountId, orderId) {
  return apiGet(accountId, `/orders/${encodeURIComponent(orderId)}`);
}

// Faturamento + vendas BRUTAS do período, somando em cima de ordersOfDay.
// faturamento = Σ total_amount · vendas = Σ unidades dos itens.
async function ordersTotals(accountId, sellerId, from, to) {
  let faturamento = 0;
  let vendas = 0;
  let pedidos = 0;
  let erro = null;
  for (const day of dateList(from, to)) {
    const r = await ordersOfDay(accountId, sellerId, day);
    for (const o of r.pedidos) {
      faturamento += o.total_amount || 0;
      vendas += (o.order_items || []).reduce((s, it) => s + (it.quantity || 0), 0);
    }
    pedidos += r.pedidos.length;
    if (r.erro) { erro = r.erro; break; }
  }
  return { faturamento, vendas, pedidos, erro };
}
```

No `module.exports` no fim do arquivo, adicione `ordersOfDay` e `fetchOrder` logo depois de `apiGet`:

```js
  apiGet,
  ordersOfDay,
  fetchOrder,
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npm test`
Expected: PASS — os 6 testes novos e **todos** os que já existiam (o refactor não pode mexer no comportamento de `ordersTotals`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/meliService.js backend/test/faturometro-meli.test.js
git commit -m "feat(meli): ordersOfDay e fetchOrder; ordersTotals soma em cima deles"
```

---

### Task 4: O livro de pedidos — gravar e consolidar

O coração da idempotência: gravar o mesmo pedido duas vezes atualiza, nunca soma de novo.

**Files:**
- Create: `backend/src/lib/faturometroSync.js`
- Modify: `backend/test/faturometro-sync.test.js` (acrescenta ao arquivo da Task 2)

**Interfaces:**
- Consumes: `lib/faturometro.js` → `orderRow`, `round2`; `services/meliService.js` → `fetchOrder`, `getConnection`
- Produces:
  - `saveOrderRow(row) → Promise<row>`
  - `recalcDay(accountId, dia) → Promise<void>`
  - `ingestOrder(accountId, orderId) → Promise<row | null>`

- [ ] **Step 1: Escrever os testes que falham**

**Acrescente** ao fim de `backend/test/faturometro-sync.test.js`:

```js
const faturometro = require('../src/lib/faturometroSync');
const meli = require('../src/services/meliService');

// Cliente + conta + conexão mínimos para as gravações terem FK válida.
// `clients` exige analista_id e agenda_freq (NOT NULL), por isso o usuário vem junto.
async function semear(accountId, mlUserId) {
  await db('users').insert({ id: 'u-fat', nome: 'Ana', email: 'ana@fat.test', senha_hash: 'x', papel: 'analista' })
    .onConflict('id').ignore();
  await db('clients').insert({
    id: 'c-' + accountId, loja: 'Loja ' + accountId, tipo: 'Loja',
    analista_id: 'u-fat', agenda_freq: 'Semanal', agenda_dia_semana: 'Segunda',
  }).onConflict('id').ignore();
  await db('accounts').insert({
    id: accountId, client_id: 'c-' + accountId, marketplace: 'Mercado Livre',
    apelido: 'conta ' + accountId, ativo: true,
  }).onConflict('id').ignore();
  await db('meli_connections').insert({
    id: 'conn-' + accountId, account_id: accountId, ml_user_id: mlUserId,
    access_token: 'x', expires_at: new Date(Date.now() + 3600e3).toISOString(),
  }).onConflict('id').ignore();
}

const cru = (id, valor, unidades, comprador, criado) => ({
  id, date_created: criado || '2026-08-06T13:00:00.000-03:00',
  total_amount: valor, order_items: [{ quantity: unidades }], buyer: { id: comprador },
});

// ── livro de pedidos ─────────────────────────────────────────────────────────
test('gravar um pedido cria a linha do livro e consolida o dia', async () => {
  await semear('acc-livro', '111');
  await faturometro.saveOrderRow(require('../src/lib/faturometro').orderRow(cru(1, 100, 2, 'b1'), 'acc-livro'));

  const dia = await db('faturometro_daily').where({ account_id: 'acc-livro', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 100);
  assert.equal(dia.pedidos, 1);
  assert.equal(dia.unidades, 2);
});

test('gravar o MESMO pedido duas vezes não dobra o número', async () => {
  await semear('acc-idem', '222');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(10, 100, 1, 'b1'), 'acc-idem'));
  await faturometro.saveOrderRow(orderRow(cru(10, 100, 1, 'b1'), 'acc-idem'));

  const dia = await db('faturometro_daily').where({ account_id: 'acc-idem', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 100);
  assert.equal(dia.pedidos, 1);
});

test('update de um pedido corrige o valor em vez de somar por cima', async () => {
  await semear('acc-upd', '333');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(20, 100, 1, 'b1'), 'acc-upd'));
  await faturometro.saveOrderRow(orderRow(cru(20, 250, 3, 'b1'), 'acc-upd')); // mesmo id, valor novo

  const dia = await db('faturometro_daily').where({ account_id: 'acc-upd', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 250);
  assert.equal(dia.unidades, 3);
  assert.equal(dia.pedidos, 1);
});

test('pedido que muda de dia recalcula os DOIS dias', async () => {
  await semear('acc-mudou', '444');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(30, 100, 1, 'b1', '2026-08-05T13:00:00.000-03:00'), 'acc-mudou'));
  await faturometro.saveOrderRow(orderRow(cru(30, 100, 1, 'b1', '2026-08-06T13:00:00.000-03:00'), 'acc-mudou'));

  const antigo = await db('faturometro_daily').where({ account_id: 'acc-mudou', dia: '2026-08-05' }).first();
  const novo = await db('faturometro_daily').where({ account_id: 'acc-mudou', dia: '2026-08-06' }).first();
  assert.equal(Number(antigo.faturamento), 0);
  assert.equal(Number(novo.faturamento), 100);
});

test('ingestOrder busca o pedido no ML e grava', async () => {
  await semear('acc-ingest', '555');
  const original = meli.fetchOrder;
  meli.fetchOrder = async () => ({ ok: true, status: 200, data: cru(40, 300, 2, 'b9') });
  try {
    const row = await faturometro.ingestOrder('acc-ingest', '40');
    assert.equal(row.order_id, '40');
  } finally { meli.fetchOrder = original; }

  const dia = await db('faturometro_daily').where({ account_id: 'acc-ingest', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 300);
});

test('ingestOrder devolve null e registra o erro quando o ML recusa', async () => {
  await semear('acc-erro', '666');
  const original = meli.fetchOrder;
  meli.fetchOrder = async () => ({ ok: false, status: 401, data: { message: 'invalid token' } });
  try {
    assert.equal(await faturometro.ingestOrder('acc-erro', '50'), null);
  } finally { meli.fetchOrder = original; }

  const sync = await db('faturometro_sync').where({ account_id: 'acc-erro' }).first();
  assert.ok(sync.erro, 'esperava o erro registrado em faturometro_sync');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npm test -- test/faturometro-sync.test.js`
Expected: FAIL — `Cannot find module '../src/lib/faturometroSync'`

- [ ] **Step 3: Implementar**

Crie `backend/src/lib/faturometroSync.js`:

```js
// faturometroSync — a ESCRITA do Faturômetro: webhook, reconciliação, backfill
// e expurgo. A leitura mora em services/faturometroService.js.
//
// Tudo aqui é idempotente porque a chave do livro é o id do pedido no ML: os
// três caminhos podem gravar o mesmo pedido à vontade sem inflar o número.
const { v4: uuid } = require('uuid');
const db = require('../db/knex');
const meli = require('../services/meliService');
const { orderRow, round2 } = require('./faturometro');

function agora() {
  return new Date().toISOString();
}

// Marca o estado de sincronismo de uma conta (cria a linha se não existir).
async function marcarSync(accountId, patch) {
  const existing = await db('faturometro_sync').where({ account_id: accountId }).first();
  const dados = { ...patch, atualizado_em: agora() };
  if (existing) {
    await db('faturometro_sync').where({ account_id: accountId }).update(dados);
    return;
  }
  await db('faturometro_sync').insert({ account_id: accountId, backfill_status: 'pendente', ...dados });
}

// Recalcula o consolidado de um dia a partir do livro. É sempre uma soma do
// zero — nunca um incremento — então erra menos e é seguro chamar de novo.
async function recalcDay(accountId, dia) {
  const rows = await db('faturometro_orders').where({ account_id: accountId, dia });
  const patch = {
    faturamento: round2(rows.reduce((s, o) => s + (Number(o.total_amount) || 0), 0)),
    unidades: rows.reduce((s, o) => s + (Number(o.unidades) || 0), 0),
    pedidos: rows.length,
    atualizado_em: agora(),
  };
  const existing = await db('faturometro_daily').where({ account_id: accountId, dia }).first();
  if (existing) {
    await db('faturometro_daily').where({ id: existing.id }).update(patch);
    return;
  }
  await db('faturometro_daily').insert({ id: uuid(), account_id: accountId, dia, ...patch });
}

// Grava (ou atualiza) uma linha do livro e reconsolida o dia afetado.
async function saveOrderRow(row) {
  if (!row) return null;
  const existing = await db('faturometro_orders').where({ order_id: row.order_id }).first();
  const dados = { ...row, atualizado_em: agora() };
  if (existing) await db('faturometro_orders').where({ order_id: row.order_id }).update(dados);
  else await db('faturometro_orders').insert(dados);

  await recalcDay(row.account_id, row.dia);
  // Pedido que mudou de dia (ou de conta) deixa o consolidado antigo desatualizado.
  if (existing && (existing.dia !== row.dia || existing.account_id !== row.account_id)) {
    await recalcDay(existing.account_id, existing.dia);
  }
  return row;
}

// Busca um pedido no ML e grava. Falha do ML vira erro registrado, não exceção:
// o webhook não pode derrubar a resposta e a reconciliação conserta depois.
async function ingestOrder(accountId, orderId) {
  const r = await meli.fetchOrder(accountId, orderId);
  if (!r || !r.ok) {
    await marcarSync(accountId, { erro: `pedido ${orderId}: ${JSON.stringify((r && r.data) || {}).slice(0, 300)}` });
    return null;
  }
  const row = orderRow(r.data, accountId);
  if (!row) return null;
  await marcarSync(accountId, { erro: null });
  return saveOrderRow(row);
}

module.exports = { marcarSync, recalcDay, saveOrderRow, ingestOrder };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npm test -- test/faturometro-sync.test.js`
Expected: PASS, 10 testes (4 de esquema + 6 do livro).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/faturometroSync.js backend/test/faturometro-sync.test.js
git commit -m "feat(faturometro): livro de pedidos idempotente com consolidado por dia"
```

---

### Task 5: Webhook `orders_v2`

**Files:**
- Modify: `backend/src/routes/integrations.js:121-133` (o handler de notificações)
- Modify: `backend/src/lib/faturometroSync.js` (ganha `handleNotification`)
- Modify: `backend/test/faturometro-sync.test.js`

**Interfaces:**
- Consumes: `ingestOrder(accountId, orderId)` da Task 4
- Produces: `faturometroSync.handleNotification(body) → Promise<row | null>`

- [ ] **Step 1: Escrever os testes que falham**

**Acrescente** ao fim de `backend/test/faturometro-sync.test.js`:

```js
// ── webhook ──────────────────────────────────────────────────────────────────
test('notificação de orders_v2 grava o pedido da conta certa', async () => {
  await semear('acc-hook', '777');
  const original = meli.fetchOrder;
  meli.fetchOrder = async (accountId) => {
    assert.equal(accountId, 'acc-hook', 'buscou na conta errada');
    return { ok: true, status: 200, data: cru(60, 400, 1, 'b1') };
  };
  try {
    await faturometro.handleNotification({ topic: 'orders_v2', user_id: 777, resource: '/orders/60' });
  } finally { meli.fetchOrder = original; }

  const dia = await db('faturometro_daily').where({ account_id: 'acc-hook', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 400);
});

test('a mesma notificação repetida não dobra o número', async () => {
  await semear('acc-hook2', '888');
  const original = meli.fetchOrder;
  meli.fetchOrder = async () => ({ ok: true, status: 200, data: cru(70, 400, 1, 'b1') });
  const nota = { topic: 'orders_v2', user_id: 888, resource: '/orders/70' };
  try {
    await faturometro.handleNotification(nota);
    await faturometro.handleNotification(nota);
    await faturometro.handleNotification(nota);
  } finally { meli.fetchOrder = original; }

  const dia = await db('faturometro_daily').where({ account_id: 'acc-hook2', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 400);
  assert.equal(dia.pedidos, 1);
});

test('tópico diferente de orders_v2 é ignorado', async () => {
  const r = await faturometro.handleNotification({ topic: 'items', user_id: 777, resource: '/items/MLB1' });
  assert.equal(r, null);
});

test('user_id sem conexão é ignorado sem quebrar', async () => {
  const r = await faturometro.handleNotification({ topic: 'orders_v2', user_id: 999999, resource: '/orders/1' });
  assert.equal(r, null);
});

test('notificação sem resource é ignorada', async () => {
  const r = await faturometro.handleNotification({ topic: 'orders_v2', user_id: 777 });
  assert.equal(r, null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npm test -- test/faturometro-sync.test.js`
Expected: FAIL — `faturometro.handleNotification is not a function`

- [ ] **Step 3: Implementar**

Em `backend/src/lib/faturometroSync.js`, adicione antes do `module.exports`:

```js
// Notificação do Mercado Livre → pedido no livro. Só nos interessa `orders_v2`;
// qualquer outra coisa (tópico diferente, vendedor que não conectou conosco,
// corpo incompleto) sai em silêncio, porque reenviar não resolveria nada.
async function handleNotification(body) {
  if (!body || body.topic !== 'orders_v2') return null;
  const mlUserId = body.user_id != null ? String(body.user_id) : '';
  const orderId = String(body.resource || '').split('/').filter(Boolean).pop() || '';
  if (!mlUserId || !orderId) return null;

  const conn = await db('meli_connections').where({ ml_user_id: mlUserId }).first();
  if (!conn) return null;
  return ingestOrder(conn.account_id, orderId);
}
```

E inclua `handleNotification` no `module.exports`:

```js
module.exports = { marcarSync, recalcDay, saveOrderRow, ingestOrder, handleNotification };
```

Em `backend/src/routes/integrations.js`, adicione o require junto dos outros no topo do arquivo:

```js
const faturometroSync = require('../lib/faturometroSync');
```

E **substitua** o handler existente (linhas 121-133, do comentário `── Notificações / webhook` até o `router.get('/mercadolivre/notifications', ...)`) por:

```js
// ── Notificações / webhook (público) ─────────────────────────────────────────
// O Mercado Livre espera resposta em ~500ms e reenvia se demorar. Por isso
// respondemos 200 ANTES de processar; o pedido entra no livro do Faturômetro em
// segundo plano. Erro no processamento não pode virar erro de resposta — quem
// conserta o que se perder é a reconciliação.
router.post('/mercadolivre/notifications', (req, res) => {
  const body = req.body || {};
  res.sendStatus(200);
  faturometroSync.handleNotification(body).catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[meli] notificação falhou:', body.topic || '?', body.resource || '', e.message);
  });
});
router.get('/mercadolivre/notifications', (_req, res) => res.sendStatus(200));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npm test`
Expected: PASS — 15 testes em `faturometro-sync.test.js` e nenhuma regressão nos demais.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/faturometroSync.js backend/src/routes/integrations.js backend/test/faturometro-sync.test.js
git commit -m "feat(faturometro): webhook orders_v2 alimentando o livro em tempo real"
```

---

### Task 6: Reconciliação, expurgo e o motor de segundo plano

A rede de proteção: o Render hiberna e perde notificações, então o dia de hoje é reconferido contra a API de Pedidos em rodízio.

**Files:**
- Modify: `backend/src/lib/faturometroSync.js`
- Modify: `backend/test/faturometro-sync.test.js`

**Interfaces:**
- Consumes: `meliService.ordersOfDay`, `meliService.getConnection`, `meliService.apiGet`; `lib/p4.js` → `todayISO`; `lib/faturometro.js` → `orderRow`, `addDaysISO`
- Produces:
  - `reconcileAccount(accountId, dia) → Promise<{ ok, pedidos?, erro? }>`
  - `purgeOldOrders(hojeISO) → Promise<number>` (linhas apagadas)
  - `kick() → void` (dispara o motor; não devolve promessa por design)
  - `runQueue() → Promise<void>` (o que o `kick` roda; exportado para os testes)

- [ ] **Step 1: Escrever os testes que falham**

**Acrescente** ao fim de `backend/test/faturometro-sync.test.js`:

```js
// ── reconciliação ────────────────────────────────────────────────────────────
test('reconciliação repõe um pedido que o webhook perdeu', async () => {
  await semear('acc-rec', '1010');
  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [cru(80, 100, 1, 'b1'), cru(81, 200, 2, 'b2')], erro: null });
  try {
    const r = await faturometro.reconcileAccount('acc-rec', '2026-08-06');
    assert.equal(r.ok, true);
  } finally { meli.ordersOfDay = original; }

  const dia = await db('faturometro_daily').where({ account_id: 'acc-rec', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 300);
  assert.equal(dia.pedidos, 2);
});

test('reconciliação apaga do livro pedido que não existe mais no ML', async () => {
  await semear('acc-rec2', '1111');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(90, 999, 1, 'b1'), 'acc-rec2')); // fantasma

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [cru(91, 100, 1, 'b2')], erro: null });
  try {
    await faturometro.reconcileAccount('acc-rec2', '2026-08-06');
  } finally { meli.ordersOfDay = original; }

  const fantasma = await db('faturometro_orders').where({ order_id: '90' }).first();
  assert.equal(fantasma, undefined);
  const dia = await db('faturometro_daily').where({ account_id: 'acc-rec2', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 100);
});

test('reconciliação com erro do ML preserva o que já havia e registra o erro', async () => {
  await semear('acc-rec3', '1212');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(95, 500, 1, 'b1'), 'acc-rec3'));

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [], erro: { message: 'invalid token' } });
  try {
    const r = await faturometro.reconcileAccount('acc-rec3', '2026-08-06');
    assert.equal(r.ok, false);
  } finally { meli.ordersOfDay = original; }

  const dia = await db('faturometro_daily').where({ account_id: 'acc-rec3', dia: '2026-08-06' }).first();
  assert.equal(Number(dia.faturamento), 500, 'não pode zerar o que já estava contado');
  const sync = await db('faturometro_sync').where({ account_id: 'acc-rec3' }).first();
  assert.ok(sync.erro);
});

test('reconciliação bem-sucedida limpa o erro anterior e marca o horário', async () => {
  await semear('acc-rec4', '1313');
  await faturometro.marcarSync('acc-rec4', { erro: 'token expirado' });

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [], erro: null });
  try {
    await faturometro.reconcileAccount('acc-rec4', '2026-08-06');
  } finally { meli.ordersOfDay = original; }

  const sync = await db('faturometro_sync').where({ account_id: 'acc-rec4' }).first();
  assert.equal(sync.erro, null);
  assert.ok(sync.reconciliado_em);
});

// ── expurgo ──────────────────────────────────────────────────────────────────
test('expurgo apaga pedidos com mais de 70 dias sem tocar no consolidado', async () => {
  await semear('acc-purga', '1414');
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow(cru(200, 100, 1, 'b1', '2026-01-10T13:00:00.000-03:00'), 'acc-purga'));
  await faturometro.saveOrderRow(orderRow(cru(201, 100, 1, 'b1', '2026-08-06T13:00:00.000-03:00'), 'acc-purga'));

  const apagados = await faturometro.purgeOldOrders('2026-08-06');

  assert.equal(apagados, 1);
  assert.equal(await db('faturometro_orders').where({ order_id: '200' }).first(), undefined);
  assert.ok(await db('faturometro_orders').where({ order_id: '201' }).first());
  const antigo = await db('faturometro_daily').where({ account_id: 'acc-purga', dia: '2026-01-10' }).first();
  assert.equal(Number(antigo.faturamento), 100, 'o consolidado tem de sobreviver ao expurgo');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npm test -- test/faturometro-sync.test.js`
Expected: FAIL — `faturometro.reconcileAccount is not a function`

- [ ] **Step 3: Implementar**

Em `backend/src/lib/faturometroSync.js`, adicione ao topo, junto dos outros requires:

```js
const { todayISO } = require('./p4');
const { addDaysISO } = require('./faturometro');
```

(o require de `./faturometro` já existe — apenas acrescente `addDaysISO` à desestruturação).

E adicione antes do `module.exports`:

```js
const JANELA_LIVRO_DIAS = 70; // cobre com folga o dia equivalente do mês anterior
const JANELA_RECONCILIA_MS = 10 * 60 * 1000;
const CONTAS_POR_CICLO = 5; // rodízio: com 40+ contas, tudo de uma vez derruba o ciclo
const BACKFILL_DIAS_POR_CICLO = 3;

// Id do vendedor no ML. Vem da conexão; só chama /users/me se ela não tiver.
async function sellerIdOf(accountId) {
  const conn = await meli.getConnection(accountId);
  if (!conn) return null;
  if (conn.ml_user_id) return conn.ml_user_id;
  const me = await meli.apiGet(accountId, '/users/me');
  return me.ok ? String(me.data.id) : null;
}

// Rebusca um dia inteiro na API de Pedidos e faz o livro bater com a resposta:
// grava o que veio, apaga o que sumiu. É o que conserta o que o webhook perdeu
// enquanto o Render dormia.
//
// Erro do ML NÃO zera nada: mantemos o que já estava contado (é receita que
// aconteceu) e registramos o erro para a tela sinalizar "precisa reconectar".
async function reconcileAccount(accountId, dia) {
  const sellerId = await sellerIdOf(accountId);
  if (!sellerId) {
    await marcarSync(accountId, { erro: 'conta sem conexão com o Mercado Livre' });
    return { ok: false, erro: 'sem conexão' };
  }

  const r = await meli.ordersOfDay(accountId, sellerId, dia);
  if (r.erro) {
    await marcarSync(accountId, { erro: JSON.stringify(r.erro).slice(0, 300) });
    return { ok: false, erro: r.erro };
  }

  const rows = r.pedidos.map((o) => orderRow(o, accountId)).filter((x) => x && x.dia === dia);
  const ids = rows.map((x) => x.order_id);

  const del = db('faturometro_orders').where({ account_id: accountId, dia });
  if (ids.length) del.whereNotIn('order_id', ids);
  await del.del();

  for (const row of rows) {
    const existing = await db('faturometro_orders').where({ order_id: row.order_id }).first();
    const dados = { ...row, atualizado_em: agora() };
    if (existing) await db('faturometro_orders').where({ order_id: row.order_id }).update(dados);
    else await db('faturometro_orders').insert(dados);
  }

  await recalcDay(accountId, dia);
  await marcarSync(accountId, { erro: null, reconciliado_em: agora() });
  return { ok: true, pedidos: rows.length };
}

// O livro guarda 70 dias; o consolidado guarda tudo. Só a granularidade por hora
// dos dias antigos se perde, e ninguém a consulta.
async function purgeOldOrders(hojeISO) {
  const corte = addDaysISO(hojeISO || todayISO(), -JANELA_LIVRO_DIAS);
  return db('faturometro_orders').where('dia', '<', corte).del();
}

// Contas no escopo do Faturômetro: conectadas ao ML e não encerradas.
function scopedAccounts() {
  return db('meli_connections')
    .join('accounts', 'accounts.id', 'meli_connections.account_id')
    .whereNot('accounts.ativo', false)
    .select('accounts.id as accountId');
}

// Um ciclo de trabalho: expurgo (uma vez por dia), rodízio de reconciliação e um
// lote de backfill. Roda em segundo plano — nada aqui pode lançar para fora.
let rodando = false;
let ultimoExpurgo = null;

async function runQueue() {
  const hoje = todayISO();

  if (ultimoExpurgo !== hoje) {
    ultimoExpurgo = hoje;
    await purgeOldOrders(hoje).catch(() => {});
  }

  const contas = await scopedAccounts();
  const syncs = await db('faturometro_sync').whereIn('account_id', contas.map((c) => c.accountId));
  const porConta = new Map(syncs.map((s) => [s.account_id, s]));

  const vencidas = contas
    .map((c) => ({ id: c.accountId, sync: porConta.get(c.accountId) }))
    .filter((x) => {
      const t = x.sync && x.sync.reconciliado_em ? Date.parse(x.sync.reconciliado_em) : 0;
      return Date.now() - t > JANELA_RECONCILIA_MS;
    })
    .sort((a, b) => {
      const ta = a.sync && a.sync.reconciliado_em ? Date.parse(a.sync.reconciliado_em) : 0;
      const tb = b.sync && b.sync.reconciliado_em ? Date.parse(b.sync.reconciliado_em) : 0;
      return ta - tb; // a mais antiga primeiro
    })
    .slice(0, CONTAS_POR_CICLO);

  for (const c of vencidas) {
    await reconcileAccount(c.id, hoje).catch(() => {});
  }
}

// Dispara o motor sem bloquear quem chamou. A trava garante um ciclo por vez —
// com polling de 30s, sem ela os ciclos se empilhariam.
//
// FATUROMETRO_BACKGROUND=off desliga o motor: os testes de leitura chamam
// getFaturometro(), que dispara o kick, e sem essa trava o ciclo sairia batendo
// na API real do Mercado Livre no meio da suíte.
function kick() {
  if (process.env.FATUROMETRO_BACKGROUND === 'off') return;
  if (rodando) return;
  rodando = true;
  Promise.resolve()
    .then(runQueue)
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('[faturometro] ciclo falhou:', e.message);
    })
    .finally(() => { rodando = false; });
}
```

Atualize o `module.exports`:

```js
module.exports = {
  marcarSync, recalcDay, saveOrderRow, ingestOrder, handleNotification,
  reconcileAccount, purgeOldOrders, scopedAccounts, runQueue, kick,
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npm test -- test/faturometro-sync.test.js`
Expected: PASS, 20 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/faturometroSync.js backend/test/faturometro-sync.test.js
git commit -m "feat(faturometro): reconciliacao em rodizio, expurgo e motor de segundo plano"
```

---

### Task 7: Backfill progressivo do histórico

Mês corrente e anterior vindos da API, em lotes, com progresso salvo para retomar depois de uma hibernação.

**Files:**
- Modify: `backend/src/lib/faturometroSync.js`
- Modify: `backend/test/faturometro-sync.test.js`

**Interfaces:**
- Consumes: `reconcileAccount`, `scopedAccounts`, `marcarSync` da Task 6; `previousMonthWindow`, `addDaysISO` da Task 1
- Produces:
  - `backfillTarget(hojeISO) → 'YYYY-MM-DD'` (dia mais antigo que o backfill precisa alcançar)
  - `backfillStep(hojeISO) → Promise<{ conta, dias } | null>`
  - `backfillProgress(hojeISO) → Promise<{ pronto, progresso, etapa }>`

- [ ] **Step 1: Escrever os testes que falham**

**Acrescente** ao fim de `backend/test/faturometro-sync.test.js`:

```js
// ── backfill ─────────────────────────────────────────────────────────────────
test('o alvo do backfill é o dia 1 do mês anterior', () => {
  assert.equal(faturometro.backfillTarget('2026-08-06'), '2026-07-01');
  assert.equal(faturometro.backfillTarget('2026-01-15'), '2025-12-01');
});

test('backfillStep preenche do dia mais recente para o mais antigo', async () => {
  await semear('acc-bf', '1515');
  const vistos = [];
  const original = meli.ordersOfDay;
  meli.ordersOfDay = async (_acc, _seller, dia) => { vistos.push(dia); return { pedidos: [], erro: null }; };
  try {
    await faturometro.backfillStep('2026-08-06');
  } finally { meli.ordersOfDay = original; }

  // Primeiro lote: hoje e os dias imediatamente anteriores, do mais novo ao mais velho.
  assert.equal(vistos[0], '2026-08-06');
  assert.equal(vistos[1], '2026-08-05');
  const sync = await db('faturometro_sync').where({ account_id: 'acc-bf' }).first();
  assert.ok(sync.backfill_dia <= '2026-08-05');
});

test('backfill retoma de onde parou, não recomeça do zero', async () => {
  await semear('acc-bf2', '1616');
  await faturometro.marcarSync('acc-bf2', { backfill_dia: '2026-08-01', backfill_status: 'rodando' });

  const vistos = [];
  const original = meli.ordersOfDay;
  meli.ordersOfDay = async (_acc, _seller, dia) => { vistos.push(dia); return { pedidos: [], erro: null }; };
  try {
    await faturometro.backfillStep('2026-08-06');
  } finally { meli.ordersOfDay = original; }

  assert.equal(vistos[0], '2026-07-31', 'devia continuar do dia anterior ao já preenchido');
});

test('backfill que alcança o alvo marca a conta como pronta', async () => {
  await semear('acc-bf3', '1717');
  await faturometro.marcarSync('acc-bf3', { backfill_dia: '2026-07-02', backfill_status: 'rodando' });

  const original = meli.ordersOfDay;
  meli.ordersOfDay = async () => ({ pedidos: [], erro: null });
  try {
    await faturometro.backfillStep('2026-08-06');
  } finally { meli.ordersOfDay = original; }

  const sync = await db('faturometro_sync').where({ account_id: 'acc-bf3' }).first();
  assert.equal(sync.backfill_status, 'pronto');
  assert.equal(sync.backfill_dia, '2026-07-01');
});

test('progresso é a fração de dias já preenchidos', async () => {
  const p = await faturometro.backfillProgress('2026-08-06');
  assert.ok(p.progresso >= 0 && p.progresso <= 1, `progresso fora de 0..1: ${p.progresso}`);
  assert.equal(typeof p.pronto, 'boolean');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npm test -- test/faturometro-sync.test.js`
Expected: FAIL — `faturometro.backfillTarget is not a function`

- [ ] **Step 3: Implementar**

Em `backend/src/lib/faturometroSync.js`, acrescente `previousMonthWindow` à desestruturação do require de `./faturometro`:

```js
const { orderRow, round2, addDaysISO, previousMonthWindow } = require('./faturometro');
```

E adicione antes do `module.exports`:

```js
// O backfill precisa alcançar o dia 1 do mês ANTERIOR — é o que a comparação
// mensal exige. Nada além disso: mais fundo custa chamadas e não é usado.
function backfillTarget(hojeISO) {
  return `${previousMonthWindow(hojeISO).ym}-01`;
}

// Um lote de backfill: pega a conta mais atrasada e preenche alguns dias, do
// mais recente para o mais antigo — assim a tela fica útil desde o primeiro
// lote. O progresso fica no banco, então uma hibernação do Render não perde nada.
async function backfillStep(hojeISO) {
  const hoje = hojeISO || todayISO();
  const alvo = backfillTarget(hoje);

  const contas = await scopedAccounts();
  if (!contas.length) return null;
  const syncs = await db('faturometro_sync').whereIn('account_id', contas.map((c) => c.accountId));
  const porConta = new Map(syncs.map((s) => [s.account_id, s]));

  const pendente = contas
    .map((c) => ({ id: c.accountId, sync: porConta.get(c.accountId) }))
    .find((x) => !x.sync || x.sync.backfill_status !== 'pronto');
  if (!pendente) return null;

  // Retoma do dia anterior ao último preenchido; se nunca rodou, começa em hoje.
  const desde = pendente.sync && pendente.sync.backfill_dia
    ? addDaysISO(pendente.sync.backfill_dia, -1)
    : hoje;

  let dia = desde;
  let feitos = 0;
  for (let i = 0; i < BACKFILL_DIAS_POR_CICLO && dia >= alvo; i++) {
    const r = await reconcileAccount(pendente.id, dia);
    if (!r.ok) break; // erro já registrado; tenta de novo no próximo ciclo
    feitos += 1;
    await marcarSync(pendente.id, { backfill_dia: dia, backfill_status: 'rodando' });
    dia = addDaysISO(dia, -1);
  }

  if (dia < alvo) await marcarSync(pendente.id, { backfill_dia: alvo, backfill_status: 'pronto' });
  return { conta: pendente.id, dias: feitos };
}

// Fração de pares (conta, dia) já preenchidos sobre o total alvo.
async function backfillProgress(hojeISO) {
  const hoje = hojeISO || todayISO();
  const alvo = backfillTarget(hoje);
  const contas = await scopedAccounts();
  if (!contas.length) return { pronto: true, progresso: 1, etapa: null };

  const syncs = await db('faturometro_sync').whereIn('account_id', contas.map((c) => c.accountId));
  const porConta = new Map(syncs.map((s) => [s.account_id, s]));

  // Nº de dias entre o alvo e hoje (inclusive) — o denominador por conta.
  let totalDias = 0;
  for (let d = hoje; d >= alvo; d = addDaysISO(d, -1)) totalDias += 1;

  let feitos = 0;
  let prontas = 0;
  for (const c of contas) {
    const s = porConta.get(c.accountId);
    if (s && s.backfill_status === 'pronto') { feitos += totalDias; prontas += 1; continue; }
    if (!s || !s.backfill_dia) continue;
    for (let d = hoje; d >= s.backfill_dia; d = addDaysISO(d, -1)) feitos += 1;
  }

  const pronto = prontas === contas.length;
  return {
    pronto,
    progresso: Math.min(1, Math.round((feitos / (totalDias * contas.length)) * 100) / 100),
    etapa: pronto ? null : 'histórico do mês',
  };
}
```

Ligue o backfill ao motor: dentro de `runQueue`, **depois** do laço de reconciliação, acrescente:

```js
  await backfillStep(hoje).catch(() => {});
```

E atualize o `module.exports`:

```js
module.exports = {
  marcarSync, recalcDay, saveOrderRow, ingestOrder, handleNotification,
  reconcileAccount, purgeOldOrders, scopedAccounts, runQueue, kick,
  backfillTarget, backfillStep, backfillProgress,
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npm test -- test/faturometro-sync.test.js`
Expected: PASS, 25 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/faturometroSync.js backend/test/faturometro-sync.test.js
git commit -m "feat(faturometro): backfill progressivo do mes corrente e anterior"
```

---

### Task 8: Leitura — `faturometroService` e as rotas

**Files:**
- Create: `backend/src/services/faturometroService.js`
- Create: `backend/src/routes/faturometro.js`
- Modify: `backend/src/app.js:9-15` (requires) e `:43-49` (registro das rotas)
- Modify: `backend/test/faturometro-sync.test.js`

**Interfaces:**
- Consumes: tudo das tasks 1, 4, 6 e 7
- Produces: `faturometroService.getFaturometro() → Promise<payload>` com a forma exata da seção 7 da spec

- [ ] **Step 1: Escrever os testes que falham**

**Acrescente** ao fim de `backend/test/faturometro-sync.test.js`:

```js
// ── leitura (payload da tela) ────────────────────────────────────────────────
const faturometroService = require('../src/services/faturometroService');
const { todayISO } = require('../src/lib/p4');
const { addDaysISO } = require('../src/lib/faturometro');

// Grava direto no livro, sem passar pelo ML, para montar cenários de leitura.
async function lancar(accountId, orderId, dia, hora, valor, unidades, comprador) {
  const { orderRow } = require('../src/lib/faturometro');
  await faturometro.saveOrderRow(orderRow({
    id: orderId, date_created: `${dia}T${hora}-03:00`,
    total_amount: valor, order_items: [{ quantity: unidades }], buyer: { id: comprador },
  }, accountId));
}

test('payload soma hoje de todas as contas no escopo', async () => {
  const hoje = todayISO();
  await semear('acc-le1', '2001');
  await semear('acc-le2', '2002');
  await lancar('acc-le1', 900, hoje, '09:00:00', 100, 1, 'b1');
  await lancar('acc-le2', 901, hoje, '09:30:00', 250, 2, 'b2');

  const p = await faturometroService.getFaturometro();

  assert.ok(p.hoje.faturamento >= 350, `esperava ao menos 350, veio ${p.hoje.faturamento}`);
  assert.ok(p.contas.conectadas >= 2);
  assert.equal(p.porHora.length, 24);
});

test('conta encerrada fica fora da soma e fora da lista', async () => {
  const hoje = todayISO();
  await semear('acc-enc', '2003');
  await lancar('acc-enc', 910, hoje, '09:00:00', 5000, 1, 'b1');
  const antes = await faturometroService.getFaturometro();

  await db('accounts').where({ id: 'acc-enc' }).update({ ativo: false });
  const depois = await faturometroService.getFaturometro();

  assert.equal(antes.hoje.faturamento - depois.hoje.faturamento, 5000);
  assert.equal(depois.clientes.some((c) => c.clienteId === 'c-acc-enc'), false);
});

test('conta com erro segue somando e aparece em comErro', async () => {
  const hoje = todayISO();
  await semear('acc-quebrou', '2004');
  await lancar('acc-quebrou', 920, hoje, '09:00:00', 700, 1, 'b1');
  await faturometro.marcarSync('acc-quebrou', { erro: 'token expirado' });

  const p = await faturometroService.getFaturometro();

  assert.ok(p.contas.comErro >= 1);
  const linha = p.clientes.find((c) => c.clienteId === 'c-acc-quebrou');
  assert.equal(linha.hoje, 700, 'receita anterior à quebra tem de continuar contando');
  assert.ok(linha.erro);
});

test('comparação com ontem corta pelo horário atual', async () => {
  const hoje = todayISO();
  const ontem = addDaysISO(hoje, -1);
  await semear('acc-ontem', '2005');
  await lancar('acc-ontem', 930, ontem, '00:00:01', 40, 1, 'b1'); // antes de agora
  await lancar('acc-ontem', 931, ontem, '23:59:59', 999, 1, 'b2'); // depois de agora

  const p = await faturometroService.getFaturometro();

  assert.ok(p.hoje.ontemAteAgora < 999, 'o pedido do fim do dia de ontem não pode entrar');
});

test('duas contas do mesmo cliente viram uma linha só', async () => {
  const hoje = todayISO();
  await db('users').insert({ id: 'u-fat', nome: 'Ana', email: 'ana@fat.test', senha_hash: 'x', papel: 'analista' })
    .onConflict('id').ignore();
  await db('clients').insert({
    id: 'c-duplo', loja: 'Loja Dupla', tipo: 'Loja',
    analista_id: 'u-fat', agenda_freq: 'Semanal', agenda_dia_semana: 'Segunda',
  }).onConflict('id').ignore();
  for (const [id, ml] of [['acc-d1', '2006'], ['acc-d2', '2007']]) {
    await db('accounts').insert({ id, client_id: 'c-duplo', marketplace: 'Mercado Livre', apelido: id, ativo: true })
      .onConflict('id').ignore();
    await db('meli_connections').insert({
      id: 'conn-' + id, account_id: id, ml_user_id: ml, access_token: 'x',
      expires_at: new Date(Date.now() + 3600e3).toISOString(),
    }).onConflict('id').ignore();
  }
  await lancar('acc-d1', 940, hoje, '09:00:00', 100, 1, 'b1');
  await lancar('acc-d2', 941, hoje, '09:00:00', 200, 1, 'b2');

  const p = await faturometroService.getFaturometro();
  const linha = p.clientes.find((c) => c.clienteId === 'c-duplo');

  assert.equal(linha.contas, 2);
  assert.equal(linha.hoje, 300);
});

test('lista sai ordenada pelo faturamento de hoje', async () => {
  const p = await faturometroService.getFaturometro();
  const valores = p.clientes.map((c) => c.hoje);
  assert.deepEqual(valores, [...valores].sort((a, b) => b - a));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npm test -- test/faturometro-sync.test.js`
Expected: FAIL — `Cannot find module '../src/services/faturometroService'`

- [ ] **Step 3: Implementar o serviço**

Crie `backend/src/services/faturometroService.js`:

```js
// faturometroService — a LEITURA do Faturômetro. Monta o payload da tela a
// partir do banco, sem tocar no Mercado Livre: o GET tem de responder rápido
// porque a tela consulta a cada 30s. Quem fala com o ML é lib/faturometroSync,
// em segundo plano.
//
// De onde vem cada número:
//   - hoje e a curva por hora → do LIVRO (hoje e ontem estão sempre na janela);
//   - totais do mês → do CONSOLIDADO (faturometro_daily).
const db = require('../db/knex');
const { todayISO } = require('../lib/p4');
const {
  addDaysISO, sumOrders, untilTimeOfDay, hourlySeries, variacao,
  previousMonthWindow, businessTimeOf, round2,
} = require('../lib/faturometro');
const sync = require('../lib/faturometroSync');

// Contas no escopo + a que cliente pertencem. Conta encerrada (ativo=false) sai:
// é o que implementa "cliente Encerrado fora da soma" e ainda descarta contas
// encerradas de clientes que seguem ativos.
function scopedRows() {
  return db('meli_connections')
    .join('accounts', 'accounts.id', 'meli_connections.account_id')
    .join('clients', 'clients.id', 'accounts.client_id')
    .whereNot('accounts.ativo', false)
    .select(
      'accounts.id as accountId',
      'accounts.apelido as apelido',
      'clients.id as clienteId',
      'clients.loja as cliente'
    );
}

function somaDaily(rows) {
  return round2(rows.reduce((s, r) => s + (Number(r.faturamento) || 0), 0));
}

async function getFaturometro() {
  const hoje = todayISO();
  const ontem = addDaysISO(hoje, -1);
  const agoraHHMMSS = businessTimeOf(new Date());
  const janela = previousMonthWindow(hoje);
  const mesYm = hoje.slice(0, 7);

  const contas = await scopedRows();
  const ids = contas.map((c) => c.accountId);

  // Sem nenhuma conta conectada a tela mostra o estado vazio.
  if (!ids.length) {
    sync.kick();
    return {
      agora: new Date().toISOString(),
      hoje: { faturamento: 0, pedidos: 0, unidades: 0, compradores: 0, precoMedio: 0, ontemAteAgora: 0, variacao: null },
      mes: { ym: mesYm, faturamento: 0, anteriorAteAgora: 0, variacao: null, anteriorParcial: janela.parcial },
      porHora: hourlySeries([], []),
      contas: { conectadas: 0, comErro: 0 },
      backfill: { pronto: true, progresso: 1, etapa: null },
      clientes: [],
    };
  }

  const [livro, daily, syncs] = await Promise.all([
    db('faturometro_orders').whereIn('account_id', ids)
      .whereIn('dia', [hoje, ontem, janela.diaParcial].filter(Boolean)),
    db('faturometro_daily').whereIn('account_id', ids)
      .where((q) => q.whereBetween('dia', [`${mesYm}-01`, hoje])
        .orWhereBetween('dia', [`${janela.ym}-01`, janela.completosAte || `${janela.ym}-01`])),
    db('faturometro_sync').whereIn('account_id', ids),
  ]);

  const erroPorConta = new Map(syncs.filter((s) => s.erro).map((s) => [s.account_id, s.erro]));

  const doDia = (dia) => livro.filter((o) => o.dia === dia);
  const hojePedidos = doDia(hoje);
  const ontemPedidos = doDia(ontem);

  const totHoje = sumOrders(hojePedidos);
  const ontemAteAgora = sumOrders(untilTimeOfDay(ontemPedidos, agoraHHMMSS)).faturamento;

  // Mês atual: consolidado do dia 1 até hoje (hoje incluso e parcial).
  const mesRows = daily.filter((r) => r.dia >= `${mesYm}-01` && r.dia <= hoje);
  const mesFaturamento = somaDaily(mesRows);

  // Mês anterior: dias completos + o dia equivalente cortado pelo horário. Quando
  // o mês anterior não tem o dia de hoje, compara-se com ele inteiro.
  const antCompletos = janela.completosAte
    ? daily.filter((r) => r.dia >= `${janela.ym}-01` && r.dia <= janela.completosAte)
    : [];
  const antParcial = janela.diaParcial
    ? sumOrders(untilTimeOfDay(doDia(janela.diaParcial), agoraHHMMSS)).faturamento
    : 0;
  const mesAnterior = round2(somaDaily(antCompletos) + antParcial);

  // Uma linha por CLIENTE, somando as contas dele.
  const porCliente = new Map();
  for (const c of contas) {
    if (!porCliente.has(c.clienteId)) {
      porCliente.set(c.clienteId, {
        clienteId: c.clienteId, cliente: c.cliente, contas: 0,
        hoje: 0, mes: 0, anterior: 0, erro: null,
      });
    }
    const linha = porCliente.get(c.clienteId);
    linha.contas += 1;
    linha.hoje = round2(linha.hoje + sumOrders(hojePedidos.filter((o) => o.account_id === c.accountId)).faturamento);
    linha.mes = round2(linha.mes + somaDaily(mesRows.filter((r) => r.account_id === c.accountId)));
    linha.anterior = round2(
      linha.anterior +
      somaDaily(antCompletos.filter((r) => r.account_id === c.accountId)) +
      (janela.diaParcial
        ? sumOrders(untilTimeOfDay(doDia(janela.diaParcial).filter((o) => o.account_id === c.accountId), agoraHHMMSS)).faturamento
        : 0)
    );
    if (erroPorConta.has(c.accountId)) linha.erro = erroPorConta.get(c.accountId);
  }

  const clientes = [...porCliente.values()]
    .map((l) => ({
      clienteId: l.clienteId, cliente: l.cliente, contas: l.contas,
      hoje: l.hoje, mes: l.mes, variacaoMes: variacao(l.mes, l.anterior), erro: l.erro,
    }))
    .sort((a, b) => b.hoje - a.hoje || a.cliente.localeCompare(b.cliente, 'pt-BR'));

  const backfill = await sync.backfillProgress(hoje);

  // Dispara o trabalho de segundo plano DEPOIS de ter tudo em mãos: a resposta
  // não espera o Mercado Livre; a correção entra no polling seguinte.
  sync.kick();

  return {
    agora: new Date().toISOString(),
    hoje: {
      faturamento: totHoje.faturamento,
      pedidos: totHoje.pedidos,
      unidades: totHoje.unidades,
      compradores: totHoje.compradores,
      precoMedio: totHoje.precoMedio,
      ontemAteAgora,
      variacao: variacao(totHoje.faturamento, ontemAteAgora),
    },
    mes: {
      ym: mesYm,
      faturamento: mesFaturamento,
      anteriorAteAgora: mesAnterior,
      variacao: variacao(mesFaturamento, mesAnterior),
      anteriorParcial: janela.parcial,
    },
    porHora: hourlySeries(hojePedidos, ontemPedidos),
    contas: { conectadas: contas.length, comErro: erroPorConta.size },
    backfill,
    clientes,
  };
}

module.exports = { getFaturometro };
```

- [ ] **Step 4: Implementar as rotas**

Crie `backend/src/routes/faturometro.js`:

```js
// /faturometro — faturamento da carteira ao vivo. Exclusivo de admin: é o número
// da agência inteira.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, forbidden } = require('../lib/errors');
const db = require('../db/knex');
const faturometroService = require('../services/faturometroService');
const sync = require('../lib/faturometroSync');

const router = express.Router();

function somenteAdmin(req) {
  if (req.user.papel !== 'admin') {
    throw forbidden('Faturômetro disponível apenas para administradores.');
  }
}

router.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    somenteAdmin(req);
    res.json(await faturometroService.getFaturometro());
  })
);

// Força a conferência de todas as contas. Enfileira e responde na hora: com 40+
// contas, esperar a fila terminar estouraria o tempo da requisição. O resultado
// aparece no polling seguinte.
router.post(
  '/reconciliar',
  authenticate,
  asyncHandler(async (req, res) => {
    somenteAdmin(req);
    await db('faturometro_sync').update({ reconciliado_em: null });
    sync.kick();
    res.json({ ok: true });
  })
);

module.exports = router;
```

Em `backend/src/app.js`, adicione o require junto dos outros (depois de `closingRoutes`):

```js
const faturometroRoutes = require('./routes/faturometro');
```

E registre a rota junto das outras, antes da linha do `reportRoutes`:

```js
app.use('/faturometro', faturometroRoutes);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd backend && npm test`
Expected: PASS — 31 testes em `faturometro-sync.test.js` e nenhuma regressão.

Confirme também que a API sobe e a rota exige admin:

Run: `cd backend && npm run dev` (em outro terminal) e depois `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4000/faturometro`
Expected: `401` (sem token). Encerre o servidor depois.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/faturometroService.js backend/src/routes/faturometro.js backend/src/app.js backend/test/faturometro-sync.test.js
git commit -m "feat(faturometro): endpoint GET /faturometro e reconciliacao forcada"
```

---

### Task 9: Frontend — cliente HTTP, tela e navegação

**Files:**
- Create: `design_handoff_sistema_feedbacks/p4-faturometro.jsx`
- Modify: `design_handoff_sistema_feedbacks/p4-api.js:96-128`
- Modify: `design_handoff_sistema_feedbacks/p4-shell.jsx:83-116` (Sidebar) e `:533-560` (roteamento)
- Modify: `design_handoff_sistema_feedbacks/index.html` (CSS + `<script>`)

**Interfaces:**
- Consumes: `GET /faturometro` da Task 8
- Produces: `window.Faturometro` (componente de tela), `window.P4_API.getFaturometro()`, `window.P4_API.reconciliarFaturometro()`

Não há suíte de teste no frontend do projeto — a verificação é manual, no navegador, com os passos descritos abaixo.

- [ ] **Step 1: Adicionar as funções no cliente HTTP**

Em `design_handoff_sistema_feedbacks/p4-api.js`, adicione depois do bloco `// painel (admin / cs)`:

```js
  // faturômetro (admin)
  async function getFaturometro() { return apiFetch('/faturometro'); }
  async function reconciliarFaturometro() { return apiFetch('/faturometro/reconciliar', { method: 'POST' }); }
```

E acrescente os dois nomes ao objeto `window.P4_API`, na linha do `getDashboard`:

```js
    getDashboard, getClosings, saveClosing, saveFigures, getFaturometro, reconciliarFaturometro,
```

- [ ] **Step 2: Criar a tela**

Crie `design_handoff_sistema_feedbacks/p4-faturometro.jsx`:

```jsx
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

  const carregar = React.useCallback(async () => {
    try {
      if (!window.P4_API || !window.P4_API.isLogged()) throw new Error('Faça login para ver o Faturômetro.');
      const d = await window.P4_API.getFaturometro();
      setData(d);
      setAtualizadoEm(new Date());
      setErr('');
    } catch (e) {
      // Erro não apaga o último número: a tela envelhece o selo em vez de zerar.
      setErr(e.message || 'Falha ao atualizar.');
    }
  }, []);

  // Polling pausado com a aba em segundo plano — não faz sentido consultar
  // (e gastar chamada) uma tela que ninguém está olhando.
  React.useEffect(() => {
    let vivo = true;
    let timer = null;
    const ciclo = async () => {
      if (!vivo) return;
      if (!document.hidden) await carregar();
      timer = setTimeout(ciclo, FAT_POLL_MS);
    };
    ciclo();
    const aoVoltar = () => { if (!document.hidden) carregar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { vivo = false; clearTimeout(timer); document.removeEventListener('visibilitychange', aoVoltar); };
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
```

- [ ] **Step 3: Ligar a navegação**

Em `design_handoff_sistema_feedbacks/p4-shell.jsx`, dentro de `Sidebar`, adicione o ícone junto dos outros (depois de `docIcon`):

```jsx
  const boltIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
  );
```

E o item de menu, logo **depois** do botão "Fechamento" e antes de "Configurações":

```jsx
        {role === 'admin'
          ? <button className={'as-item' + (screen === 'faturometro' ? ' on' : '')} onClick={() => onNav('faturometro')} title="Faturômetro">
              {boltIcon}<span>Faturômetro</span>
            </button>
          : null}
```

No roteamento de telas (o encadeamento de `else if` por volta da linha 536), adicione um ramo depois do `screen === 'closing'`:

```jsx
  } else if (screen === 'faturometro') {
    content = <window.Faturometro user={user} role={role} onLogout={logout} onManageUsers={() => setUsersOpen(true)} onOpenClient={openClient} toast={toast} />;
```

- [ ] **Step 4: Registrar o script e o CSS**

Em `design_handoff_sistema_feedbacks/index.html`, adicione a tag junto das outras de tela (perto de `p4-cs-dashboard.jsx`):

```html
<script type="text/babel" src="p4-faturometro.jsx"></script>
```

E no bloco `<style>`, ao fim das regras existentes:

```css
/* ── Faturômetro ─────────────────────────────────────────────────────────── */
.fat-hero{background:linear-gradient(160deg,var(--brand) 0%,var(--brand-strong) 100%);border-radius:20px;padding:26px 20px 34px;text-align:center;color:#fff;margin-bottom:-26px}
.fat-hero h1{font-size:clamp(20px,3vw,30px);font-weight:800;letter-spacing:-.02em;margin-bottom:12px}
.fat-pill{display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,.9);color:var(--ink);border-radius:999px;padding:6px 14px;font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums}
.fat-dot{width:8px;height:8px;border-radius:50%;background:var(--red);flex:none}
.fat-dot-off{background:var(--amber)}
.fat-hero-card{background:#fff;border-radius:18px;box-shadow:0 12px 32px rgba(14,26,19,.14);max-width:620px;margin:16px auto 0;padding:26px 20px}
.fat-big{font-size:clamp(34px,7vw,64px);font-weight:800;letter-spacing:-.03em;color:var(--ink);font-variant-numeric:tabular-nums;transition:color .25s var(--ease),transform .25s var(--ease)}
.fat-big-mudou{color:var(--brand-ink);transform:scale(1.02)}
.fat-big-load{font-size:22px;color:var(--muted);font-weight:600}
.fat-hero-sub{margin-top:6px;font-size:13px;color:var(--ink-2);font-weight:600}
.fat-contexto{display:flex;flex-wrap:wrap;align-items:center;gap:14px;justify-content:center;margin:34px 0 16px;font-size:12.5px;color:var(--ink-2);font-weight:600}
.fat-alerta{color:var(--amber-ink);text-decoration:none;border-bottom:1px dashed currentColor}
.fat-var{font-weight:700;font-size:13px}
.fat-var-up{color:var(--green-ink)} .fat-var-down{color:var(--red-ink)} .fat-var-nd{color:var(--muted)}
.fat-grid{display:grid;grid-template-columns:minmax(260px,340px) 1fr;gap:18px}
@media (max-width:860px){.fat-grid{grid-template-columns:1fr}}
.fat-metricas{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-top:14px}
.fat-metrica{background:#fff;padding:14px 12px;text-align:center;display:flex;flex-direction:column;gap:5px}
.fat-metrica-lbl{font-size:11px;color:var(--muted);font-weight:600}
.fat-metrica-val{font-size:19px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
.fat-tab{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
.fat-tab th{text-align:right;font-size:11px;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line)}
.fat-tab th:first-child{text-align:left}
.fat-tab td{padding:10px;border-bottom:1px solid var(--line-2);text-align:right;font-variant-numeric:tabular-nums}
.fat-tab td:first-child{text-align:left;font-weight:600}
.fat-tab tr.fat-zerado td{color:var(--muted);font-weight:500}
.fat-tab tbody tr{cursor:pointer}
.fat-tab tbody tr:hover{background:var(--surface-2)}
.fat-chip{display:inline-block;margin-left:8px;font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;background:rgba(245,158,11,.14);color:var(--amber-ink)}
.fat-chip-neutro{background:var(--surface-2);color:var(--muted)}
.fat-backfill{margin-top:16px;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:12.5px;color:var(--ink-2);font-weight:600}
.fat-backfill-bar{height:6px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:8px}
.fat-backfill-bar > div{height:100%;background:var(--brand);transition:width .4s var(--ease)}
```

- [ ] **Step 5: Verificar no navegador**

Suba backend e frontend:

```bash
cd backend && npm run dev
# em outro terminal
cd design_handoff_sistema_feedbacks && npx serve .
```

Confirme, logado como **admin**:
- O item "Faturômetro" aparece no menu lateral e abre a tela.
- Logado como **analista** ou **cs**, o item NÃO aparece.
- O relógio da pílula corre de segundo em segundo.
- O console do navegador não acusa erro (a tela ainda vai reclamar de `window.FatChart`, `window.FatClientes` e `window.FatBackfill` — eles chegam na Task 10).

- [ ] **Step 6: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-faturometro.jsx design_handoff_sistema_feedbacks/p4-api.js design_handoff_sistema_feedbacks/p4-shell.jsx design_handoff_sistema_feedbacks/index.html
git commit -m "feat(faturometro): tela ao vivo, cliente HTTP e item no menu (admin)"
```

---

### Task 10: Gráfico por hora, lista de clientes e estados

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-faturometro.jsx`

**Interfaces:**
- Consumes: `data.porHora` (24 itens `{h, hoje, ontem}`), `data.clientes`, `data.backfill` da Task 8
- Produces: `window.FatChart`, `window.FatClientes`, `window.FatBackfill`

- [ ] **Step 1: Implementar o gráfico**

Em `design_handoff_sistema_feedbacks/p4-faturometro.jsx`, adicione **antes** de `function Faturometro(...)`:

```jsx
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
  const areaHoje = `${linha('hoje', hojeAte)} L${x(hojeAte).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const compacto = (v) => v >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : String(Math.round(v));

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b style={{ fontSize: 14 }}>Tendências em vendas brutas</b>
        <span style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', gap: 12 }}>
          <span><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="var(--brand)" strokeWidth="2.5" /></svg> Hoje</span>
          <span><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke="#8A978C" strokeWidth="2.5" strokeDasharray="5 4" /></svg> Ontem</span>
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
        <path d={linha('ontem')} fill="none" stroke="#8A978C" strokeWidth="2.5" strokeDasharray="5 4" strokeLinejoin="round" />
        <path d={linha('hoje', hojeAte)} fill="none" stroke="var(--brand)" strokeWidth="2.8" strokeLinejoin="round" />
        <circle cx={x(hojeAte)} cy={y(dados[hojeAte].hoje)} r="5" fill="var(--brand)" stroke="#fff" strokeWidth="2.5" />
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
```

- [ ] **Step 2: Implementar a lista e os estados**

Ainda em `p4-faturometro.jsx`, adicione depois de `FatChart`:

```jsx
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
              {c.erro ? <span className="fat-chip">reconectar</span> : null}
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
```

- [ ] **Step 3: Verificar no navegador**

Com backend e frontend no ar, logado como admin, confirme:
- O gráfico desenha as duas séries, com **Hoje sólida** e **Ontem tracejada**, e o ponto na hora atual.
- Passar o mouse sobre o gráfico mostra o tooltip com hora, hoje e ontem.
- A lista ordena do maior para o menor faturamento de hoje; clicar numa linha abre o Histórico daquele cliente.
- Cliente sem venda hoje aparece em cinza no fim da lista.
- O console não acusa erro.
- Estreite a janela para menos de 860px: a grade vira uma coluna só e nada estoura para fora da tela.

Sem contas conectadas, a tela deve mostrar o estado vazio da lista em vez de uma tabela em branco.

- [ ] **Step 4: Rodar a suíte inteira uma última vez**

Run: `cd backend && npm test`
Expected: PASS, sem regressões em nenhum dos arquivos de teste.

- [ ] **Step 5: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-faturometro.jsx
git commit -m "feat(faturometro): grafico por hora, lista por cliente e estados"
```

---

## Depois de implementar

**Passo manual obrigatório antes de publicar:** inscrever o app no tópico `orders_v2` no painel de aplicações do Mercado Livre. A URL de notificações já está configurada desde a integração original, mas **sem essa inscrição nenhuma notificação chega** e o Faturômetro só se atualiza pela reconciliação (que já funciona, mas só enquanto a tela está aberta).

**Ao publicar:** `git push` na `main` sobe Vercel e Render sozinho. A migration roda no boot do Render (`server.js` chama `migrate.latest()`), então não há passo extra no banco.

**Primeiro acesso em produção:** o backfill vai levar um tempo considerável com 40+ contas. A tela mostra "montando histórico" e os números de hoje já ficam corretos desde o começo — é o comportamento esperado, não um defeito.
