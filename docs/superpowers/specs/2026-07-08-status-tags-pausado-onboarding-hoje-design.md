# Design — Tags de status: Pausado, Onboarding e "Enviar hoje" (+ motivo)

**Data:** 2026-07-08
**Componentes:** Backend (status dos clientes) + telas de clientes/dashboard/cadastro.
**Status:** Aprovado — pronto para plano de implementação.

## 1. Contexto e objetivo

Hoje o status derivado do cliente é **em-dia / atrasado** (regra por ciclo, ver
[[regra-atraso-por-ciclo]]) + **encerrado** (derivado quando todas as contas estão
inativas). A tag é renderizada por `StatusTag({status, encerrado})` em
`p4-clients.jsx` e no dashboard de CS; há filtros por status e uma visão "para
enviar".

Objetivo: adicionar três tags e o motivo da pausa:
- **Pausado** (cliente e/ou conta) — com **motivo** — não é cobrado enquanto pausado.
- **Onboarding** (cliente) — manual — não é cobrado enquanto onboarding.
- **Enviar hoje** — o feedback precisa ser montado hoje (dia de envio e ainda não feito).
- Cada tag com uma **cor** própria.

## 2. Modelo de dados (migração única, sem quebra)

- `clients.situacao` — string, default `'ativo'`. Valores: `'ativo' | 'onboarding' | 'pausado'`.
- `clients.motivo_pausa` — text (usado quando `situacao = 'pausado'`).
- `accounts.pausado` — boolean, default `false`.
- `accounts.motivo_pausa` — text (usado quando pausado).

"Encerrado" continua **derivado** (todas as contas inativas), não vira coluna.
Migração nova (roda no boot do backend). Sem backfill necessário (defaults cobrem
os registros existentes → todos `ativo`/`pausado=false`).

## 3. Status: cálculo e precedência (`lib/clientAggregate.js` + `lib/p4.js`)

**Contas que cobram relatório** (`cobraveis`) = contas **ativas e não pausadas**.
Conta pausada sai do cálculo de atraso (como conta inativa).

Definições (por cliente):
- `encerrado` = há contas e **todas** estão inativas (`ativo === false`) — como hoje.
- `ativas` = contas com `ativo !== false`.
- `pausadoAll` = `ativas.length > 0 && ativas.every((m) => m.pausado)` (todas as
  contas ativas estão pausadas).
- `pausado` = `client.situacao === 'pausado' || pausadoAll`.
- `onboarding` = `client.situacao === 'onboarding'`.
- `cobraveis` = `ativas.filter((m) => !m.pausado)`.
- `atrasado` = `cobraveis.some((m) => p4.isOverdueByCycle(agenda, m.lastGen, asOf))`
  (`asOf` = ontem; regra de ciclo existente).
- `precisaHoje` = `!encerrado && !pausado && !onboarding && p4.isDueOn(agenda, hoje)
  && cobraveis.some((m) => p4.isOverdueByCycle(agenda, m.lastGen, hoje))`
  (`hoje` = `p4.todayISO()`; a mesma regra de ciclo com referência = **hoje**, então
  a tag some quando o relatório do ciclo é gerado).

**Tag exibida** (`statusTag`, precedência de cima para baixo — a primeira que casar):
1. `encerrado` → `'encerrado'`
2. `pausado` → `'pausado'`
3. `onboarding` → `'onboarding'`
4. `atrasado` → `'atrasado'`
5. `precisaHoje` → `'hoje'`
6. senão → `'em-dia'`

**Campos retornados** por `enrichClient` (além dos atuais):
- `situacao`, `motivoPausa` (do cliente), `pausado` (bool derivado), `onboarding`
  (bool), `precisaHoje` (bool), `statusTag` (string acima). `status` (em-dia/atrasado)
  continua para compatibilidade/filtros.
- Por conta: `pausado`, `motivoPausa`.

> `p4.isOverdueByCycle`/`isDueOn`/`todayISO` já existem. Nenhuma função nova de
> data é necessária.

## 4. "Para enviar" e filtros (`clientService.js` + `p4-clients.jsx`)

- **Para enviar / due**: passa a excluir pausados/onboarding/encerrados:
  `!encerrado && !pausado && !onboarding && (isDueOn(agenda, due) || status === 'atrasado')`.
  (Atualizar `applyFilters` e a `meta.toSend/scheduled` em `listClients`; e o
  `dueMatch`/`dueTodayCount` no front.)
- **Filtro de status**: os chips passam a ser
  **Todos · Em dia · Enviar hoje · Atrasado · Pausado · Onboarding · Encerrado**.
  `normalizeStatus` (backend) e o filtro do front reconhecem `pausado`, `onboarding`
  e `hoje`, comparando com `statusTag`.

## 5. Cadastro (`p4-new-client.jsx`)

