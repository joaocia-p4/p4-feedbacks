# Redesign — Tela de Clientes (home pós-login)

**Data:** 2026-07-01
**Tela:** `p4-clients.jsx` (+ CSS em `index.html`) — a landing principal após o login.
**Status:** Design aprovado (mockup v2). Pronto para plano de implementação.

---

## 1. Contexto

A Tela de Clientes é o que o usuário vê ao entrar no sistema (analista vê os seus; admin/CS veem todos). Hoje ela tem: header com saudação, **4 cards de KPI grandes** (Clientes/Em dia/Atrasados/Para enviar), uma **barra "Para enviar"** (`.duebar`), uma **toolbar** de filtros e uma **grade de cards** — com um layout alternativo em **lista/tabela** (tweak `layout: grade|lista`).

Motivação do redesign (do próprio usuário): **muita coisa empilhada** (poluído), **falta informação de saúde do cliente de relance**, visual a modernizar e melhor comportamento **responsivo**.

## 2. Objetivos

- **Simplificar**: reduzir para **3 regiões** (header → filtros → grade). A grade de cards é a estrela.
- **Reputação no card**: cada card mostra a **reputação do seller no Mercado Livre** (termômetro de cor + medalha MercadoLíder) como principal sinal de saúde. **Sem** ROAS/Faturamento no card.
- **Enxugar controles**: KPIs viram stats inline no header; "Para enviar" vira um **toggle** com contador; "visão por marketplace" vira **contadores nos chips** de filtro.
- **Só grade**: remover o layout alternativo de lista/tabela.
- **Responsivo**: tudo empilha bem (desktop → tablet → celular).

## 3. Decisões (o que muda vs. hoje)

| Área | Hoje | Depois |
|---|---|---|
| KPIs | 4 cards grandes (`.kpis`) | Stats inline no subtítulo do header (`N ativos · N atrasados · N para enviar`) |
| "Para enviar" | Barra dedicada (`.duebar`) com data/hoje/badges | Um **toggle** "Para enviar hoje" na toolbar (com contador); ao ativar, filtra a grade (atrasados primeiro) |
| Visão por marketplace | — | **Contagem nos chips** de marketplace (ex.: `ML 4`, `Shopee 3`) |
| Card de cliente | nome, tipo·analista, agenda, chips de marketplace, status, último | + **bloco de reputação** (termômetro ML). Continua **sem** ROAS/Faturamento |
| Layout lista | Alternável (tweak) | **Removido** (só grade). Remove `ClientRow` e a opção no Tweaks |
| Filete de atraso | — | Card atrasado ganha filete vermelho à esquerda |

**Fora de escopo (YAGNI):** ROAS/Faturamento/ACOS no card; reputação de outros marketplaces (só ML existe hoje); cache de reputação no servidor (fica como melhoria futura — ver §6); mudanças nas telas de Histórico, Login, Painel CS, Novo cliente.

## 4. Estrutura / Layout

Container atual mantido: `.shell` (sidebar + topbar) + `.page > .page-inner` (máx. 1240px). Dentro do `page-inner`, empilhados com `gap`:

1. **Header** (`.ch-top`)
   - Esquerda: eyebrow de saudação (`Bom dia, <primeiro nome> 👋`), `<h1>` (`Todos os clientes` / `Meus clientes` / `Feedbacks para enviar` quando o toggle está ativo), e **stats inline**:
     - `N ativos` (verde) · `N atrasados` (vermelho, ou "tudo em dia") · `N para enviar hoje` (verde-tinta). Encerrados: `· N encerrado(s)` quando houver.
   - Direita: botão "⋯" (ações em massa: importar/exportar — inalterado) + botão accent "Adicionar cliente". Ambos respeitam papel (`canManage`).

2. **Filtros** (uma região visual, pode quebrar em 2 linhas)
   - Linha 1 (`.toolbar`): busca (loja/analista/marketplace) + **toggle "Para enviar hoje"** (com contador) + filtro de analista (dropdown, só p/ quem vê todos e há >1 analista).
   - Linha 2 (`.filters`): chips de **status** (Todos/Em dia/Atrasado/Encerrado) + divisória + chips de **marketplace com contagem** (Todos + os presentes no escopo). A bolinha usa `mkBrand`; a contagem usa a fonte mono.
   - Quando o toggle "Para enviar hoje" está ativo: mostra um seletor de data compacto e "Hoje" (reaproveita a lógica `isDueOn` / `dueDate`). Sem a `.duebar` antiga.

