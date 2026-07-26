# Fechamento Mensal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela onde, no fim do mês, se revisa cliente a cliente o consolidado do período contra as metas cadastradas, escreve a análise e marca o mês como fechado.

**Architecture:** Toda a regra (quem entra no mês, somas, razões, comparação com meta) vive em funções puras em `backend/src/lib/`, testadas sem banco. O service só busca dados e delega; a rota só autentica e escopa. A tela consome um único `GET` já com tudo resolvido.

**Tech Stack:** Node 18+ / Express / Knex (SQLite em dev, Postgres em prod) / `node --test` / React 18 via Babel standalone no navegador (sem build).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-fechamento-mensal-design.md`.
- Backend é CommonJS (`require`/`module.exports`). Nada de ESM.
- Testes rodam com `npm test` (= `node --test`) dentro de `backend/`. São puros: nada de banco, nada de relógio real — data de referência sempre explícita.
- Frontend não tem build: cada `.jsx` é carregado por `<script type="text/babel">` e publica no `window`. Nada de `import`/`export`.
- Texto de UI em português, com acento.
- Migrations rodam no boot (`server.js` → `migrate.latest()`); toda migration precisa de `up` **e** `down`.
- Não tocar em `p4-feedbacks-transferencia/` — é cópia de migração de computador, fora do git.
- Metas são string pt-BR (`"4,00"`); use `p4.parseNum` e trate `<= 0` como "sem meta".

## Pré-requisito (antes da Task 1)

A árvore de trabalho tem alterações não commitadas de outra frente (agregações do painel, gráfico de anéis por gestor, enxugamento dos KPIs). **Commite ou faça stash disso antes de começar**, senão os commits deste plano vão misturar duas frentes.

```bash
git status --short          # confirme o que está pendente
```

---

### Task 1: `lib/metrics.js` — mês do relatório e razões

Extrai de `dashboardService` as duas regras que a tela nova precisa compartilhar. Refactor sem mudança de comportamento: as fórmulas são copiadas literalmente.

**Files:**
- Create: `backend/src/lib/metrics.js`
- Create: `backend/test/metrics.test.js`
- Modify: `backend/src/services/dashboardService.js` (linhas do `ratios` e do loop `metricRows`)

**Interfaces:**
- Produces:
  - `reportMonth(row)` → `'YYYY-MM' | null`. Lê `row.periodo_fim`, cai para `row.periodo_ini`, depois `row.criado_em`. Devolve `null` se não formar `YYYY-MM`.
  - `ratios(faturamento, investimento, receitaAds)` → `{ roas, acos, tacos }`, cada um `number | null`.

- [ ] **Step 1: Write the failing test**

`backend/test/metrics.test.js`:

```js
// Testes de lib/metrics — regra do "mês do relatório" e cálculo de razões.
// Puros: nenhuma data vem do relógio.
const test = require('node:test');
const assert = require('node:assert/strict');

const { reportMonth, ratios } = require('../src/lib/metrics');

// ── mês do relatório ─────────────────────────────────────────────────────────
test('o mês do relatório é o do fim do período', () => {
  assert.equal(reportMonth({ periodo_ini: '2026-07-06', periodo_fim: '2026-07-12' }), '2026-07');
});

test('semana que atravessa a virada cai no mês do fim', () => {
  // 29/06 a 05/07 é relatório de julho — a semana é indivisível
  assert.equal(reportMonth({ periodo_ini: '2026-06-29', periodo_fim: '2026-07-05' }), '2026-07');
});

test('sem fim de período, usa o início', () => {
  assert.equal(reportMonth({ periodo_ini: '2026-05-04', periodo_fim: null }), '2026-05');
});

test('sem período nenhum, usa a data de criação', () => {
  assert.equal(reportMonth({ criado_em: '2026-03-19 22:40:11' }), '2026-03');
});

test('sem nenhuma data utilizável devolve null', () => {
  assert.equal(reportMonth({}), null);
  assert.equal(reportMonth({ periodo_fim: 'sem data' }), null);
});

// ── razões ───────────────────────────────────────────────────────────────────
test('roas é ponderado pelo investimento, não média das semanas', () => {
  // semana A: invest 10 → receita 100 (10x) · semana B: invest 990 → receita 990 (1x)
  // média simples das razões daria 5,5x. O certo é 1090/1000 = 1,09x.
  assert.equal(ratios(0, 1000, 1090).roas, 1.09);
});

test('acos e tacos vêm das somas', () => {
  const r = ratios(10000, 2000, 8000);
  assert.equal(r.acos, 25); // 2000/8000
  assert.equal(r.tacos, 20); // 2000/10000
});

test('denominador zero devolve null, nunca Infinity', () => {
  const r = ratios(0, 0, 0);
  assert.equal(r.roas, null);  // investimento é o divisor do roas
  assert.equal(r.acos, null);  // receita de Ads é o divisor do acos
  assert.equal(r.tacos, null); // faturamento é o divisor do tacos
});

