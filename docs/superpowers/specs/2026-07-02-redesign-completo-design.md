# Redesign completo — Linguagem visual "Bold Branded Light"

**Data:** 2026-07-02
**Escopo:** Todas as telas do sistema (`index.html` + componentes `.jsx`), exceto o gerador de PDF (`gerador.html`/`app.jsx`, tratado à parte).
**Status:** Design aprovado (mockup showcase de todas as telas). Pronto para plano de implementação.
**Fundamentação:** ui-ux-pro-max — estilo base **"Data-Dense Dashboard"** (WCAG AA, light+dark full, performance excelente) + expressão de marca **bold branded** (green→teal, aurora, glass, bento). Preferência do projeto: sempre embasar design no plugin ui-ux-pro-max.

---

## 1. Contexto

O sistema "Método P4 · Sistema de Feedbacks" já está em produção (Vercel + Render + Neon). Toda a **linguagem visual vive centralizada** no bloco `<style>` do `index.html` (~540 linhas de CSS artesanal, sem framework), e as telas são componentes React (`.jsx`) carregados via Babel-no-browser. O visual atual (verde `#56D54F` + tinta escura, Sora + JetBrains Mono, cards claros sobre stage cinza) é funcional mas "genérico". O usuário pediu um redesign **realmente profissional**, com inspiração em 21st.dev.

Decisões do brainstorming:
- **Direção:** Bold branded moderno (verde protagonista, com personalidade).
- **Tema:** **Light-first refinado** (dark fica para uma fase futura; tokens já preparados).
- **Vitrine:** Login (momento de marca) — mas o mockup aprovado cobre **todas** as telas.

## 2. Objetivos

- Elevar o acabamento a nível "produto premium" mantendo o app **legível e denso** (telas de dados).
- **Verde como protagonista** via gradiente (green→teal), glow aurora, sombras tingidas de verde e vidro (glass) — sem cair em "ornate" (anti-pattern do estilo data-dense).
- **Sistema de tokens** (primitive→semantic) que garanta consistência entre telas e habilite o dark futuro.
- **Não re-arquitetar**: continuar no `index.html` (CSS central) + `.jsx`. Zero mudança de lógica/negócio.
- Manter/elevar **acessibilidade** (foco visível, contraste AA, reduced-motion, touch ≥44px) — já parcialmente feita no passe de 2026-07-02.

**Fora de escopo (YAGNI):** re-plataforma (Vite/Tailwind/shadcn); mudança de backend/API; tema escuro (fase futura); redesign do gerador de PDF (`gerador.html`); mudanças de fluxo/funcionalidade. É um redesign **visual**.

## 3. Design tokens (travados do mockup)

CSS custom properties no `:root` do `index.html`. Substituem os tokens atuais.

### 3.1 Marca (verde) e gradientes
| Token | Valor | Uso |
|---|---|---|
| `--brand` | `#22C55E` | fills, dots, dots de status |
| `--brand-strong` | `#16A34A` | hover, fim do gradiente |
| `--brand-ink` | `#15803D` | **texto** verde sobre claro (AA ~4.9:1) |
| `--brand-glow` | `#4ADE80` | glows/auroras |
| `--teal` | `#0EA5A0` | fim alternativo do gradiente |
| `--grad` | `linear-gradient(135deg,#34D399,#22C55E,#16A34A)` | CTAs, item ativo, KPI herói |
| `--grad-teal` | `linear-gradient(135deg,#34D399,#16A34A,#0EA5A0)` | variação (hero/login) |

### 3.2 Superfícies / tinta / linhas
| Token | Valor | Uso |
|---|---|---|
| `--stage` | `#F4F7F3` | canvas off-white quente (fundo do app) |
| `--surface` | `#FFFFFF` | cards/superfícies |
| `--surface-2` | `#F7FAF6` | superfície secundária (inputs, tiles) |
| `--glass` | `rgba(255,255,255,.72)` | topbar/switcher com `backdrop-filter:blur(16px)` |
| `--ink` | `#0E1A13` | texto principal |
| `--ink-2` | `#4E5D54` | texto secundário |
| `--muted` | `#8A978C` | texto muted / labels |
| `--line` | `#E7ECE6` | bordas |
| `--line-2` | `#EFF3EE` | divisórias internas de tabela |

### 3.3 Semânticos e dados
`--red #E5484D` / `--red-ink #C4353A` · `--amber #F59E0B` / `--amber-ink #B45309` · `--blue #3B82F6` · `--violet #7C5CFC`.
**Cores de marketplace preservadas** (ML `#FFE600`/ink `#8A7400`, Shopee `#EE4D2D`, Magalu `#0E89FF`, Amazon `#232F3E`, Tiktok `#FE2858`). Paleta do gráfico de métricas mantida (8 indicadores).