3. **Grade** (`.cgrid`, `auto-fill minmax(310px, 1fr)`, gap 16)
   - Cards de cliente (ordenados: encerrados por último; com toggle ativo, atrasados primeiro).
   - Card "Adicionar cliente" tracejado ao final (se `canManage`).
   - Estados vazios: "Nada para enviar" (toggle) / "Nenhum cliente encontrado" (busca/filtro) / "Carregando clientes…".

## 5. Card de cliente (com reputação)

Ordem vertical dentro do `.ccard`:

1. **Cabeçalho**: nome da loja (bold) + `Tipo · Analista`; status pill à direita (Em dia / Atrasado / Encerrado). Filete vermelho à esquerda quando atrasado.
2. **Chips de marketplace** (`mk-row`): um por conta, cor tonal da marca; conta encerrada aparece mutada (`· encerrado`).
3. **Bloco de reputação** (`.rep`) — ver §5.1.
4. **Rodapé**: chip de agenda (`agendaShort`) + "Último · <data>" (`brShort`).

### 5.1. Bloco de reputação — estados

A reputação existe **apenas para a conta Mercado Livre** do cliente (no máx. 1 conta ML por cliente) e **apenas quando essa conta está conectada** via OAuth. Fonte: `window.P4_API.meliReputation(conta.id)` → `{ ok, colorLabel, colorHex, levelId, powerSeller, nickname, transactions, metrics }`.

Níveis (já existem em `meliService.js` / `p4-history.jsx`):

| levelId | Rótulo | Hex |
|---|---|---|
| 5_green | Verde | #00a650 |
| 4_light_green | Verde claro | #7dd956 |
| 3_yellow | Amarelo | #ffe600 |
| 2_orange | Laranja | #ff7733 |
| 1_red | Vermelho | #e53935 |

Medalhas (`powerSeller`): `platinum → MercadoLíder Platinum`, `gold → MercadoLíder Gold`, `silver → MercadoLíder`, senão `Sem medalha` (mesmo mapa de `p4-history.jsx`).

Estados do bloco:

1. **Carregando** (ML conectado, request em andamento): **skeleton** (termômetro + textos como placeholders animados). *(Decisão aprovada: skeleton + carga assíncrona.)*
2. **OK**: termômetro de 5 segmentos (nível atual em destaque, mais alto + cor cheia; demais esmaecidos), rótulo `Reputação <cor>` e medalha. Tooltip opcional com nickname.
3. **ML não conectado** (a conta ML existe, mas `meliReputation` retorna `ok:false` / HTTP 400): bloco mutado (tracejado) — "Reputação indisponível · Mercado Livre não conectado" + ação **"Conectar"** que abre a **edição do cliente** (`onEditClient`), onde a conexão do ML já é feita hoje — mantém um único ponto de conexão. Só aparece a ação p/ quem pode gerenciar (`canManage`).
4. **Sem conta ML** (nenhuma conta é Mercado Livre): bloco mutado, sem ação — "Reputação indisponível · Sem conta no Mercado Livre".
5. **Erro** (falha de rede/servidor, ML conectado): bloco mutado — "Não foi possível carregar a reputação" + link "tentar de novo".
6. **Cliente encerrado**: bloco mutado — "Cliente encerrado · Sem monitoramento ativo" (não dispara request).
7. **Modo demonstração / offline** (`!P4_API.isLogged()`): não dispara requests; bloco mutado "Reputação indisponível (demonstração)".

## 6. Reputação — dados e carregamento

- **MVP (aprovado): carga assíncrona por card, com skeleton.**
  - A grade renderiza na hora. Cada card cujo cliente tenha conta ML **e** esteja logado (`live`) dispara `meliReputation(conta.id)`.
  - **Lazy-load por viewport**: usar `IntersectionObserver` para só buscar quando o card entra na tela (evita disparar N requests de uma vez).
  - **Concorrência limitada**: no máx. ~3–4 requests simultâneos (fila simples), para não saturar a API do ML.
  - **Cache em memória na sessão**: guardar `repById[contaId]` para não refazer a busca ao filtrar/reordenar/re-renderizar. (Reaproveitar o resultado enquanto a tela viver.)
  - Componente novo, isolado: `ClientCardReputation({ conta, live })` — encapsula estados de §5.1. O `MeliReputation` do Histórico continua como está (versão detalhada); este é a versão compacta.