test('numerador zero com divisor válido é zero, não null', () => {
  // mês sem receita de Ads mas com investimento: o roas É zero, e dizer "—" mentiria
  assert.equal(ratios(1000, 500, 0).roas, 0);
  assert.equal(ratios(1000, 500, 0).tacos, 50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL com `Cannot find module '../src/lib/metrics'`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/lib/metrics.js`:

```js
// metrics — regras de métrica compartilhadas entre o Painel CS e o Fechamento
// mensal. Puras: sem banco, sem relógio.

// A que mês pertence um relatório. O fim do período manda: uma semana que
// atravessa a virada (29/06–05/07) é relatório de julho, inteira. Ratear entre
// dois meses seria mais fiel e bem mais complexo — o relatório é indivisível.
// Recebe a linha crua do banco (snake_case).
function reportMonth(row) {
  const raw = String((row && (row.periodo_fim || row.periodo_ini || row.criado_em)) || '');
  const m = raw.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? m : null;
}

// ROAS/ACOS/TACOS a partir de valores JÁ SOMADOS — nunca média de razões.
// Denominador zero devolve null (não dá para afirmar a razão), nunca 0 nem Infinity.
function ratios(faturamento, investimento, receitaAds) {
  return {
    roas: investimento > 0 ? +(receitaAds / investimento).toFixed(2) : null,
    acos: receitaAds > 0 ? +((investimento / receitaAds) * 100).toFixed(1) : null,
    tacos: faturamento > 0 ? +((investimento / faturamento) * 100).toFixed(1) : null,
  };
}

module.exports = { reportMonth, ratios };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS, todos os testes anteriores continuam verdes.

- [ ] **Step 5: Trocar o dashboardService para usar o lib**

Em `backend/src/services/dashboardService.js`, adicione o require no topo (junto dos outros):

```js
const { reportMonth, ratios } = require('../lib/metrics');
```

Apague a definição local de `ratios` (a arrow function `const ratios = (fat, inv, rec) => ({...})`) e troque o cálculo do mês no loop de `metricRows`:

```js
  for (const r of metricRows) {
    const m = reportMonth(r);
    if (!m) continue; // ignora relatórios sem data de período válida
    const nome = r.analista || '—';
```

- [ ] **Step 6: Confirmar que o painel não mudou**

Run:
```bash
cd backend && npm test && node -e "
const db=require('./src/db/knex');
const svc=require('./src/services/dashboardService');
(async()=>{ const u=await db('users').where({papel:'admin'}).first();
  const d=await svc.getDashboard(u);
  console.log('meses:', d.analystMonthly.months);
  console.log('linhas do 1o mes:', JSON.stringify(d.analystMonthly.byMonth[d.analystMonthly.months[0]]));
  await db.destroy(); })();"
```
Expected: testes verdes e os mesmos meses/linhas de antes do refactor. É refactor: os números não podem mudar.

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/metrics.js backend/test/metrics.test.js backend/src/services/dashboardService.js
git commit -m "refactor(metricas): mes do relatorio e razoes em lib compartilhado"
```

---

### Task 2: expor `criadoEm` na conta enriquecida

A regra de "quem entra no mês" usa a data de entrada da conta com fallback para a criação. O objeto pré-enriquecimento já tem `criadoEm` (`clientService.js:111`), mas `enrichAccount` não repassa.

**Normalize com `p4.businessDateISO`, nunca com `String(...).slice(0, 10)`.** No Postgres `criado_em` é `timestamp` e chega como objeto `Date`; `String(new Date(...)).slice(0,10)` devolve `"Mon Feb 09"`, dado corrompido em silêncio. `businessDateISO` já é o normalizador usado para esse mesmo campo em `contaAtrasada` e em `clientService`, e devolve `null` para valor ausente.

**Files:**
- Modify: `backend/src/lib/clientAggregate.js` (retorno de `enrichAccount`)
- Modify: `backend/test/atraso.test.js` (um teste novo no fim)

**Interfaces:**
- Produces: conta enriquecida passa a ter `criadoEm: string | null`.

- [ ] **Step 1: Write the failing test**

No fim de `backend/test/atraso.test.js`:

```js
// ── conta expõe a data de criação (fallback de entrada no fechamento mensal) ──
test('conta enriquecida repassa criadoEm', () => {
  const c = enrichClient(
    { id: 'c1', loja: 'Teste', agenda: { freq: 'Semanal', diaSemana: 'Quarta' } },
    [{ id: 'a1', marketplace: 'Shopee', ativo: true, criadoEm: '2026-02-10', reports: [] }],
    { asOf: ASOF }
  );
  assert.equal(c.contas[0].criadoEm, '2026-02-10');
});

test('conta enriquecida normaliza criadoEm vindo como Date (forma do Postgres)', () => {
  const c = enrichClient(
    { id: 'c1', loja: 'Teste', agenda: { freq: 'Semanal', diaSemana: 'Quarta' } },
    [{ id: 'a1', marketplace: 'Shopee', ativo: true, criadoEm: new Date('2026-02-10T12:00:00Z'), reports: [] }],
    { asOf: ASOF }
  );
  assert.equal(c.contas[0].criadoEm, '2026-02-10');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `undefined !== '2026-02-10'`.

- [ ] **Step 3: Write minimal implementation**

Em `backend/src/lib/clientAggregate.js`, no objeto retornado por `enrichAccount`, logo depois de `dataEncerramento`:

```js
    dataEncerramento: acc.dataEncerramento || null,
    criadoEm: p4.businessDateISO(acc.criadoEm),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/clientAggregate.js backend/test/atraso.test.js
git commit -m "feat(contas): expor criadoEm na conta enriquecida"
```

---

### Task 3: migration `monthly_closings`

**Files:**
- Create: `backend/src/db/migrations/20260725000001_monthly_closings.js`

**Interfaces:**
- Produces: tabela `monthly_closings` com colunas `id, client_id, ym, observacoes, fechado_em, fechado_por, criado_em, atualizado_em` e índice único em (`client_id`, `ym`).

- [ ] **Step 1: Escrever a migration**

`backend/src/db/migrations/20260725000001_monthly_closings.js`:

```js
// Fechamento mensal por cliente: observação do mês + marca de fechado.
// fechado_em NULL = mês aberto (a linha pode existir só com a observação).
// Roda no boot (server.js -> migrate.latest()).

exports.up = async function up(knex) {
  await knex.schema.createTable('monthly_closings', (t) => {
    // uuid vai como t.string, NUNCA t.uuid: as demais tabelas usam string, e no
    // Postgres t.uuid vira coluna uuid nativa — a FK uuid -> varchar e rejeitada
    // na criacao e derruba o boot. No SQLite o erro nao aparece (char e varchar
    // dividem a mesma afinidade TEXT).
    t.string('id').primary();
    t.string('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.string('ym', 7).notNullable(); // '2026-07'
    t.text('observacoes');
    t.timestamp('fechado_em');
    t.string('fechado_por').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('criado_em').notNullable().defaultTo(knex.fn.now());
    t.timestamp('atualizado_em').notNullable().defaultTo(knex.fn.now());
    t.unique(['client_id', 'ym']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('monthly_closings');
};
```

- [ ] **Step 2: Rodar e conferir o schema**

Run:
```bash
cd backend && npm run migrate && node -e "
const db=require('./src/db/knex');
(async()=>{
  const c=await db('monthly_closings').columnInfo();
  console.log('colunas:', Object.keys(c).join(', '));
  await db.destroy();
})();"
```
Expected: `colunas: id, client_id, ym, observacoes, fechado_em, fechado_por, criado_em, atualizado_em`.

- [ ] **Step 3: Conferir que o rollback funciona e reaplicar**

Run:
```bash
cd backend && npx knex migrate:down && npx knex migrate:latest
```
Expected: desce e sobe sem erro. (Se `migrate:down` não existir nesta versão do knex, pule — o `down` está escrito e é o que importa.)

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/20260725000001_monthly_closings.js
git commit -m "feat(db): tabela monthly_closings"
```

---

### Task 4: `lib/monthlyClosing.js` — janela do mês e quem entra

**Files:**
- Create: `backend/src/lib/monthlyClosing.js`
- Create: `backend/test/monthly-closing.test.js`

**Interfaces:**
- Produces:
  - `monthRange(ym)` → `{ ini: 'YYYY-MM-01', fim: 'YYYY-MM-DD' }` (último dia do mês).
  - `accountInMonth(conta, ym, temRelatorio)` → `boolean`. `conta` é a conta enriquecida (`dataEntrada`, `dataEncerramento`, `criadoEm`).

- [ ] **Step 1: Write the failing test**

`backend/test/monthly-closing.test.js`:

```js
// Testes de lib/monthlyClosing — fechamento mensal. Puros, sem banco.
const test = require('node:test');
const assert = require('node:assert/strict');

const { monthRange, accountInMonth } = require('../src/lib/monthlyClosing');

// ── janela do mês ────────────────────────────────────────────────────────────
test('mês de 31 dias', () => {
  assert.deepEqual(monthRange('2026-07'), { ini: '2026-07-01', fim: '2026-07-31' });
});

test('mês de 30 dias', () => {
  assert.deepEqual(monthRange('2026-06'), { ini: '2026-06-01', fim: '2026-06-30' });
});

test('fevereiro de ano bissexto', () => {
  assert.deepEqual(monthRange('2028-02'), { ini: '2028-02-01', fim: '2028-02-29' });
});

// ── quem entra no mês ────────────────────────────────────────────────────────
const JUL = '2026-07';

test('conta com relatório no mês entra, mesmo já encerrada hoje', () => {
  const conta = { dataEntrada: '2025-01-10', dataEncerramento: '2026-08-15' };
  assert.equal(accountInMonth(conta, JUL, true), true);
});

test('conta criada depois do mês não entra', () => {
  const conta = { dataEntrada: null, criadoEm: '2026-09-02', dataEncerramento: null };
  assert.equal(accountInMonth(conta, JUL, false), false);
});

test('conta encerrada antes do mês não entra', () => {
  const conta = { dataEntrada: '2025-03-01', dataEncerramento: '2026-06-30' };
  assert.equal(accountInMonth(conta, JUL, false), false);
});

test('conta encerrada no meio do mês entra', () => {
  const conta = { dataEntrada: '2025-03-01', dataEncerramento: '2026-07-15' };
  assert.equal(accountInMonth(conta, JUL, false), true);
});

test('conta que entrou no meio do mês entra', () => {
  const conta = { dataEntrada: '2026-07-20', dataEncerramento: null };
  assert.equal(accountInMonth(conta, JUL, false), true);
});

test('dataEntrada manda mais que criadoEm', () => {
  // cadastrada tarde no sistema, mas operando desde antes
  const conta = { dataEntrada: '2026-01-05', criadoEm: '2026-09-30', dataEncerramento: null };
  assert.equal(accountInMonth(conta, JUL, false), true);
});

test('sem nenhuma data de entrada, assume que sempre existiu', () => {
  assert.equal(accountInMonth({ dataEntrada: null, criadoEm: null }, JUL, false), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL com `Cannot find module '../src/lib/monthlyClosing'`.

- [ ] **Step 3: Write minimal implementation**

`backend/src/lib/monthlyClosing.js`:

```js
// monthlyClosing — regras do fechamento mensal. Puras: sem banco, sem relógio.

// Primeiro e último dia de 'YYYY-MM'. Date.UTC(y, m, 0) = último dia do mês m
// (índice m já é o mês seguinte em base 0), então cobre bissexto de graça.
function monthRange(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { ini: `${ym}-01`, fim: `${ym}-${String(ultimo).padStart(2, '0')}` };
}

// Uma conta entra no mês por duas portas independentes:
//  1. teve relatório no mês — evidência direta de operação, vale mesmo que a
//     conta esteja encerrada hoje;
//  2. a janela de datas cobre o mês.
// A porta 2 é o que evita listar conta cadastrada em setembro no fechamento de
// julho; a porta 1 é o que mantém conta encerrada em agosto no fechamento de julho.
function accountInMonth(conta, ym, temRelatorio) {
  if (temRelatorio) return true;
  const { ini, fim } = monthRange(ym);
  const entrada = conta.dataEntrada || conta.criadoEm || null;
  if (entrada && String(entrada).slice(0, 10) > fim) return false;
  const saida = conta.dataEncerramento || null;
  if (saida && String(saida).slice(0, 10) < ini) return false;
  return true; // sem data de entrada conhecida: assume que já existia
}

module.exports = { monthRange, accountInMonth };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/monthlyClosing.js backend/test/monthly-closing.test.js
git commit -m "feat(fechamento): janela do mes e regra de quem entra"
```

---

### Task 5: consolidação dos relatórios do mês

**Files:**
- Modify: `backend/src/lib/monthlyClosing.js`
- Modify: `backend/test/monthly-closing.test.js`

**Interfaces:**
- Consumes: `ratios` de `lib/metrics` (Task 1).
- Produces: `consolidate(rows)` → `{ faturamento, vendas, receitaAds, vendasAds, investimento, roas, acos, tacos }`. `rows` são linhas cruas do banco (`faturamento, vendas, receita_ads, vendas_ads, investimento`).

- [ ] **Step 1: Write the failing test**

Adicione ao topo de `backend/test/monthly-closing.test.js` o import:

```js
const { monthRange, accountInMonth, consolidate } = require('../src/lib/monthlyClosing');
```

E no fim do arquivo:

```js
// ── consolidação ─────────────────────────────────────────────────────────────
function rel(faturamento, investimento, receita_ads, vendas, vendas_ads) {
  return { faturamento, investimento, receita_ads, vendas: vendas || 0, vendas_ads: vendas_ads || 0 };
}

test('soma os valores absolutos de todos os relatórios', () => {
  const t = consolidate([rel(1000, 100, 400, 10, 4), rel(2000, 300, 900, 20, 9)]);
  assert.equal(t.faturamento, 3000);
  assert.equal(t.investimento, 400);
  assert.equal(t.receitaAds, 1300);
  assert.equal(t.vendas, 30);
  assert.equal(t.vendasAds, 13);
});

test('roas do mês é ponderado, não média das semanas', () => {
  // A: 100 → 1000 (10x) · B: 900 → 900 (1x). Média simples = 5,5x. Ponderado = 1,9x.
  const t = consolidate([rel(0, 100, 1000), rel(0, 900, 900)]);
  assert.equal(t.roas, 1.9);
});

test('lista vazia devolve tudo zerado e razões nulas', () => {
  const t = consolidate([]);
  assert.equal(t.faturamento, 0);
  assert.equal(t.investimento, 0);
  assert.equal(t.roas, null);
  assert.equal(t.acos, null);
  assert.equal(t.tacos, null);
});

test('campos ausentes ou textuais não viram NaN', () => {
  const t = consolidate([{ faturamento: null, investimento: undefined }, rel(500, 50, 200)]);
  assert.equal(t.faturamento, 500);
  assert.equal(t.investimento, 50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `consolidate is not a function`.

- [ ] **Step 3: Write minimal implementation**

No topo de `backend/src/lib/monthlyClosing.js`:

```js
const { ratios } = require('./metrics');
```

E antes do `module.exports`:

```js
const num = (v) => (Number(v) || 0);

// Soma os relatórios do período e deriva as razões DA SOMA. Média de razões
// daria peso igual a uma semana de R$100 e a uma de R$100.000.
function consolidate(rows) {
  const t = (rows || []).reduce(
    (a, r) => ({
      faturamento: a.faturamento + num(r.faturamento),
      vendas: a.vendas + num(r.vendas),
      receitaAds: a.receitaAds + num(r.receita_ads),
      vendasAds: a.vendasAds + num(r.vendas_ads),
      investimento: a.investimento + num(r.investimento),
    }),
    { faturamento: 0, vendas: 0, receitaAds: 0, vendasAds: 0, investimento: 0 }
  );
  return { ...t, ...ratios(t.faturamento, t.investimento, t.receitaAds) };
}
```

Atualize o export:

```js
module.exports = { monthRange, accountInMonth, consolidate };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/monthlyClosing.js backend/test/monthly-closing.test.js
git commit -m "feat(fechamento): consolidacao do mes com razoes ponderadas"
```

---

### Task 6: comparação com meta

**Files:**
- Modify: `backend/src/lib/monthlyClosing.js`
- Modify: `backend/test/monthly-closing.test.js`

**Interfaces:**
- Produces: `metaStatus(valor, metaRaw, direcao)` → `true | false | null`. `direcao` é `'piso'` (ROAS) ou `'teto'` (ACOS/TACOS). `null` = sem meta ou sem valor.

- [ ] **Step 1: Write the failing test**

Atualize o import e acrescente ao fim de `backend/test/monthly-closing.test.js`:

```js
// (adicione metaStatus ao require do topo do arquivo)

// ── comparação com meta ──────────────────────────────────────────────────────
test('ROAS é piso: bateu quando alcança ou passa', () => {
  assert.equal(metaStatus(4.8, '4,00', 'piso'), true);
  assert.equal(metaStatus(4.0, '4,00', 'piso'), true);
  assert.equal(metaStatus(3.9, '4,00', 'piso'), false);
});

test('ACOS é teto: bateu quando fica abaixo', () => {
  assert.equal(metaStatus(18, '20,00', 'teto'), true);
  assert.equal(metaStatus(20, '20,00', 'teto'), true);
  assert.equal(metaStatus(22, '20,00', 'teto'), false);
});

test('meta vazia devolve null, nunca false', () => {
  // meta ausente não é meta não batida — a tela mostra "—", não "✗"
  assert.equal(metaStatus(4.8, '', 'piso'), null);
  assert.equal(metaStatus(4.8, null, 'piso'), null);
  assert.equal(metaStatus(4.8, '0', 'piso'), null);
});

test('valor ausente devolve null', () => {
  assert.equal(metaStatus(null, '4,00', 'piso'), null);
  assert.equal(metaStatus(undefined, '4,00', 'piso'), null);
});

test('meta em pt-BR com milhar é lida certo', () => {
  assert.equal(metaStatus(1500, '1.200,00', 'piso'), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `metaStatus is not a function`.

- [ ] **Step 3: Write minimal implementation**

No topo de `backend/src/lib/monthlyClosing.js` acrescente:

```js
const p4 = require('./p4');
```

E antes do `module.exports`:

```js
// Compara um valor consolidado com a meta cadastrada da conta.
// direcao: 'piso' (ROAS — quanto mais alto melhor) | 'teto' (ACOS/TACOS).
// Devolve null quando não há meta ou não há valor: meta ausente NÃO é meta
// não batida, e a tela precisa distinguir "—" de "✗".
function metaStatus(valor, metaRaw, direcao) {
  const meta = p4.parseNum(metaRaw);
  if (!(meta > 0)) return null;
  if (valor === null || valor === undefined) return null;
  // sem default silencioso: errar a direcao inverteria o resultado de negocio
  if (direcao === 'piso') return valor >= meta;
  if (direcao === 'teto') return valor <= meta;
  throw new Error(`Direção de meta inválida: ${direcao}`);
}
```

Atualize o export:

```js
module.exports = { monthRange, accountInMonth, consolidate, metaStatus };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/monthlyClosing.js backend/test/monthly-closing.test.js
git commit -m "feat(fechamento): comparacao com meta por piso e teto"
```

---

### Task 7: montagem das linhas e do resumo

**Files:**
- Modify: `backend/src/lib/monthlyClosing.js`
- Modify: `backend/test/monthly-closing.test.js`

**Interfaces:**
- Consumes: `reportMonth` (Task 1), `accountInMonth` (Task 4), `consolidate` (Task 5), `metaStatus` (Task 6).
- Produces: `buildMonthlyClosing({ clients, reports, closings, ym })` → objeto descrito abaixo.
  - `clients`: clientes enriquecidos de `clientService.listClients` (`id, loja, analista, statusTag, contas[]`).
  - `reports`: array plano de linhas cruas com `account_id`.
  - `closings`: linhas de `monthly_closings` (`client_id, ym, observacoes, fechado_em, fechado_por`).

- [ ] **Step 1: Write the failing test**

Atualize o import e acrescente ao fim de `backend/test/monthly-closing.test.js`:

```js
// (adicione buildMonthlyClosing ao require do topo do arquivo)

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
function relDe(account_id, periodo_fim, faturamento, investimento, receita_ads) {
  return { account_id, periodo_fim, faturamento, investimento, receita_ads, vendas: 0, vendas_ads: 0 };
}

test('totais do cliente somam as contas e recalculam as razões', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Diego Block', [conta('a1'), conta('a2', { marketplace: 'Shopee' })])],
    reports: [
      relDe('a1', '2026-07-12', 39100, 5200, 25000),
      relDe('a2', '2026-07-12', 9100, 1210, 5000),
    ],
    closings: [],
  });
  const c = out.clients[0];
  assert.equal(c.totals.faturamento, 48200);
  assert.equal(c.totals.investimento, 6410);
  assert.equal(c.totals.roas, +((30000 / 6410).toFixed(2)));
  assert.equal(c.contas.length, 2);
  assert.equal(c.nReports, 2);
});

test('relatório de outro mês não entra na conta do mês', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    reports: [relDe('a1', '2026-06-28', 999, 99, 99), relDe('a1', '2026-07-05', 100, 10, 40)],
    closings: [],
  });
  assert.equal(out.clients[0].nReports, 1);
  assert.equal(out.clients[0].totals.faturamento, 100);
});

test('conta ativa sem relatório entra zerada', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1')])],
    reports: [],
    closings: [],
  });
  assert.equal(out.clients.length, 1);
  assert.equal(out.clients[0].nReports, 0);
  assert.equal(out.clients[0].totals.faturamento, 0);
  assert.equal(out.resumo.semRelatorio, 1);
});

test('cliente cujas contas não existiam no mês some da lista', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Novo', [conta('a1', { dataEntrada: '2026-09-01', criadoEm: '2026-09-01' })])],
    reports: [],
    closings: [],
  });
  assert.deepEqual(out.clients, []);
  assert.equal(out.resumo.clientes, 0);
});

test('atingiu vem resolvido por conta, com null para meta ausente', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'Loja', [conta('a1', { metaRoas: '4,00', metaAcos: '20,00' })])],
    reports: [relDe('a1', '2026-07-12', 10000, 1000, 5000)], // roas 5x, acos 20%
    closings: [],
  });
  const a = out.clients[0].contas[0];
  assert.equal(a.atingiu.roas, true);
  assert.equal(a.atingiu.acos, true);
  assert.equal(a.atingiu.tacos, null); // sem meta cadastrada
});

test('resumo conta fechados e pendentes; semRelatorio cruza com pendentes', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [
      cliente('c1', 'A', [conta('a1')]),
      cliente('c2', 'B', [conta('a2')]),
    ],
    reports: [relDe('a1', '2026-07-12', 100, 10, 40)],
    closings: [{ client_id: 'c1', ym: '2026-07', observacoes: 'ok', fechado_em: '2026-08-01', fechado_por: 'u1' }],
  });
  assert.equal(out.resumo.clientes, 2);
  assert.equal(out.resumo.fechados, 1);
  assert.equal(out.resumo.pendentes, 1);
  assert.equal(out.resumo.semRelatorio, 1); // c2, que também é pendente
});

test('linha com observação salva mas não fechada continua pendente', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [cliente('c1', 'A', [conta('a1')])],
    reports: [],
    closings: [{ client_id: 'c1', ym: '2026-07', observacoes: 'rascunho', fechado_em: null, fechado_por: null }],
  });
  assert.equal(out.resumo.fechados, 0);
  assert.equal(out.clients[0].closing.observacoes, 'rascunho');
});

test('ordena pendentes antes de fechados, depois por faturamento desc', () => {
  const out = buildMonthlyClosing({
    ym: '2026-07',
    clients: [
      cliente('c1', 'Fechado grande', [conta('a1')]),
      cliente('c2', 'Pendente pequeno', [conta('a2')]),
      cliente('c3', 'Pendente grande', [conta('a3')]),
    ],
    reports: [
      relDe('a1', '2026-07-12', 90000, 1, 1),
      relDe('a2', '2026-07-12', 100, 1, 1),
      relDe('a3', '2026-07-12', 5000, 1, 1),
    ],
    closings: [{ client_id: 'c1', ym: '2026-07', observacoes: '', fechado_em: '2026-08-01', fechado_por: 'u1' }],
  });
  assert.deepEqual(out.clients.map((c) => c.loja), ['Pendente grande', 'Pendente pequeno', 'Fechado grande']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test`
Expected: FAIL — `buildMonthlyClosing is not a function`.

- [ ] **Step 3: Write minimal implementation**

No topo de `backend/src/lib/monthlyClosing.js` acrescente ao require de metrics:

```js
const { ratios, reportMonth } = require('./metrics');
```

E antes do `module.exports`:

```js
// Monta a tela inteira: uma linha por cliente que operou no mês, cada uma com
// as contas detalhadas. Recebe tudo pronto do service e não toca o banco.
function buildMonthlyClosing({ clients, reports, closings, ym }) {
  // relatórios DO MÊS, agrupados por conta
  const porConta = new Map();
  for (const r of reports || []) {
    if (reportMonth(r) !== ym) continue;
    if (!porConta.has(r.account_id)) porConta.set(r.account_id, []);
    porConta.get(r.account_id).push(r);
  }
  const fechamentos = new Map((closings || []).map((c) => [c.client_id, c]));

  const linhas = [];
  for (const c of clients || []) {
    const contas = [];
    for (const a of c.contas || []) {
      const rows = porConta.get(a.id) || [];
      if (!accountInMonth(a, ym, rows.length > 0)) continue;
      const totals = consolidate(rows);
      contas.push({
        accountId: a.id,
        marketplace: a.marketplace,
        conta: a.conta || '',
        nReports: rows.length,
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
    if (!contas.length) continue; // nenhuma conta operou no mês → cliente fora

    // total do cliente: soma as somas das contas e recalcula as razões
    const soma = contas.reduce(
      (a, x) => ({
        faturamento: a.faturamento + x.totals.faturamento,
        vendas: a.vendas + x.totals.vendas,
        receitaAds: a.receitaAds + x.totals.receitaAds,
        vendasAds: a.vendasAds + x.totals.vendasAds,
        investimento: a.investimento + x.totals.investimento,
      }),
      { faturamento: 0, vendas: 0, receitaAds: 0, vendasAds: 0, investimento: 0 }
    );
    const f = fechamentos.get(c.id) || null;
    linhas.push({
      clientId: c.id,
      loja: c.loja,
      analista: c.analista || '—',
      statusTag: c.statusTag,
      nReports: contas.reduce((n, x) => n + x.nReports, 0),
      totals: { ...soma, ...ratios(soma.faturamento, soma.investimento, soma.receitaAds) },
      contas,
      closing: f
        ? { observacoes: f.observacoes || '', fechadoEm: f.fechado_em || null, fechadoPor: f.fechado_por || null }
        : null,
    });
  }

  // pendentes primeiro (é o que falta fazer), depois faturamento desc, depois nome
  linhas.sort((a, b) => {
    const fa = a.closing && a.closing.fechadoEm ? 1 : 0;
    const fb = b.closing && b.closing.fechadoEm ? 1 : 0;
    return fa - fb
      || b.totals.faturamento - a.totals.faturamento
      || String(a.loja).localeCompare(String(b.loja), 'pt-BR');
  });

  const fechados = linhas.filter((l) => l.closing && l.closing.fechadoEm).length;
  return {
    ym,
    resumo: {
      clientes: linhas.length,
      fechados,
      pendentes: linhas.length - fechados,
      semRelatorio: linhas.filter((l) => l.nReports === 0).length,
    },
    clients: linhas,
  };
}
```

Atualize o export:

```js
module.exports = { monthRange, accountInMonth, consolidate, metaStatus, buildMonthlyClosing };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS, todos os testes do projeto verdes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/monthlyClosing.js backend/test/monthly-closing.test.js
git commit -m "feat(fechamento): montagem das linhas, resumo e ordenacao"
```

---

### Task 8: `closingService`

**Files:**
- Create: `backend/src/services/closingService.js`

**Interfaces:**
- Consumes: `buildMonthlyClosing`, `monthRange` (Tasks 4/7); `clientService.listClients`.
- Produces:
  - `getMonthlyClosing(user, ym)` → o objeto da Task 7.
  - `saveClosing(user, clientId, ym, { observacoes, fechado })` → `{ observacoes, fechadoEm, fechadoPor }`.
  - `isValidYm(ym)` → `boolean`.

- [ ] **Step 1: Escrever o service**

`backend/src/services/closingService.js`:

```js
// closingService — fechamento mensal. Busca no banco e delega toda a regra
// para lib/monthlyClosing, que é pura e testada.
const { v4: uuid } = require('uuid');
const db = require('../db/knex');
const clientService = require('./clientService');
const { notFound, forbidden } = require('../lib/errors');
const { buildMonthlyClosing, monthRange } = require('../lib/monthlyClosing');

function isValidYm(ym) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || ''));
}

// Janela larga o bastante para pegar qualquer semana que atravesse a virada.
// reportMonth decide em definitivo depois, em JS — isto aqui é só o recorte
// da consulta, para não carregar o histórico inteiro.
function queryWindow(ym) {
  const { ini, fim } = monthRange(ym);
  const desloca = (iso, dias) => {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  };
  return { de: desloca(ini, -45), ate: desloca(fim, 45) };
}

async function getMonthlyClosing(user, ym) {
  // listClients já filtra por papel (analista vê só os seus) e traz statusTag +
  // contas com metas e datas. Inclui encerrados de propósito: meses passados
  // precisam listar quem operou na época.
  const { clients } = await clientService.listClients(user, {});
  const accountIds = clients.flatMap((c) => (c.contas || []).map((a) => a.id));
  const clientIds = clients.map((c) => c.id);

  let reports = [];
  if (accountIds.length) {
    const { de, ate } = queryWindow(ym);
    reports = await db('reports')
      .whereIn('account_id', accountIds)
      .andWhereRaw('COALESCE(periodo_fim, periodo_ini, criado_em) BETWEEN ? AND ?', [de, ate])
      .select('account_id', 'periodo_ini', 'periodo_fim', 'criado_em',
              'faturamento', 'vendas', 'receita_ads', 'vendas_ads', 'investimento');
  }

  const closings = clientIds.length
    ? await db('monthly_closings').whereIn('client_id', clientIds).andWhere({ ym })
    : [];

  return buildMonthlyClosing({ clients, reports, closings, ym });
}

// Grava observação e/ou muda o estado do mês. A linha nasce no primeiro dos
// dois eventos. Reabrir zera fechado_em/fechado_por e PRESERVA a observação.
async function saveClosing(user, clientId, ym, { observacoes, fechado }) {
  // escopo de escrita: analista só mexe no próprio cliente
  const { clients } = await clientService.listClients(user, {});
  const alvo = clients.find((c) => c.id === clientId);
  if (!alvo) throw notFound('Cliente não encontrado.');
  if (user.papel === 'analista' && alvo.analistaId !== user.id) {
    throw forbidden('Você só pode fechar o mês dos seus clientes.');
  }

  const agora = new Date().toISOString();
  const existente = await db('monthly_closings').where({ client_id: clientId, ym }).first();

  const patch = { atualizado_em: agora };
  if (observacoes !== undefined) patch.observacoes = observacoes;
  if (fechado !== undefined) {
    patch.fechado_em = fechado ? agora : null;
    patch.fechado_por = fechado ? user.id : null;
  }

  if (existente) {
    await db('monthly_closings').where({ id: existente.id }).update(patch);
  } else {
    await db('monthly_closings').insert({
      id: uuid(),
      client_id: clientId,
      ym,
      observacoes: observacoes || '',
      fechado_em: patch.fechado_em || null,
      fechado_por: patch.fechado_por || null,
      criado_em: agora,
      atualizado_em: agora,
    });
  }

  const row = await db('monthly_closings').where({ client_id: clientId, ym }).first();
  return { observacoes: row.observacoes || '', fechadoEm: row.fechado_em || null, fechadoPor: row.fechado_por || null };
}

module.exports = { getMonthlyClosing, saveClosing, isValidYm };
```

- [ ] **Step 2: Conferir contra o banco local**

Run:
```bash
cd backend && node -e "
const db=require('./src/db/knex');
const svc=require('./src/services/closingService');
(async()=>{
  const u=await db('users').where({papel:'admin'}).first();
  const out=await svc.getMonthlyClosing(u,'2026-07');
  console.log('resumo:', JSON.stringify(out.resumo));
  console.log('clientes:', out.clients.map(c=>c.loja+' ('+c.nReports+' rel)').join(' | '));
  await db.destroy();
})();"
```
Expected: um resumo coerente e a lista dos clientes que operaram em julho/2026. Nenhum erro de SQL.

- [ ] **Step 3: Conferir o gravar e o reabrir**

Run:
```bash
cd backend && node -e "
const db=require('./src/db/knex');
const svc=require('./src/services/closingService');
(async()=>{
  const u=await db('users').where({papel:'admin'}).first();
  const out=await svc.getMonthlyClosing(u,'2026-07');
  const id=out.clients[0].clientId;
  console.log('fechar :', JSON.stringify(await svc.saveClosing(u,id,'2026-07',{observacoes:'teste',fechado:true})));
  console.log('reabrir:', JSON.stringify(await svc.saveClosing(u,id,'2026-07',{fechado:false})));
  await db('monthly_closings').where({client_id:id,ym:'2026-07'}).del();
  console.log('limpo');
  await db.destroy();
})();"
```
Expected: fechar devolve `fechadoEm` preenchido; reabrir devolve `fechadoEm: null` **com `observacoes: 'teste'` preservada**.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/closingService.js
git commit -m "feat(fechamento): service de leitura e gravacao do mes"
```

---

### Task 9: rota `/closings`

**Files:**
- Create: `backend/src/routes/closings.js`
- Modify: `backend/src/app.js`

**Interfaces:**
- Produces:
  - `GET /closings?ym=YYYY-MM` → objeto da Task 7. Sem `ym`, usa o mês corrente.
  - `PUT /closings/:clientId/:ym` body `{ observacoes?, fechado? }` → `{ closing: {...} }`.

- [ ] **Step 1: Escrever a rota**

`backend/src/routes/closings.js`:

```js
// /closings — fechamento mensal dos clientes.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../lib/errors');
const closingService = require('../services/closingService');
const p4 = require('../lib/p4');

const router = express.Router();
router.use(authenticate);

// fuso do negocio, nao UTC: dia 31 as 21h em SP ja e dia 1 em UTC, e o padrao
// abriria no mes seguinte justamente na noite do fechamento
const mesCorrente = () => p4.todayISO().slice(0, 7);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ym = req.query.ym || mesCorrente();
    if (!closingService.isValidYm(ym)) throw badRequest('Mês inválido. Use o formato AAAA-MM.');
    res.json(await closingService.getMonthlyClosing(req.user, ym));
  })
);

router.put(
  '/:clientId/:ym',
  asyncHandler(async (req, res) => {
    const { clientId, ym } = req.params;
    if (!closingService.isValidYm(ym)) throw badRequest('Mês inválido. Use o formato AAAA-MM.');
    const { observacoes, fechado } = req.body || {};
    if (observacoes === undefined && fechado === undefined) {
      throw badRequest('Nada para salvar: informe observacoes e/ou fechado.');
    }
    if (observacoes !== undefined && typeof observacoes !== 'string') {
      throw badRequest('observacoes deve ser texto.');
    }
    if (fechado !== undefined && typeof fechado !== 'boolean') {
      throw badRequest('fechado deve ser true ou false.');
    }
    const closing = await closingService.saveClosing(req.user, clientId, ym, { observacoes, fechado });
    res.json({ closing });
  })
);

module.exports = router;
```

- [ ] **Step 2: Montar no app**

Em `backend/src/app.js`, junto dos outros requires de rota:

```js
const closingRoutes = require('./routes/closings');
```

E junto dos outros `app.use`, antes do `app.use('/', reportRoutes)` (que é catch-all):

```js
app.use('/closings', closingRoutes);
```

Acrescente `'/closings'` à lista `endpoints` do handler de `/`.

- [ ] **Step 3: Testar a rota de ponta a ponta**

Suba o backend (`npm run dev`) e, com um token válido em `$TK`:

```bash
curl -s -H "Authorization: Bearer $TK" "http://localhost:4000/closings?ym=2026-07" | head -c 400; echo
curl -s -H "Authorization: Bearer $TK" "http://localhost:4000/closings?ym=abc" ; echo
```
Expected: o primeiro devolve `{"ym":"2026-07","resumo":{...}`; o segundo devolve 400 com "Mês inválido".

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/closings.js backend/src/app.js
git commit -m "feat(fechamento): rota /closings"
```

---

### Task 10: cliente HTTP no frontend

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-api.js`

**Interfaces:**
- Produces: `window.P4_API.getClosings(ym)` e `window.P4_API.saveClosing(clientId, ym, payload)`.

- [ ] **Step 1: Adicionar os métodos**

Em `design_handoff_sistema_feedbacks/p4-api.js`, logo depois de `getDashboard`:

```js
  async function getClosings(ym) { return apiFetch('/closings' + qs({ ym })); }
  async function saveClosing(clientId, ym, payload) {
    return (await apiFetch('/closings/' + encodeURIComponent(clientId) + '/' + encodeURIComponent(ym),
      { method: 'PUT', body: payload })).closing;
  }
```

E no objeto `window.P4_API`, na linha do `getDashboard`:

```js
    getDashboard, getClosings, saveClosing,
```

- [ ] **Step 2: Conferir no console do navegador**

Com o frontend servido e logado, no console:
```js
await P4_API.getClosings('2026-07')
```
Expected: o objeto com `ym`, `resumo` e `clients`.

- [ ] **Step 3: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-api.js
git commit -m "feat(fechamento): metodos getClosings e saveClosing no cliente HTTP"
```

---

### Task 11: tela — tabela e navegador de mês

**Files:**
- Create: `design_handoff_sistema_feedbacks/p4-closing.jsx`

**Interfaces:**
- Consumes: `window.P4_API.getClosings` (Task 10).
- Produces: `window.MonthlyClosing`, componente React com props
  `{ user, role, onLogout, onManageUsers, toast }`.

- [ ] **Step 1: Escrever a tela (somente leitura, sem expandir ainda)**

`design_handoff_sistema_feedbacks/p4-closing.jsx`:

```js
// p4-closing.jsx — fechamento mensal dos clientes.
// Consolidado do mês por cliente (expansível em contas) contra as metas.

const MC_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function mcYmLabel(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return `${MC_MESES[m - 1]} / ${y}`;
}
function mcShiftYm(ym, delta) {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
function mcHoje() { return new Date().toISOString().slice(0, 7); }

const mcMoney = (v) => (v ? window.fmtMoneyShort(v) : '—');
const mcRoas = (v) => (v == null ? '—' : v.toFixed(2).replace('.', ',') + 'x');
const mcPct = (v) => (v == null ? '—' : v.toFixed(1).replace('.', ',') + '%');

// ✓ / ✗ / — conforme o backend já resolveu em `atingiu`
function McMeta({ ok, meta, sufixo }) {
  if (ok === null || ok === undefined) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return (
    <span style={{ color: ok ? 'var(--brand-ink)' : 'var(--red-ink)', fontWeight: 600, fontSize: 11 }}>
      {ok ? '✓' : '✗'} meta {meta}{sufixo}
    </span>
  );
}

const MC_COLS = '2fr 1fr 1fr .8fr 1fr';

function MonthlyClosing({ user, role, onLogout, onManageUsers, toast }) {
  const [ym, setYm] = React.useState(mcHoje);
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState('');

  const load = React.useCallback(async (alvo) => {
    setLoading(true); setErr('');
    try {
      if (!window.P4_API || !window.P4_API.isLogged()) throw new Error('Faça login para ver o fechamento.');
      setData(await window.P4_API.getClosings(alvo));
    } catch (e) {
      setErr(e.message || 'Falha ao carregar o fechamento.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(ym); }, [ym, load]);

  const r = (data && data.resumo) || {};

  return (
    <div className="shell">
      <window.TopBar title="Fechamento" user={user} role={role} onLogout={onLogout} onManageUsers={onManageUsers} />
      <div className="page">
        <div className="page-inner">
          <div className="ch-top">
            <div>
              <h1>Fechamento mensal</h1>
              <div className="ch-sub">Consolidado do mês por cliente, comparado com as metas cadastradas</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn-line" onClick={() => setYm(mcShiftYm(ym, -1))} title="Mês anterior">◀</button>
              <b style={{ fontSize: 14, minWidth: 150, textAlign: 'center' }}>{mcYmLabel(ym)}</b>
              <button className="btn-line" onClick={() => setYm(mcShiftYm(ym, 1))} title="Próximo mês">▶</button>
            </div>
          </div>

          {loading ? (
            <div className="empty"><b>Carregando…</b>Buscando os relatórios do mês.</div>
          ) : err ? (
            <div className="empty"><b>Não foi possível carregar</b>{err}</div>
          ) : !data.clients.length ? (
            <div className="empty"><b>Nenhum cliente operou neste mês</b>Escolha outro mês na navegação acima.</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16, fontSize: 12.5 }}>
                <span><b>{r.clientes}</b> clientes</span>
                <span style={{ color: 'var(--muted)' }}>·</span>
                <span style={{ color: 'var(--brand-ink)' }}><b>{r.fechados}</b> fechados</span>
                <span style={{ color: 'var(--muted)' }}>·</span>
                <span><b>{r.pendentes}</b> pendentes</span>
                {r.semRelatorio ? (
                  <>
                    <span style={{ color: 'var(--muted)' }}>·</span>
                    <span style={{ color: 'var(--amber-ink)' }}>⚠ <b>{r.semRelatorio}</b> sem relatório</span>
                  </>
                ) : null}
              </div>

              <div style={{ background: 'var(--paper,#fff)', border: '1px solid var(--line,#e9ece9)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: MC_COLS, gap: 10, padding: '12px 18px', borderBottom: '1px solid var(--line)', fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                  <span>Cliente</span>
                  <span style={{ textAlign: 'right' }}>Faturamento</span>
                  <span style={{ textAlign: 'right' }}>Investimento</span>
                  <span style={{ textAlign: 'right' }}>ROAS</span>
                  <span style={{ textAlign: 'right' }}>Situação</span>
                </div>
                {data.clients.map((c) => (
                  <div key={c.clientId} style={{ display: 'grid', gridTemplateColumns: MC_COLS, gap: 10, padding: '13px 18px', borderBottom: '1px solid var(--line)', alignItems: 'center', fontSize: 13, opacity: c.closing && c.closing.fechadoEm ? .62 : 1 }}>
                    <span style={{ fontWeight: 600 }}>
                      {c.nReports === 0 ? <span title="operou no mês mas ficou sem relatório" style={{ color: 'var(--amber-ink)' }}>⚠ </span> : null}
                      {c.loja}
                      <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}> · {c.analista}</span>
                    </span>
                    <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcMoney(c.totals.faturamento)}</span>
                    <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcMoney(c.totals.investimento)}</span>
                    <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcRoas(c.totals.roas)}</span>
                    <span style={{ textAlign: 'right', fontSize: 11.5, fontWeight: 600, color: c.closing && c.closing.fechadoEm ? 'var(--brand-ink)' : 'var(--muted)' }}>
                      {c.closing && c.closing.fechadoEm ? '✓ fechado' : '● a fechar'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

window.MonthlyClosing = MonthlyClosing;
```

- [ ] **Step 2: Validar a sintaxe JSX**

Run: `npx --yes esbuild@0.24 --loader:.jsx=jsx --outfile=/dev/null design_handoff_sistema_feedbacks/p4-closing.jsx`
Expected: compila sem erro. (Só valida sintaxe — a tela ainda não está registrada.)

- [ ] **Step 3: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-closing.jsx
git commit -m "feat(fechamento): tela com tabela do mes e navegador"
```

---

### Task 12: tela — expandir contas, observação e fechar

**Files:**
- Modify: `design_handoff_sistema_feedbacks/p4-closing.jsx`

**Interfaces:**
- Consumes: `window.P4_API.saveClosing` (Task 10).

- [ ] **Step 1: Adicionar o estado de expansão e o painel**

Dentro de `MonthlyClosing`, junto dos outros `useState`:

```js
  const [aberto, setAberto] = React.useState(null); // clientId expandido (um por vez)
  const [obs, setObs] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);

  const expandir = (c) => {
    if (aberto === c.clientId) { setAberto(null); return; }
    setAberto(c.clientId);
    setObs((c.closing && c.closing.observacoes) || '');
  };

  const gravar = async (c, fechado) => {
    if (salvando) return;
    setSalvando(true);
    try {
      await window.P4_API.saveClosing(c.clientId, ym, { observacoes: obs, fechado });
      toast(fechado ? 'Mês fechado.' : 'Mês reaberto.');
      await load(ym);
    } catch (e) {
      toast(e.message || 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  };
```

- [ ] **Step 2: Tornar a linha clicável e renderizar o painel**

Troque a `<div>` da linha do cliente por um fragmento com a linha clicável mais o painel. A linha ganha `onClick={() => expandir(c)}` e `cursor: 'pointer'`, e o nome ganha o chevron:

```jsx
                {data.clients.map((c) => (
                  <React.Fragment key={c.clientId}>
                    <div onClick={() => expandir(c)}
                         style={{ display: 'grid', gridTemplateColumns: MC_COLS, gap: 10, padding: '13px 18px', borderBottom: '1px solid var(--line)', alignItems: 'center', fontSize: 13, cursor: 'pointer', opacity: c.closing && c.closing.fechadoEm ? .62 : 1 }}>
                      <span style={{ fontWeight: 600 }}>
                        <span style={{ color: 'var(--muted)', marginRight: 6 }}>{aberto === c.clientId ? '▾' : '▸'}</span>
                        {c.nReports === 0 ? <span title="operou no mês mas ficou sem relatório" style={{ color: 'var(--amber-ink)' }}>⚠ </span> : null}
                        {c.loja}
                        <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}> · {c.analista}</span>
                      </span>
                      <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcMoney(c.totals.faturamento)}</span>
                      <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcMoney(c.totals.investimento)}</span>
                      <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcRoas(c.totals.roas)}</span>
                      <span style={{ textAlign: 'right', fontSize: 11.5, fontWeight: 600, color: c.closing && c.closing.fechadoEm ? 'var(--brand-ink)' : 'var(--muted)' }}>
                        {c.closing && c.closing.fechadoEm ? '✓ fechado' : '● a fechar'}
                      </span>
                    </div>

                    {aberto === c.clientId ? (
                      <div style={{ padding: '14px 18px 18px 40px', borderBottom: '1px solid var(--line)', background: 'var(--surface-2,#F7FAF6)' }}>
                        {c.contas.map((a) => (
                          <div key={a.accountId} style={{ display: 'grid', gridTemplateColumns: MC_COLS, gap: 10, padding: '8px 0', alignItems: 'center', fontSize: 12.5 }}>
                            <span style={{ color: 'var(--ink-2)' }}>
                              {a.marketplace}{a.conta ? ' · ' + a.conta : ''}
                              <span style={{ color: 'var(--muted)', fontSize: 11 }}> · {a.nReports} relat.</span>
                            </span>
                            <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcMoney(a.totals.faturamento)}</span>
                            <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcMoney(a.totals.investimento)}</span>
                            <span style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace" }}>{mcRoas(a.totals.roas)}</span>
                            <span style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                              <McMeta ok={a.atingiu.roas} meta={a.metas.roas} sufixo="x" />
                              <McMeta ok={a.atingiu.acos} meta={a.metas.acos} sufixo="%" />
                              <McMeta ok={a.atingiu.tacos} meta={a.metas.tacos} sufixo="%" />
                            </span>
                          </div>
                        ))}

                        <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <label style={{ flex: 1, minWidth: 260 }}>
                            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 5 }}>Observação do mês</div>
                            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3}
                                      placeholder="O que explica o resultado do mês? O que muda no próximo?"
                                      style={{ width: '100%', resize: 'vertical', fontFamily: "'Sora'", fontSize: 12.5, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 9, background: 'var(--paper)', color: 'var(--ink)' }} />
                          </label>
                          {c.closing && c.closing.fechadoEm ? (
                            <button className="btn-line" disabled={salvando} onClick={() => gravar(c, false)}>Reabrir mês</button>
                          ) : (
                            <button className="btn-accent" disabled={salvando} onClick={() => gravar(c, true)}>Fechar mês</button>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </React.Fragment>
                ))}
```

- [ ] **Step 2b: Validar a sintaxe**

Run: `npx --yes esbuild@0.24 --loader:.jsx=jsx --outfile=/dev/null design_handoff_sistema_feedbacks/p4-closing.jsx`
Expected: compila sem erro.

- [ ] **Step 3: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-closing.jsx
git commit -m "feat(fechamento): expandir contas, observacao e fechar/reabrir"
```

---

### Task 13: ligar a tela no app

**Files:**
- Modify: `design_handoff_sistema_feedbacks/index.html` (bloco de `<script type="text/babel">`)
- Modify: `design_handoff_sistema_feedbacks/p4-shell.jsx` (Sidebar + switch de `content`)

- [ ] **Step 1: Carregar o arquivo**

Em `design_handoff_sistema_feedbacks/index.html`, logo depois da linha de `p4-cs-dashboard.jsx`:

```html
<script type="text/babel" src="p4-closing.jsx"></script>
```

- [ ] **Step 2: Item na sidebar**

Em `p4-shell.jsx`, dentro de `Sidebar`, depois do bloco do "Painel CS" (que é condicionado por `seesPanel`):

```jsx
        {seesPanel
          ? <button className={'as-item' + (screen === 'closing' ? ' on' : '')} onClick={() => onNav('closing')} title="Fechamento mensal">
              {docIcon}<span>Fechamento</span>
            </button>
          : null}
```

- [ ] **Step 3: Registrar a tela no switch**

Em `p4-shell.jsx`, no encadeamento de `content`, depois do ramo `screen === 'dashboard'`:

```jsx
  } else if (screen === 'closing') {
    content = <window.MonthlyClosing user={user} role={role} onLogout={logout} onManageUsers={() => setUsersOpen(true)} toast={toast} />;
```

- [ ] **Step 4: Validar e testar na tela**

Run:
```bash
npx --yes esbuild@0.24 --loader:.jsx=jsx --outfile=/dev/null design_handoff_sistema_feedbacks/p4-shell.jsx
```
Expected: compila sem erro.

Depois, com backend e frontend no ar, no navegador:
- [ ] "Fechamento" aparece na sidebar para admin/CS
- [ ] A tela abre no mês corrente e o ◀ ▶ troca de mês
- [ ] Expandir um cliente mostra as contas com ✓/✗/— por meta
- [ ] Escrever observação e clicar em "Fechar mês" muda a linha para "✓ fechado"
- [ ] "Reabrir mês" volta para "● a fechar" **mantendo o texto da observação**
- [ ] Um analista (não admin) não vê o item na sidebar

- [ ] **Step 5: Commit**

```bash
git add design_handoff_sistema_feedbacks/index.html design_handoff_sistema_feedbacks/p4-shell.jsx
git commit -m "feat(fechamento): item na sidebar e registro da tela"
```

---

## Self-review deste plano

**Cobertura do spec:**

| seção do spec | task |
|---|---|
| 2 — navegação e acesso | 13 (sidebar/rota), 8 (escopo de escrita) |
| 3 — mês do relatório | 1 |
| 4 — quem entra no mês | 4 (+2, que expõe `criadoEm`) |
| 5 — consolidação | 5, 7 (nível cliente) |
| 6 — comparação com meta | 6 |
| 7 — persistência | 3 (tabela), 8 (gravar/reabrir) |
| 8 — backend (libs, service, rota) | 1, 4–7, 8, 9 |
| 9 — tela | 11, 12 |
| 10 — testes | embutidos em 1, 2, 4, 5, 6, 7 |

**Consistência de tipos:** `atingiu` é `true|false|null` em 6, 7 e 12. `totals` tem as mesmas oito chaves em 5, 7, 11 e 12. `closing` é `{observacoes, fechadoEm, fechadoPor} | null` em 7, 8 e 12. `metaStatus` usa `'piso'|'teto'` em 6 e 7.

**Ponto de atenção conhecido:** a Task 1 mexe em `dashboardService`, que está em produção. O Step 6 dessa task existe justamente para provar que os números do painel não mudaram — não pule.