### 3.4 Raios, sombras, movimento, tipografia
- **Raios:** card `18px`, médio (botão/input) `12px`, pequeno `9px`, pill `999px`.
- **Sombras (tingidas de verde):**
  - `--sh-1` (resting): `0 1px 2px rgba(14,26,19,.05), 0 1px 3px rgba(14,26,19,.04)`
  - `--sh-2` (elevado/hover): `0 12px 34px -16px rgba(16,163,74,.28), 0 4px 12px -8px rgba(14,26,19,.10)`
  - `--sh-glow`: `0 18px 50px -20px rgba(34,197,94,.55)` (logo, botões de destaque, dropzone)
- **Motion:** 150–260ms, easing `cubic-bezier(.4,.14,.3,1)`; hover eleva `translateY(-2/-3px)`; respeitar `prefers-reduced-motion`.
- **Tipografia (mantida):** **Sora** (display/UI; headings 700–800, tracking apertado `-.02em`) + **JetBrains Mono** (números, labels/kickers, datas — `tabular-nums`). Base 16px; `--side-w:248px`.

## 4. Componentes-base

Reescrever/introduzir no CSS central. Cada um é um "átomo" reutilizado por todas as telas.

- **Botões:** `.btn-primary` (gradiente `--grad`, texto branco, sombra verde, hover eleva), `.btn-ghost` (branco + borda), `.icon-btn` (40×40, hover verde). Login usa `.btn-grad` (full-width).
- **Inputs / campos:** wrapper com borda 1.5px, `focus-within` = borda `--brand` + anel `rgba(34,197,94,.14)` + fundo branco; `.seg` (segmented control, ativo em gradiente); `select` estilizado; toggle switch.
- **Cards:** `.card` genérico; `.kpi` (bento, um `.kpi.hero` pintado com `--grad`); `.ccard` (cliente, filete de atraso, hover eleva com `--sh-2`).
- **Chips/pills:** `.chip` (filtro; ativo = ink), `.tag` (status ok/late/closed em tint suave), `.mk-chip` (marketplace mono).
- **Chrome:** `.sidebar` (branca, glow aurora no topo, item ativo em degradê verde + badge), `.topbar` **de vidro** (glass/blur, sticky), `.avatar` em gradiente, `.role-pill`.
- **Tabelas:** `.tbl`/`.tr` (grid, header em `--surface-2`, hover de linha, números mono `tabular-nums`).
- **Reputação (card):** `.rep` termômetro de 5 segmentos + medalha; estados muted (não conectado / sem ML / encerrado) — mesma lógica do redesign de Clientes (7 estados, ver spec de 2026-07-01).
- **Assinatura bold-branded:** `.aurora` (glow radial verde/teal, animado, reduced-motion off), gradiente em CTAs/hero KPI, sombras verdes, glass na topbar/switcher.

## 5. Aplicação por tela

Cada tela **reusa** os componentes acima; estrutura/lógica preservadas.

1. **Login** (`p4-login.jsx`) — split: painel de marca com **aurora glow** + grid sutil, logo em bloco de gradiente, headline com verde em gradiente, feature list em chips + **stats de prova** (128 clientes · 5 marketplaces · 98% no prazo); card branco à direita com inputs refinados e **"Entrar" em gradiente**. Mantém: erro `role=alert`, toggle de senha, "manter conectado", "solicitar convite".
2. **Clientes** (`p4-clients.jsx`) — chrome + header (eyebrow saudação, stats inline, ações), toolbar (busca + toggle "Para enviar hoje" + filtro analista), chips (status + marketplace com contagem), **grade de cards** com reputação. (Já redesenhada em 2026-07-01; recebe só o refino de tokens/sombras/gradiente.)
3. **Histórico** (`p4-history.jsx`) — header com breadcrumb + status; abas por marketplace; **KPIs bento** (um herói em gradiente: ROAS); painel de reputação (tiles); **MetricsExplorer** (gráfico SVG interativo — área em **gradiente verde**, mantém interação/tooltip/comparação); tabela de relatórios.
4. **Novo/Editar cliente** (`p4-new-client.jsx`) — form-card em seções (01 Identificação, 02 Marketplaces, 03 Envio), segmented controls em gradiente, chips de dia, preview pill, rodapé sticky com "Salvar" em gradiente.
5. **Painel CS** (`p4-cs-dashboard.jsx`) — KPIs mini em grid; tabela "Métricas por analista"; cards de gráfico (barras verticais em **gradiente**, barras horizontais com fração de atraso); tabela "Relatórios em atraso".
6. **Configurações** (`p4-settings.jsx`) — `set-grid` de cards (Conta, Aparência com swatches + toggle de tema, Integrações com status ML, Sobre). Ícones em tile verde.
7. **Importação** (`p4-import.jsx`) — dropzone com ícone em gradiente/glow, prévia em tabela com badge "colunas reconhecidas", CTA "Importar N clientes".

## 6. Ícones

**Usar SVG do conjunto existente** (`p4-icons.jsx`) — nunca emojis. O mockup usa alguns caracteres (✎ ↑ ⬇ ⚡ ✕ ✓) só como placeholder de velocidade; na implementação todos viram ícones SVG do `Icons` (checklist ui-ux-pro-max: "no emojis as icons"). Stroke consistente (~2px), tamanhos por token.