- **Melhoria futura (não neste escopo):** endpoint em lote (ex.: `GET /clients/reputations?ids=`) e/ou **cache no servidor** (persistir última reputação + refresh periódico), para o card já vir preenchido sem N chamadas. Registrar como próximo passo.

## 7. Responsividade

- `≥1000px`: sidebar completa (240px); grade `auto-fill`.
- `<1000px`: sidebar vira **trilho de ícones** (66px) — comportamento já existente.
- `<760px`: sidebar **some**; `page-inner` com padding menor; header quebra (ações em largura total, "Adicionar cliente" flex); busca ocupa a largura; chips/toggle quebram naturalmente; grade vira 1 coluna.
- Cards: `minmax(310px, 1fr)` garante 1 coluna em telas estreitas; o bloco de reputação usa `margin-top:auto` para alinhar rodapés entre cards de alturas diferentes.

## 8. Arquivos afetados

- `design_handoff_sistema_feedbacks/p4-clients.jsx` — reescrever `Clients`: header com stats inline; toolbar com toggle + contadores; grade só; novo `ClientCardReputation`; remover `ClientRow` e o branch de layout lista.
- `design_handoff_sistema_feedbacks/index.html` (`<style>`) — novo CSS: `.ch-sub`/`.stat`, `.due-toggle`, `.filters`/chips com contagem, `.rep` (+ skeleton) e ajustes no `.ccard`. Manter `.kpis`/`.clist` (ainda usados no Histórico) mas parar de usar `.clist` na tela de clientes.
- `design_handoff_sistema_feedbacks/p4-shell.jsx` — remover do Tweaks a opção "Lista de clientes" (`layout: grade|lista`) e o uso de `t.layout` na tela de Clientes (Histórico não usa). Confirmar que nada mais depende de `layout`.
- `design_handoff_sistema_feedbacks/p4-api.js` — nenhuma mudança de API prevista no MVP (usa `meliReputation` existente). (Endpoint em lote é melhoria futura.)
- `design_handoff_sistema_feedbacks/p4-data.jsx` — sem mudança de dados; reaproveitar helpers (`agendaShort`, `brShort`, `mkBrand`, `mkBg`, `mkColor`, `isDueOn`, `weekdayName`).

## 9. Riscos / considerações

- **Performance**: muitos clientes com ML conectado = muitas chamadas. Mitigado por lazy-load + concorrência limitada + cache de sessão; monitorar e migrar p/ lote/cache se necessário.
- **Consistência de status**: "atrasado" (relatório) e a **cor da reputação** são coisas diferentes — um cliente pode estar "Em dia" no envio e "Vermelho" na reputação, e vice-versa. A UI deve deixar claro que são sinais distintos (status = envio; termômetro = reputação ML).
- **Deploy**: repositório faz deploy automático no `git push` da main (Vercel/Render). Alterar apenas os arquivos do frontend; validar visual antes de publicar.
- **Encerrados**: continuam visíveis (mutados) e fora das contagens de atraso/envio — comportamento atual preservado.

## 10. Critérios de aceite

- [ ] Tela de Clientes tem exatamente 3 regiões: header (com stats inline), filtros, grade.
- [ ] Não há mais os 4 cards de KPI, a `.duebar` nem o layout de lista.
- [ ] Toggle "Para enviar hoje" filtra a grade (atrasados primeiro) e mostra contador.
- [ ] Chips de marketplace mostram contagem por marketplace.
- [ ] Cada card mostra o bloco de reputação com os 7 estados de §5.1 tratados; ML OK mostra termômetro + medalha; skeleton enquanto carrega.
- [ ] Card não mostra ROAS/Faturamento/ACOS.
- [ ] Responsivo: 1 coluna < 760px, sidebar em trilho < 1000px, sem overflow horizontal.
- [ ] Papéis respeitados (analista só os seus; ações de gestão só admin/analista; CS somente leitura).

---

*Mockup de referência: `design_handoff_sistema_feedbacks/_mockup-clientes.html` (v2).*
