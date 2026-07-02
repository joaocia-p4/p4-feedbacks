# Redesign completo (Bold Branded Light) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar a nova linguagem visual "bold branded light-first" a todas as telas do sistema (login, clientes, histórico, novo cliente, painel CS, configurações, importação), sem mudar lógica/negócio.

**Architecture:** Toda a linguagem vive no `<style>` central do `index.html`; as telas são componentes React (`.jsx`) carregados via Babel-no-browser. O redesign **reescreve os tokens (valores, preservando nomes) e os estilos dos componentes-base** no `index.html`, de modo que todas as telas re-estilizam por herança; depois, cada tela recebe os toques de assinatura (aurora, glass, KPI herói, CTAs em gradiente) com ajustes **estruturais mínimos** no `.jsx`.

**Tech Stack:** HTML + CSS artesanal (custom properties), React 18 UMD, Babel standalone, SheetJS. Sem build, sem framework de teste.

**Fonte da verdade visual:** `design_handoff_sistema_feedbacks/_mockup-redesign.html` (mockup aprovado com todas as telas; switcher no topo). Sempre comparar a tela real contra a seção correspondente do mockup.

**Spec:** `docs/superpowers/specs/2026-07-02-redesign-completo-design.md`.

## Global Constraints

- **Não re-plataformar.** Continuar em `index.html` (CSS central) + `.jsx`. Zero mudança de lógica/estado/handlers/props.
- **Tokens — preservar NOMES, mudar valores.** Estilos inline em `p4-history.jsx` e `p4-cs-dashboard.jsx` usam `var(--paper)`, `var(--line)`, `var(--muted)`, `var(--ink)`, `var(--stage)`, `var(--red)`, `var(--accent)`, `var(--accent-rgb)`, `var(--green-ink)`. Esses nomes **não podem sumir**. Adicionar novos tokens (`--grad`, `--brand-ink`, `--surface-2`, `--glass`, `--sh-1/2/glow`, `--r-*`, `--teal`, `--ink-2`, `--line-2`, `--red-ink`).
- **Sem hex órfão.** Nenhuma tela hardcoda hex fora dos tokens, exceto cores de **marketplace** (ML `#FFE600`/`#8A7400`, Shopee `#EE4D2D`, Magalu `#0E89FF`, Amazon `#232F3E`, Tiktok `#FE2858`) e a **paleta do gráfico** de métricas (8 indicadores em `p4-history.jsx`).
- **Ícones = SVG** do `p4-icons.jsx` (`window.Icons`). Nunca emoji como ícone.
- **Acessibilidade (manter/estender):** `:focus-visible` global (anel `--accent` + offset); card clicável com `role="button"`/`tabIndex`/Enter-Espaço; contraste AA (texto verde usa `--green-ink`/`--brand-ink`); `@media (prefers-reduced-motion:reduce)` desliga aurora/animações; touch ≥44px e inputs 16px em ≤720px.
- **Verificação (sem test runner):** para cada tarefa — (a) se tocou `.jsx`, rodar esbuild parse (comando abaixo) e exigir `PARSE_OK`; (b) abrir `index.html` no navegador (modo protótipo usa dados mock de `p4-data.jsx`; login aceita qualquer senha offline) e **conferir a tela contra a seção do mockup**; (c) checar foco por teclado (Tab), contraste do texto e `prefers-reduced-motion`. Commit ao fim de cada tarefa.
- **Deploy:** `git push` na `main` publica (Vercel/Render). **Commitar por tarefa; NÃO fazer `git push` sem OK explícito do usuário.**

**Comando de parse (.jsx):**
```bash
cd "Sistema de Feedbacks/design_handoff_sistema_feedbacks" && npx --yes esbuild@0.23.0 <arquivo>.jsx --loader:.jsx=jsx --outfile=/dev/null 2>&1 && echo PARSE_OK || echo PARSE_FAIL
```

**Comando pra abrir o app (Windows):**
```powershell
Start-Process "C:\Users\joaop\OneDrive\Desktop\Sistema de relatorios de ADS\Sistema de Feedbacks\design_handoff_sistema_feedbacks\index.html"
```

---

## Task 0: Consolidar a base de acessibilidade (working tree)

O working tree já tem o passe de a11y de 2026-07-02 (aprovado) em `index.html` + `p4-clients.jsx`. Commitar como base limpa antes de reescrever o CSS, para preservá-lo no histórico.