## 7. Acessibilidade (manter/estender o passe de 2026-07-02)

- **Foco visível** global (`:focus-visible` com anel `--brand` + offset) em botões/links/selects/cards; card clicável com `role="button"`/`tabIndex`/Enter-Espaço.
- **Contraste AA:** texto verde usa `--brand-ink`; verificar pares fg/bg ≥4.5:1 (validar com ferramenta antes de publicar).
- **Toque ≥44px** em mobile; inputs 16px em ≤720px (evita zoom iOS).
- **`prefers-reduced-motion`**: desliga aurora/animações contínuas; sem CLS.
- **Labels/aria** em busca, selects e inputs; toasts `aria-live`.

## 8. Arquitetura / arquivos afetados

- `design_handoff_sistema_feedbacks/index.html` (`<style>`) — **reescrever o sistema de tokens e os componentes-base**; é o coração do redesign. CSS de impressão do PDF (painel CS) preservado.
- `p4-login.jsx`, `p4-clients.jsx`, `p4-history.jsx`, `p4-new-client.jsx`, `p4-cs-dashboard.jsx`, `p4-settings.jsx`, `p4-import.jsx` — ajustes **estruturais mínimos** (novas classes/wrappers: aurora, glass topbar, KPI herói, seções), sem tocar em lógica/estado/handlers. Estilos inline hoje presentes (History/CS usam muito `style={{…}}`) podem migrar para classes para consistência, quando barato.
- `p4-shell.jsx` — chrome compartilhado (TopBar/Sidebar) recebe o visual novo.
- `p4-icons.jsx` — pode ganhar 1–2 ícones novos se necessário.
- **Sem** mudança em `p4-api.js`, `p4-data.jsx` (lógica), `config.js`.

## 9. Rollout faseado (para o plano)

Um design language, aplicado em fases verificáveis (deploy é automático no `git push` da main — validar visual a cada fase):

- **Fase 0 — Fundação:** tokens + componentes-base no `index.html` + chrome (sidebar/topbar de vidro). Telas existentes já herdam a maior parte.
- **Fase 1 — Login** (vitrine): aurora, gradiente, card.
- **Fase 2 — Clientes:** refino sobre o redesign existente (tokens/sombras/gradiente, KPI herói onde couber).
- **Fase 3 — Histórico:** KPIs bento + herói, gráfico com gradiente, reputação, tabela.
- **Fase 4 — Painel CS:** KPIs, tabela por analista, gráficos em gradiente, atrasados.
- **Fase 5 — Novo cliente + Importação + Configurações.**
- **Fase 6 — Polish & a11y:** varredura de contraste AA, foco, reduced-motion, responsivo (375/768/1024/1440), remoção de CSS órfão.

## 10. Dark mode (futuro, fora deste escopo)

Tokens estruturados em semânticos (`--surface`, `--ink`, `--line`, etc.) para permitir um tema escuro por inversão tonal numa fase futura (o verde rende ainda mais no escuro). Não implementar agora; só **não** hardcodar hex fora dos tokens, para o dark ser barato depois.

## 11. Riscos / considerações

- **Regressão visual entre telas:** por ser CSS central, um token errado afeta tudo — validar tela a tela a cada fase.
- **Estilos inline em History/CS:** muita cor/tamanho hardcoded em `style={{}}`; migrar gradualmente para tokens/classes, sem quebrar a impressão (PDF do painel CS).
- **Performance do glass/aurora:** `backdrop-filter` e blurs custam; usar com parcimônia (topbar, switcher, hero), respeitar reduced-motion.
- **Deploy automático:** `git push` na main publica; commitar por fase e validar em produção (Render tem cold start).
- **Contraste do gradiente:** texto branco sobre `--grad` precisa ≥4.5:1 — o fim `#16A34A` garante; validar o hero KPI.

## 12. Critérios de aceite

- [ ] `index.html` tem um sistema de tokens (marca/superfície/semântico/raio/sombra/motion) e nenhuma tela hardcoda hex fora deles (salvo cores de marketplace/gráfico).
- [ ] Todas as 7 telas usam os componentes-base novos (chrome de vidro, botões em gradiente, cards com sombra verde, chips/tags, tabelas).
- [ ] Login tem aurora glow + gradiente; ao menos 1 KPI herói (gradiente) em Histórico/CS.
- [ ] Ícones são SVG (nenhum emoji estrutural).
- [ ] A11y: foco visível, contraste AA verificado, reduced-motion, touch ≥44px, inputs 16px no mobile.
- [ ] Responsivo em 375/768/1024/1440 sem overflow horizontal; sidebar em trilho <1000px, some <760px.
- [ ] Lógica/negócio inalterados; PDF do painel CS ainda imprime corretamente.
- [ ] Tokens preparados para dark futuro (sem hex órfão).

---

*Mockup de referência (todas as telas): `design_handoff_sistema_feedbacks/_mockup-redesign.html` (cópia durável do showcase aprovado no visual companion). Telas: Login · Clientes · Histórico · Novo cliente · Painel CS · Configurações · Importação.*
