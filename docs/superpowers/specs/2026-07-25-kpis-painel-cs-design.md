# Design — Enxugamento da fileira de KPIs do Painel CS

**Data:** 2026-07-25
**Componentes:** Backend (`dashboardService` + `lib/dashboardAggregates`) + Painel CS.
**Status:** Aprovado — implementado.

## 1. Contexto e objetivo

A fileira de KPIs do Painel CS tinha oito cards e virou um mostruário: dois
financeiros ("Faturamento" e "ROAS médio") e dois de volume de relatórios
("Relatórios" e "Relatórios na semana").

Os financeiros já aparecem com muito mais contexto no bloco "Métricas por
analista" logo abaixo — por mês, por analista, com investimento, ACOS e TACOS ao
lado. Os de volume de relatórios também: o card "Relatórios gerados por semana"
mostra as últimas 12 semanas em barras, o que responde a mesma pergunta melhor do
que dois números soltos.

Ao mesmo tempo faltava uma informação de volume: o painel só contava **clientes**,
mas um cliente pode ter uma ou várias contas de marketplace. Dois analistas com
10 clientes cada podem ter cargas de trabalho bem diferentes.

Objetivo: entra "Contas", saem quatro cards — "Faturamento", "ROAS médio",
"Relatórios" e "Relatórios na semana". A fileira vai de oito para cinco.

Decisões de escopo:

1. **Contas aparece só como KPI no topo.** Não entra nos anéis por gestor nem
   troca a contagem do card "Clientes por marketplace" (que segue contando
   cliente único por marketplace).
2. **A remoção vale só para os cards de KPI.** O bloco "Métricas por analista"
   fica intacto, com suas colunas de Faturamento e ROAS, e o card "Relatórios
   gerados por semana" também.

## 2. O que conta como "conta"

`countActiveAccounts(clients)` soma as contas com `ativo !== false` dos clientes
recebidos.

- **Conta encerrada sai** (`ativo === false`) — mesma regra que o painel já usa
  para clientes encerrados.
- **Conta pausada fica.** Ela existe e é gerenciada; só não cobra relatório. É a
  mesma distinção que a tela de Clientes já faz entre pausado e encerrado, ver
  [[status-tags-pausado-onboarding-hoje]].

O recorte é responsabilidade de quem chama: o painel passa `clients` (a carteira
viva, já sem clientes encerrados), não `allClients`. Assim o KPI "Contas" é
coerente com o KPI "Clientes" ao lado — os dois falam da mesma base.

Derivado: `accountsPerClient = totalAccounts / totalClients`, uma casa decimal,
exibido no rodapé do card como "1,6 por cliente".

## 3. Payload (`totals`)

**Entram:** `totalAccounts`, `accountsPerClient`.

**Saem:** `avgRoas`, `totalRevenue`, `totalReports`, `reportsPerClient`,
`reportsThisWeek`, `reportsLastWeek` — e junto os cálculos que só existiam para
alimentá-los (`roasVals`, e as duas linhas que fatiavam `byWeek` na semana atual
e na anterior). Nenhum outro consumidor lia esses campos (verificado por grep em
`backend/src` e `design_handoff_sistema_feedbacks`), então ficariam como peso
morto.

**Ficam**, porque ainda têm consumidor: `reportsByWeek` (alimenta o gráfico das
12 semanas), `clientsNoReports` (rodapé do card "Clientes") e a consulta à tabela
`reports`, que é a fonte do `reportsByWeek`.

Os campos `roasW` e `fatLatest` do cliente enriquecido **continuam** — quem os
usa é a tela de Clientes, não o painel. O que saiu foi só a agregação deles.

A pasta `p4-feedbacks-transferencia/` tem uma cópia do projeto e não foi tocada:
é snapshot da migração de computador, fora do controle de versão.

## 4. Fileira final

Sete cards, na ordem:

| # | card | valor | rodapé |
|---|---|---|---|
| 1 | Clientes | `totalClients` | N sem relatório |
| 2 | Contas | `totalAccounts` | N,N por cliente |
| 3 | Atrasados | `overdueClients` | N% no prazo |
| 4 | Para enviar hoje | `dueToday` | agendados p/ hoje |
| 5 | No prazo | `onTimeRate` | entrega em dia |

A grade é `auto-fill / minmax(170px, 1fr)`, então a fileira se reorganiza sozinha
com cinco cards — nenhum ajuste de layout foi necessário.

**Redundância conhecida:** `onTimeRate` aparece duas vezes — como valor do card
"No prazo" e como rodapé do card "Atrasados". Já era assim antes; com cinco cards
em vez de oito ficou bem mais visível. Fica registrado como candidato a
enxugamento, não foi mexido aqui.

## 5. Testes

Em `backend/test/dashboard-aggregates.test.js`, contra `countActiveAccounts`:

- Soma as contas de todos os clientes da lista.
- Conta encerrada (`ativo: false`) não entra.
- Conta pausada continua contando.
- Cliente sem o campo `contas` não quebra nem soma.
- Lista vazia devolve zero.

## 6. Nota de refatoração

`lib/managerBreakdown.js` virou `lib/dashboardAggregates.js`, agora com as duas
agregações puras do painel (`byManager` e `countActiveAccounts`). O arquivo ainda
não tinha sido commitado, então o rename saiu sem custo de histórico.