- **Cliente**: novo seletor **Situação** — `Ativo / Onboarding / Pausado`
  (componente `Seg`). Quando **Pausado**, aparece um campo **"Motivo da pausa"**
  (textarea curta). Onboarding não pede motivo.
- **Conta**: o seletor atual `Ativo / Encerrado` vira **`Ativo / Pausado / Encerrado`**.
  Quando **Pausado**, aparece **"Motivo da pausa"** da conta. Mapeamento:
  `Ativo → {ativo:true, pausado:false}`, `Pausado → {ativo:true, pausado:true}`,
  `Encerrado → {ativo:false, pausado:false}`.
- O `onSave` envia `situacao`/`motivoPausa` (cliente) e `pausado`/`motivoPausa` (conta).

## 6. Tags: cores e renderização

`StatusTag` passa a receber `statusTag` (e o `motivoPausa` para o tooltip). Classes
CSS novas ao lado de `.status-tag.ok/.late/.closed`:

| Tag | `statusTag` | Classe | Cor |
|-----|-------------|--------|-----|
| Em dia | `em-dia` | `.ok` | Verde `#56D54F` |
| Enviar hoje | `hoje` | `.today` | Azul `#2A6FDB` |
| Atrasado | `atrasado` | `.late` | Vermelho `#d8423a` |
| Pausado | `pausado` | `.paused` | Âmbar `#E0A100` |
| Onboarding | `onboarding` | `.onboarding` | Roxo `#7A5AF0` |
| Encerrado | `encerrado` | `.closed` | Cinza `#6b7570` |

- Tag **Pausado** mostra o **motivo** no `title` (tooltip) e no detalhe do cliente.
- Card do cliente (`.ccard`): manter o realce de `atrasado`; pausado/onboarding
  ganham um leve esmaecimento/marca discreta (sem "gritar").
- Dashboard de CS (`p4-cs-dashboard.jsx`): reaproveitar `StatusTag`; incluir as
  novas tags nas contagens/estados que fizerem sentido (ex.: não contar pausado/
  onboarding como atrasado).

## 7. Validação (`validators/schemas.js`)

- `createClientSchema`/`updateClientSchema`: aceitar `situacao` (`enum ativo/
  onboarding/pausado`, default `ativo`) e `motivoPausa` (string opcional).
- `contaSchema`: aceitar `pausado` (boolean, default false) e `motivoPausa` (string
  opcional).

## 8. Persistência (`clientService.js`)

- `normalizeContas`: incluir `pausado`/`motivoPausa` por conta.
- `createClient`/`updateClient`: gravar `situacao`/`motivo_pausa` no cliente e
  `pausado`/`motivo_pausa` nas contas (insert + reconciliação de update).
- `rowToClientBase`/`assembleClient`: expor `situacao`/`motivoPausa`; `enrichAccount`
  expor `pausado`/`motivoPausa`.

## 9. Espelho no protótipo (`p4-data.jsx`)

Espelhar a precedência de `statusTag` e `precisaHoje` para a demo offline, usando os
mesmos helpers já mirrorados (`isOverdueByCycle`, `isDueOn`). Dados mock ganham
alguns clientes `onboarding`/`pausado` para ilustrar.

## 10. Decisões (rastreabilidade do brainstorming)

- Nível: **cliente e conta** (os dois), cada um com motivo.
- Comportamento: pausado/onboarding **não cobram** (fora de atrasado e "para enviar").
- Onboarding: **manual** (sem motivo próprio).
- Local: tudo no **cadastro**.
- Precedência: Encerrado > Pausado > Onboarding > **Atrasado > Enviar hoje** > Em dia.
- "Enviar hoje" = dia de envio hoje **e** relatório do ciclo ainda não gerado.
- Cores: verde/azul/vermelho/âmbar/roxo/cinza (tabela na seção 6).
- Uma conta pausada num cliente com várias contas → o cliente segue pelas outras
  (a pausa aparece só no detalhe da conta).

## 11. Fora de escopo (YAGNI)

- Histórico de quem/quando pausou; datas automáticas de pausa; onboarding automático;
  motivo separado para onboarding; notificações.

## 12. Verificação

- Migração aplica e defaults preenchem clientes/contas existentes (todos `ativo`).
- Cliente marcado **Onboarding** → tag Onboarding (roxo), fora de atrasado/para-enviar.
- Cliente **Pausado** com motivo → tag Pausado (âmbar) + motivo no tooltip; sai de
  atrasado/para-enviar.
- Conta pausada num cliente multi-conta → não cobra; cliente segue pelas outras.
- Dia de envio hoje sem relatório do ciclo → tag **Enviar hoje** (azul); gera o
  relatório → tag some.
- Filtros novos (Pausado/Onboarding/Enviar hoje) retornam o conjunto certo.
- Testes Node da precedência de `statusTag` e de `precisaHoje` (backend é Node puro).