**Files:**
- Modify (já alterados, sem commit): `design_handoff_sistema_feedbacks/index.html`, `design_handoff_sistema_feedbacks/p4-clients.jsx`

- [ ] **Step 1: Conferir o diff pendente**

```bash
cd "Sistema de Feedbacks/design_handoff_sistema_feedbacks" && git status --short && git diff --stat
```
Expected: `M index.html`, `M p4-clients.jsx` (as mudanças de foco/touch/aria/reduced-motion/green-ink).

- [ ] **Step 2: Parse do jsx alterado**

Run: `npx --yes esbuild@0.23.0 p4-clients.jsx --loader:.jsx=jsx --outfile=/dev/null 2>&1 && echo PARSE_OK`
Expected: `PARSE_OK`

- [ ] **Step 3: Commit**

```bash
git add index.html p4-clients.jsx && git commit -m "a11y(clientes): foco visivel, touch 44px, aria-labels, reduced-motion, green-ink AA

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: Sistema de tokens (`:root`)

Substituir o bloco `:root` do `index.html`, preservando todos os nomes usados hoje e adicionando os novos. Este é o núcleo — depois dele, todas as telas já mudam de cor/tom.

**Files:**
- Modify: `design_handoff_sistema_feedbacks/index.html` (bloco `:root{…}`, ~linhas 13-31)

**Interfaces:**
- Produces (tokens que as demais tarefas e os estilos inline consomem): `--accent`, `--accent-rgb`, `--green`, `--green-ink`, `--ink`, `--muted`, `--paper`, `--line`, `--stage`, `--red`, `--amber`, `--panel`, `--panel-2`, `--panel-line`, `--panel-txt`, `--panel-mut`, `--side-w` (nomes MANTIDOS) + novos: `--brand`, `--brand-strong`, `--brand-ink`, `--brand-glow`, `--teal`, `--grad`, `--grad-teal`, `--surface`, `--surface-2`, `--glass`, `--ink-2`, `--line-2`, `--red-ink`, `--amber-ink`, `--blue`, `--violet`, `--r-card`, `--r-md`, `--r-sm`, `--r-pill`, `--sh-1`, `--sh-2`, `--sh-glow`, `--ease`.

- [ ] **Step 1: Substituir o `:root`**

```css
:root{
  /* MARCA — verde vibrante protagonista + tinta legível p/ texto (AA) */
  --green:#22C55E; --accent:#22C55E; --accent-rgb:34,197,94;
  --brand:#22C55E; --brand-strong:#16A34A; --brand-glow:#4ADE80; --teal:#0EA5A0;
  --brand-ink:#15803D; --green-ink:#15803D;               /* texto verde AA (~4.9:1) */
  --grad:linear-gradient(135deg,#34D399 0%,#22C55E 45%,#16A34A 100%);
  --grad-teal:linear-gradient(135deg,#34D399 0%,#16A34A 55%,#0EA5A0 100%);
  /* SUPERFÍCIES — light-first, off-white quente com leve tom verde */
  --stage:#F4F7F3; --paper:#FFFFFF; --surface:#FFFFFF; --surface-2:#F7FAF6;
  --glass:rgba(255,255,255,.72);
  /* TINTA / LINHAS */
  --ink:#0E1A13; --ink-2:#4E5D54; --muted:#8A978C; --line:#E7ECE6; --line-2:#EFF3EE;
  /* SEMÂNTICOS */
  --red:#E5484D; --red-ink:#C4353A; --amber:#F59E0B; --amber-ink:#B45309; --blue:#3B82F6; --violet:#7C5CFC;
  /* CHROME ESCURO (login aside / brilhos) */
  --panel:#0E1A13; --panel-2:#16241B; --panel-line:#24352B; --panel-txt:#E8F0EA; --panel-mut:#8FA396;
  /* RAIOS / SOMBRAS / MOTION */
  --r-card:18px; --r-md:12px; --r-sm:9px; --r-pill:999px;
  --sh-1:0 1px 2px rgba(14,26,19,.05),0 1px 3px rgba(14,26,19,.04);
  --sh-2:0 12px 34px -16px rgba(16,163,74,.28),0 4px 12px -8px rgba(14,26,19,.10);
  --sh-glow:0 18px 50px -20px rgba(34,197,94,.55);
  --side-w:248px; --ease:cubic-bezier(.4,.14,.3,1);
  /* MARKETPLACES (mantidos) */
  --ml:#FFE600; --ml-ink:#8A7400; --shopee:#EE4D2D; --magalu:#0E89FF; --amazon:#232F3E; --tiktok:#FE2858;
}
```

- [ ] **Step 2: Verificar visual global**

Abrir `index.html` no navegador; navegar login → clientes. Expected: o app inteiro adota o off-white/verde novo sem tela quebrada (cores podem estar "cruas" até as próximas tarefas, mas nada ilegível/sem fundo). Conferir que histórico/CS (estilos inline) continuam com fundo branco e texto legível — prova de que os nomes de token foram preservados.

- [ ] **Step 3: Commit**

```bash
git add index.html && git commit -m "redesign(fase0): sistema de tokens bold-branded light

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Componentes-base — botões, inputs, chips, cards, tabelas

Restilizar os átomos no `index.html`, portando do mockup (`_mockup-redesign.html`, blocos "botões", "toolbar + chips", "tabela genérica", ".card"). Preservar os seletores existentes (`.btn-accent`, `.btn-line`, `.chip`, `.ccard`, `.status-tag`, `.kpi`, `.rrow`, etc.) e adicionar os novos (`.btn-primary`, `.btn-ghost`, `.icon-btn`, `.tag`, `.card`, `.tbl`/`.tr`).

**Files:**
- Modify: `design_handoff_sistema_feedbacks/index.html` (regras de botões, inputs, chips, cards, tabela)

**Interfaces:**
- Consumes: tokens da Task 1.
- Produces (classes usadas pelos jsx): `.btn-accent` (agora gradiente), `.btn-line`/`.btn-ghost`, `.icon-btn`, `.chip`(+`.on`), `.status-tag`(`.ok/.late/.closed`), `.ccard`, `.kpi`(+`.hero`), `.search`, `.due-toggle`, `.filter-select`.

- [ ] **Step 1: Botões**

Portar do mockup (seção "botões"), mapeando `.btn-accent`→gradiente:
```css
.btn-accent,.btn-primary{appearance:none;cursor:pointer;border:0;display:inline-flex;align-items:center;gap:8px;font-family:'Sora';font-weight:700;font-size:13px;padding:11px 16px;border-radius:var(--r-md);text-decoration:none;
  background:var(--grad);color:#fff;box-shadow:0 10px 22px -12px rgba(16,163,74,.8);transition:.15s var(--ease)}
.btn-accent:hover,.btn-primary:hover{filter:brightness(1.05);transform:translateY(-1px)}
.btn-line,.btn-ghost{appearance:none;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-weight:600;font-size:13px;padding:10px 15px;border-radius:var(--r-md);display:inline-flex;align-items:center;gap:8px;transition:.15s var(--ease);text-decoration:none}
.btn-line:hover,.btn-ghost:hover{border-color:#cfd8cf;background:var(--surface-2)}
.btn-line.danger-line{color:var(--red-ink)}
.btn-dark{background:var(--ink);color:#fff;border:0;cursor:pointer;font-weight:600;font-size:13px;padding:11px 16px;border-radius:var(--r-md);display:inline-flex;align-items:center;gap:8px}
.km-btn,.icon-btn{width:40px;height:40px;border-radius:var(--r-md);border:1px solid var(--line);background:var(--surface);color:var(--muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:.14s var(--ease);flex:none}
.km-btn:hover,.km-btn.on,.icon-btn:hover{border-color:var(--brand);color:var(--brand-ink);background:rgba(34,197,94,.06)}
```

- [ ] **Step 2: Inputs, chips, status-tags, cards, tabela**

Portar do mockup as regras de `.search`/`.due-toggle`/`.filter-select` (foco com anel `rgba(34,197,94,.14)`), `.chip`(+`.on` em `--ink`), `.status-tag`/`.tag` (tints `.ok/.late/.closed`), `.ccard` (sombra `--sh-1`, hover `--sh-2` + `translateY(-3px)`, filete `.late`), `.card`, `.tbl`/`.tr`. Manter os nomes de classe já usados pelos jsx (`.status-tag`, `.rrow`/`.rtable` do histórico continuam existindo — restilizar, não remover).

- [ ] **Step 3: Verificar**

Abrir `index.html` → clientes: cards com sombra verde suave, hover elevando; chips e botão "Adicionar cliente" em gradiente. Tab pelos botões mostra anel de foco. Comparar com a seção "Clientes" do mockup.

- [ ] **Step 4: Commit**

```bash
git add index.html && git commit -m "redesign(fase0): atomos (botoes gradiente, inputs, chips, cards, tabela)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Chrome — sidebar (aurora) + topbar de vidro

Restilizar `.app-side`/`.as-*` (sidebar) e `.topbar`/`.tb-*` no `index.html`, portando do mockup (blocos "APP CHROME" e "sidebar"). Adicionar helper `.aurora` e o brilho da sidebar.

**Files:**
- Modify: `design_handoff_sistema_feedbacks/index.html`

**Interfaces:**
- Consumes: tokens da Task 1.
- Produces: `.app-side`, `.as-item`(+`.on`), `.topbar` (glass), `.avatar`, `.role-pill`, `.aurora`.

- [ ] **Step 1: Adicionar `.aurora` e brilho da sidebar**

```css
.aurora{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.aurora::before,.aurora::after{content:"";position:absolute;border-radius:50%;filter:blur(60px);opacity:.85}
.aurora::before{width:520px;height:520px;left:-120px;top:-140px;background:radial-gradient(circle,rgba(52,211,153,.45),transparent 66%);animation:auroraFloat 12s var(--ease) infinite alternate}
.aurora::after{width:500px;height:500px;right:-140px;bottom:-160px;background:radial-gradient(circle,rgba(14,165,160,.34),transparent 66%);animation:auroraFloat 14s var(--ease) infinite alternate-reverse}
@keyframes auroraFloat{to{transform:translate(40px,30px) scale(1.12)}}
```

- [ ] **Step 2: Sidebar + topbar de vidro**

Portar do mockup: `.app-side` (branca, borda, `.sb-glow` no topo), `.as-item.on` em `linear-gradient(100deg,rgba(34,197,94,.14),rgba(14,165,160,.08))` com texto `--brand-ink`; `.topbar` com `background:var(--glass);backdrop-filter:blur(16px)` e `position:sticky;top:0`; `.avatar` em `--grad`. Preservar as classes já usadas por `p4-shell.jsx` (TopBar/Sidebar) — restilizar sem renomear.

- [ ] **Step 3: Verificar**

Abrir `index.html`: sidebar com brilho verde no topo e item ativo em degradê; topbar translúcida com blur ao rolar a lista de clientes. Conferir contraste do texto da sidebar.

- [ ] **Step 4: Commit**

```bash
git add index.html && git commit -m "redesign(fase0): chrome (sidebar aurora + topbar de vidro)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Login (Fase 1 — vitrine)

Reescrever o CSS do login e ajustar `p4-login.jsx` para o painel aurora + card com botão em gradiente, portando da seção "1 · LOGIN" do mockup.

**Files:**
- Modify: `design_handoff_sistema_feedbacks/index.html` (bloco `LOGIN`)
- Modify: `design_handoff_sistema_feedbacks/p4-login.jsx` (estrutura do aside: adicionar `.la-blob`/grid, stats de prova; classe do botão)

**Interfaces:**
- Consumes: tokens; ícones `window.Icons`.
- Produces: nada consumido por outras tarefas (tela folha).

- [ ] **Step 1: CSS do login**

Portar do mockup: `.login`/`.login-aside` (fundo em radial-gradients verdes + `.la-grid` + `.la-blob`), `.la-logo` (bloco gradiente), `.la-head em` (texto em gradiente), `.la-feats`/`.la-fi`, `.la-stats`, `.login-card` (branco, radius 22), `.field .in` (foco verde), `.btn-grad`. Manter os nomes já usados por `p4-login.jsx` (`.field`, `.field-in`→ ajustar p/ `.in` OU manter `.field-in` e restilizar — **preferir manter `.field-in`** e só trocar valores, evitando editar o jsx além do necessário).

- [ ] **Step 2: Ajustes no `p4-login.jsx`**

Mudanças **estruturais mínimas**, sem tocar em `submit`/estados:
- No `.login-aside`, adicionar `<div className="la-grid"></div><div className="la-blob"></div>` (decorativos) e um bloco de stats de prova (`128 clientes · 5 marketplaces · 98% no prazo`) após a `.la-feats`.
- Trocar a classe do botão "Entrar" para o estilo gradiente (`btn-primary`/`btn-grad`), mantendo `disabled={busy}` e o texto `busy ? 'Entrando…' : 'Entrar'`.
- Trocar o `⚠` do erro por ícone SVG (`I.alert` se existir; senão manter, mas o erro deve ter `role="alert"`).

- [ ] **Step 3: Parse**

Run: `npx --yes esbuild@0.23.0 p4-login.jsx --loader:.jsx=jsx --outfile=/dev/null 2>&1 && echo PARSE_OK`
Expected: `PARSE_OK`

- [ ] **Step 4: Verificar**

Abrir `index.html` (tela inicial = login): aside com glow aurora + headline em gradiente + stats; card branco com botão "Entrar" em gradiente; foco nos inputs com anel verde. Comparar com a seção Login do mockup. Testar `prefers-reduced-motion` (aurora para).

- [ ] **Step 5: Commit**

```bash
git add index.html p4-login.jsx && git commit -m "redesign(fase1): login com aurora glow e CTA em gradiente

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Clientes (Fase 2 — refino)

A tela já foi redesenhada (2026-07-01) e herda os átomos das Tasks 1-3. Aqui é só o refino de assinatura: `.add-card` com "+" em gradiente e conferência geral.

**Files:**
- Modify: `design_handoff_sistema_feedbacks/index.html` (`.add-card .plus`, `.rep` se necessário)

- [ ] **Step 1: Refino do `.add-card`**

```css
.add-card{border:1.5px dashed #c5d0c5;background:transparent;border-radius:var(--r-card);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:11px;min-height:230px;color:var(--muted);font-weight:600;font-size:13.5px;transition:.16s var(--ease)}
.add-card:hover{border-color:var(--brand);color:var(--brand-ink);background:rgba(34,197,94,.05)}
.add-card .plus{width:46px;height:46px;border-radius:14px;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:var(--sh-glow)}
```

- [ ] **Step 2: Verificar**

Abrir clientes: grid com cards elevando (sombra verde), reputação com termômetro, card "Adicionar" com "+" em gradiente. Tab navega os cards (foco). Comparar com o mockup.

- [ ] **Step 3: Commit**

```bash
git add index.html && git commit -m "redesign(fase2): refino da tela de clientes (add-card gradiente)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Histórico — KPIs bento + herói + gráfico em gradiente (Fase 3)

Restilizar `.kpis`/`.kpi` (bento, um herói), o gráfico (área em gradiente verde), o painel de reputação e a tabela. Ajuste estrutural mínimo no `p4-history.jsx` para marcar o KPI "ROAS" como herói.

**Files:**
- Modify: `design_handoff_sistema_feedbacks/index.html` (`.kpis`, `.kpi`, `.kpi.hero`, `.mx-*`, `.rtable`/`.rrow`, `.mk-tabs`)
- Modify: `design_handoff_sistema_feedbacks/p4-history.jsx` (classe `kpi hero` no card de ROAS; `id`/gradiente na área do SVG do `MetricsExplorer`)

**Interfaces:**
- Consumes: tokens; a paleta de 8 métricas (`MX_METRICS`) é preservada.

- [ ] **Step 1: CSS de KPIs/gráfico/tabela**

Portar do mockup (seção "KPIs / bento", "chart", "reputação painel", "mk tabs"): `.kpi` (sombra `--sh-1`, hover `--sh-2`), `.kpi.hero{background:var(--grad);color:#fff}` (e `.hero .k/.v/.foot`), `.mx`/`.mx-cards`/`.mx-card`, `.repp`/`.repp-tiles`, `.rtable`/`.rrow` (restilizar as já existentes), `.mk-tabs`/`.mk-tab`.

- [ ] **Step 2: `p4-history.jsx` — KPI herói + gradiente no gráfico**

- No bloco `.kpis`, trocar a classe do card **"ROAS atual"** de `className="kpi"` para `className="kpi hero"` (só esse card).
- No SVG do `MetricsExplorer`, adicionar um `<linearGradient id="mxArea">` (verde .18→0) e usar `fill="url(#mxArea)"` no path de área (`singleLine`), no lugar do `fill={m.color} opacity="0.09"` — só quando `m.color` for o verde/faturamento. (Mudança visual isolada; não altera escalas/interação.)

- [ ] **Step 3: Parse**

Run: `npx --yes esbuild@0.23.0 p4-history.jsx --loader:.jsx=jsx --outfile=/dev/null 2>&1 && echo PARSE_OK`
Expected: `PARSE_OK`

- [ ] **Step 4: Verificar**

Abrir histórico (via clientes → um card): KPIs em bento com o card ROAS em gradiente; gráfico com área verde em gradiente e interação preservada (hover/tooltip/comparar); reputação em tiles; tabela limpa. Contraste do texto branco no KPI herói ≥4.5:1.

- [ ] **Step 5: Commit**

```bash
git add index.html p4-history.jsx && git commit -m "redesign(fase3): historico (KPIs bento/heroi, grafico gradiente, reputacao)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Painel CS (Fase 4)

Restilizar KPIs mini, tabela por analista, cards de gráfico (barras em gradiente) e tabela de atrasados. O `p4-cs-dashboard.jsx` usa muito estilo inline; migrar as barras para `--grad` e os cards para as classes novas, sem quebrar a **impressão (PDF)**.

**Files:**
- Modify: `design_handoff_sistema_feedbacks/index.html` (classes `.kpi-mini`, `.dash-card`, `.hbar`, etc. — adicionar)
- Modify: `design_handoff_sistema_feedbacks/p4-cs-dashboard.jsx` (VBars/HBars usam `--grad`; `DashCard`/`Kpi` podem migrar `style={{}}`→classe)

- [ ] **Step 1: CSS dos cards/gráficos do CS**

Portar do mockup (seção "charts CS"): `.kpi-mini`, `.dash-grid`, `.hbar`/`.hbar>span{background:var(--grad)}`. Adicionar sem remover o CSS de impressão (`@media print` e `.dash-print-head`/`.dash-no-break` **permanecem intactos**).

- [ ] **Step 2: `p4-cs-dashboard.jsx` — barras em gradiente**

- Em `VBars`, trocar `background: it.value ? color : ...` para usar `var(--grad)` quando `color` for o verde (`#56D54F`→`var(--grad)`); manter a lógica de altura.
- Em `HBars`, a barra principal usa `var(--grad)`; a fração `danger` mantém `var(--red)`.
- `Kpi`/`DashCard`: opcionalmente trocar o `style={{background:'var(--paper)'…}}` por `className="kpi-mini"`/`className="card"` (equivalente). **Não** alterar dados/props.

- [ ] **Step 3: Parse**

Run: `npx --yes esbuild@0.23.0 p4-cs-dashboard.jsx --loader:.jsx=jsx --outfile=/dev/null 2>&1 && echo PARSE_OK`
Expected: `PARSE_OK`

- [ ] **Step 4: Verificar**

Abrir painel CS: KPIs, tabela por analista, barras verticais/horizontais em gradiente, atrasados. **Testar impressão** (Ctrl+P) e conferir que o PDF ainda sai correto (cabeçalho de impressão, sem sidebar/topbar).

- [ ] **Step 5: Commit**

```bash
git add index.html p4-cs-dashboard.jsx && git commit -m "redesign(fase4): painel CS (KPIs, tabela por analista, barras gradiente)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Novo cliente + Importação + Configurações (Fase 5)

Restilizar os três (formulário, dropzone, cards de settings), portando das seções "FORM", "IMPORT" e "SETTINGS" do mockup. Ajustes estruturais mínimos (segmented em gradiente, dropzone com ícone em gradiente).

**Files:**
- Modify: `design_handoff_sistema_feedbacks/index.html` (`.form-*`, `.seg`, `.mk-card`, `.wd-chip`, `.dropzone`, `.set-*`)
- Modify (se necessário, mínimo): `design_handoff_sistema_feedbacks/p4-new-client.jsx`, `p4-import.jsx`, `p4-settings.jsx`

- [ ] **Step 1: CSS dos três**

Portar do mockup: `.form-card`/`.form-sec`/`.form-sec-h .idx`, `.seg button.on{background:var(--grad)}`, `.lf-in` (foco verde), `.wd-chip.on`, `.preview-pill`; `.dropzone`/`.dz-ic` (ícone em `--grad`+`--sh-glow`); `.set-grid`/`.set-card`/`.set-ic` (tile verde)/`.toggle`/`.sw` (swatches). Preservar os nomes usados hoje (`.form-grid`, `.lfield`, `.seg`, `.wd-chip`, `.set-card`, etc.).

- [ ] **Step 2: Ajustes jsx (se preciso)**

Só se o estilo exigir marcação nova (ex.: garantir que o ícone da dropzone seja SVG do `Icons`, não emoji). Não mexer em handlers/estado (SheetJS, validações, salvar).

- [ ] **Step 3: Parse (dos jsx tocados)**

Run p/ cada um alterado: `npx --yes esbuild@0.23.0 <arquivo>.jsx --loader:.jsx=jsx --outfile=/dev/null 2>&1 && echo PARSE_OK`
Expected: `PARSE_OK`

- [ ] **Step 4: Verificar**

Abrir novo cliente (segmented em gradiente, preview pill), importação (dropzone com ícone gradiente + prévia), configurações (cards com tile verde, swatches, toggle). Comparar com o mockup.

- [ ] **Step 5: Commit**

```bash
git add index.html p4-new-client.jsx p4-import.jsx p4-settings.jsx && git commit -m "redesign(fase5): novo cliente, importacao e configuracoes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Polish & acessibilidade (Fase 6)

Varredura final de a11y, responsivo e limpeza de CSS órfão.

**Files:**
- Modify: `design_handoff_sistema_feedbacks/index.html`

- [ ] **Step 1: A11y sweep**

Confirmar no CSS final: `:focus-visible` global presente; `@media (prefers-reduced-motion:reduce)` cobre aurora + shimmer + km-menu + toast + hover-lift; media `≤720px` com touch ≥44px e inputs 16px. Ajustar o que faltar.

- [ ] **Step 2: Contraste AA**

Verificar pares de texto contra fundo com uma ferramenta (ex.: rodar um checador ou conferir manualmente): texto branco no `.kpi.hero` sobre `--grad` (fim `#16A34A`) ≥4.5:1; `--muted #8A978C` sobre branco ≥4.5:1 (ajustar p/ mais escuro se reprovar); `--brand-ink` em textos pequenos. Corrigir tokens se algum reprovar.

- [ ] **Step 3: Responsivo**

Abrir `index.html`, DevTools responsivo em 375/768/1024/1440 em cada tela: sem overflow horizontal; sidebar em trilho <1000px e some <760px; grids colapsam. Ajustar media queries.

- [ ] **Step 4: Remover CSS órfão**

Procurar classes não mais usadas após o redesign (ex.: restos de estilos antigos substituídos) e remover. Rodar grep das classes suspeitas nos `.jsx` antes de remover.

- [ ] **Step 5: Commit**

```bash
git add index.html && git commit -m "redesign(fase6): polish, a11y (contraste/foco/reduced-motion) e responsivo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Validação final e handoff de deploy

**Files:** nenhum (verificação).

- [ ] **Step 1: Passar por todas as telas**

Abrir `index.html` e navegar login → clientes → histórico → novo cliente → CS → config → import. Cada uma bate com a seção correspondente do mockup; sem tela quebrada; foco/contraste/reduced-motion ok; impressão do CS ok.

- [ ] **Step 2: Conferir critérios de aceite do spec**

Percorrer a checklist da §12 do spec e marcar cada item.

- [ ] **Step 3: Handoff de deploy (NÃO pushar sem OK)**

Mostrar `git log --oneline` das fases e perguntar ao usuário se pode `git push origin main` (dispara deploy em produção). Só pushar após confirmação.

---

## Self-Review (cobertura do spec)

- Tokens (spec §3) → Task 1. ✓
- Componentes-base (§4) → Tasks 2-3. ✓
- Aplicação por tela (§5): login→T4, clientes→T5, histórico→T6, CS→T7, novo/import/config→T8. ✓
- Ícones SVG (§6) → constraint global + T4/T8. ✓
- A11y (§7) → constraint global + T0 + T9. ✓
- Arquivos afetados (§8) → distribuídos nas tasks. ✓
- Rollout faseado (§9) → Tasks agrupadas por fase. ✓
- Dark futuro (§10) → fora de escopo (tokens semânticos já preparados na T1). ✓
- Critérios de aceite (§12) → Task 10. ✓
