# Design — Fechamento mensal com números lançados manualmente

**Data:** 2026-07-26
**Componentes:** Backend (migration + `lib/monthlyClosing` + `closingService` + rota) + tela `p4-closing.jsx`.
**Status:** Aprovado — pronto para plano de implementação.

**Substitui** partes de [2026-07-25-fechamento-mensal-design.md](2026-07-25-fechamento-mensal-design.md):
as seções 3 e 5 daquele spec deixam de valer; as seções 4, 8, 9 e 10 mudam; as
seções 1, 6 e 7 seguem valendo como estão. A seção 2 (acesso) passa a ser
cumprida de fato — ver seção 7 aqui.

## 1. Por que mudar

O fechamento consolidava os relatórios semanais do mês. Isso não fecha: um
feedback cobre uma semana, e semana não respeita virada de mês. A semana de
29/06 a 05/07 tem faturamento dos dois meses, e o desenho anterior atribuía ela
inteira a julho.

Aquele spec registrava isso como "aproximação assumida" na seção 3. A decisão
agora é não aproximar: **os números do mês passam a ser lançados à mão**, por
conta, por mês. Quem lança sabe separar o que foi de cada mês; o sistema não
tem como saber.

Consequência boa: a regra de atribuição de mês some do fechamento, e com ela o
único ponto do desenho que se sabia estar errado.

## 2. O que sai

- `consolidate(rows)` em `lib/monthlyClosing.js` — some junto com seus testes.
- A consulta a `reports` em `closingService.getMonthlyClosing`, e com ela a
  janela de ±45 dias e o `COALESCE(periodo_fim, periodo_ini, criado_em)`.
- `nReports` por conta e por cliente, no payload e na tela.
- A porta "tem relatório no mês" de `accountInMonth` (substituída — ver seção 5).
- `resumo.semRelatorio` (substituído — ver seção 6).

`reportMonth` e `ratios` em `lib/metrics.js` **ficam**: `reportMonth` porque o
Painel CS a usa, `ratios` porque o fechamento continua derivando as razões —
agora dos valores digitados.

## 3. Modelo de dados

Migration nova, tabela `monthly_figures` — uma linha por conta por mês:

| coluna | tipo | nota |
|---|---|---|
| `id` | string (uuid gerado em JS) | PK |
| `account_id` | string | FK → `accounts`, cascade on delete |
| `ym` | string(7) | `'2026-07'` |
| `faturamento` | decimal | |
| `investimento` | decimal | |
| `receita_ads` | decimal | |
| `criado_em` / `atualizado_em` | timestamp | |
| `atualizado_por` | string | FK → `users`, SET NULL |

Índice único em (`account_id`, `ym`).

**Colunas uuid vão como `t.string`, nunca `t.uuid`** — no Postgres `t.uuid` vira
coluna nativa e a FK contra o `varchar` de `accounts.id` é rejeitada na criação,
derrubando o boot. Foi exatamente o bug pego na Task 3 do plano anterior.

**Linha ausente não é linha zerada.** Sem linha significa "não lançado" e acende
o aviso de conta incompleta. Com linha e valor `0` é uma afirmação — a conta não
faturou. A tela precisa distinguir os dois; é a mesma distinção que motivou a
correção de `mcMoney` na revisão anterior.

**Todo mês é lançado do zero.** Não há backfill, não se importa nada dos
relatórios, e não se copia o mês anterior como ponto de partida. Não é uma
simplificação temporária — é a regra.

Importar dos relatórios seria repor justamente o número que se decidiu
abandonar. Copiar o mês anterior seria pior: os campos chegariam preenchidos com
valores plausíveis de outro período, e o custo de revisar cada um passa a ser
maior que o de digitar. Campo vazio é honesto sobre o que ainda não foi
informado; campo herdado não é.

## 4. Só três campos

Lança-se `faturamento`, `investimento` e `receita_ads`. Deles saem as três
razões, que são exatamente as três metas comparadas:

```
roas  = receita_ads / investimento
acos  = investimento / receita_ads  * 100
tacos = investimento / faturamento  * 100
```

**ROAS, ACOS e TACOS são calculados, nunca digitados** — via `ratios()` de
`lib/metrics.js`, a mesma função de antes, agora recebendo valores digitados em
vez de somas. Divisor zero devolve `null`, e a tela mostra `—`.

`vendas` e `vendas_ads` ficam de fora: a tela de fechamento não exibe nem compara
nenhum dos dois, então seriam campos digitados todo mês que ninguém lê.

## 5. Quem entra no mês

`accountInMonth(conta, ym, temLancamento)` — mesma assinatura, terceiro argumento
com significado novo. Uma conta entra se qualquer uma valer:

1. **Tem lançamento naquele mês** (`monthly_figures` tem linha para a conta e o
   `ym`). Substitui a antiga porta "tem relatório no mês" e preserva a mesma
   propriedade: se alguém registrou algo ali, a conta aparece, mesmo que a
   janela de datas diga o contrário.
2. **A janela de datas cobre o mês** — inalterada: `dataEntrada` (ou `criadoEm`)
   até o fim do mês, e `dataEncerramento` nulo ou depois do início do mês.

Um cliente entra se pelo menos uma conta sua entrou.

## 6. Resumo do topo

| campo | definição |
|---|---|
| `clientes` | linhas na lista |
| `fechados` | `closing.fechadoEm != null` |
| `pendentes` | `clientes - fechados` |
| `incompletos` | clientes com **pelo menos uma conta sem lançamento** |

`incompletos` substitui `semRelatorio` e, como ele, **cruza com `pendentes`** —
não é uma quarta categoria exclusiva. Um cliente pode estar fechado e incompleto
(ver seção 8).

## 7. Acesso do analista

A tela passa a aparecer na sidebar para **qualquer usuário autenticado**, não só
admin e CS.

Isso corrige uma divergência: a seção 2 do spec anterior já dizia que o analista
acessa e vê só a própria carteira, e o backend já implementa isso
(`listClients` filtra por `analista_id`, e `saveClosing` recusa cliente de
outro). Só a sidebar gateava em `admin || cs`, contrariando o próprio spec.
Nenhuma lógica de permissão nova — apenas a condição da sidebar.

## 8. Fechar com conta incompleta

Permitido. A linha mostra o aviso e o resumo conta os incompletos, mas o botão
Fechar continua liberado.

Motivo: conta pausada no meio do mês, ou marketplace que legitimamente não rodou,
ficam sem número — e travar o fechamento por isso obrigaria a lançar zero
explicitamente só para destravar, o que polui o dado com zeros que não são
afirmações de verdade.

## 9. Tela

O painel expandido de cada cliente ganha, por conta, três campos de entrada em
formato brasileiro (`39.100,00`).

As razões aparecem ao lado e são recalculadas **no navegador enquanto se digita**,
para dar retorno imediato de meta batida ou não. Ao carregar a tela valem as do
backend. As duas usam a mesma fórmula, então convergem; a versão do navegador é
só antecipação, não uma segunda fonte de verdade — depois de salvar, o refetch
traz as do backend e elas passam a valer.

Campo de conta sem lançamento nasce **vazio**, não com zero: zero é uma
afirmação, e pré-preencher com ele empurraria o usuário a confirmar um dado que
ninguém informou.

**Gravação:**

- O botão "Salvar observação" vira **"Salvar"**, que para o usuário é uma ação
  só. Por baixo são duas chamadas, **nesta ordem: primeiro os lançamentos,
  depois a observação/estado**. Se a primeira falhar, a segunda não é disparada
  e nada é gravado — o usuário vê o erro com os campos ainda preenchidos e pode
  tentar de novo. A ordem importa porque fechar um mês cujos números não
  gravaram seria pior que o inverso.
- **"Fechar mês" salva antes de fechar.** Sem isso, digitar e clicar direto em
  Fechar descartaria o que foi digitado — a armadilha mais provável da tela.
- "Reabrir mês" não grava nada; só muda o estado.

Conta sem lançamento mostra `—` nos três campos calculados e o aviso de
incompleta. Conta com lançamento zerado mostra `R$ 0,00` e nenhum aviso.

Fora isso a tela é a mesma: navegador de mês, resumo, uma linha por cliente com
tag de status, expandir um por vez, guarda de resposta obsoleta na troca de mês.

## 10. Backend

**`lib/monthlyClosing.js`** — sai `consolidate`; `buildMonthlyClosing` passa a
receber `figures` (linhas de `monthly_figures`) no lugar de `reports`, e monta os
totais do cliente somando os lançamentos das contas, com as razões recalculadas
da soma (uma conta pode ter ROAS 4x e outra 6x; o do cliente sai da soma, nunca
da média).

**`closingService`** — `getMonthlyClosing` troca a consulta de relatórios por uma
de `monthly_figures` filtrada por `ym` e pelas contas em escopo. Ganha
`saveFigures(user, clientId, ym, contas)`, que grava em lote as contas de um
cliente, com o mesmo check de escopo por papel de `saveClosing`.

**Apagar um lançamento:** uma conta enviada com os três campos vazios tem a
linha **removida** de `monthly_figures`, voltando ao estado "não lançado". É a
única forma de desfazer um lançamento — sem isso, quem digitasse por engano na
conta errada não teria como reverter, já que gravar `0` afirma outra coisa. Uma
conta enviada com valores (incluindo `0`) faz upsert.

**Rota** — `PUT /closings/:clientId/:ym/figures` com o array de lançamentos.
Valida que cada `accountId` pertence ao cliente e que os valores são numéricos e
não negativos; rejeita com 400 caso contrário.

## 11. Testes

Saem os testes de `consolidate`. Entram, todos puros e sem banco:

- Conta com lançamento entra no mês mesmo fora da janela de datas.
- Conta sem lançamento e fora da janela não entra.
- Lançamento ausente e lançamento zerado produzem estados distintos (o primeiro
  marca a conta como incompleta; o segundo não).
- Razões derivam dos valores lançados, e divisor zero devolve `null`.
- Totais do cliente somam os lançamentos das contas, com razões recalculadas da
  soma e não média das razões.
- `incompletos` conta clientes com pelo menos uma conta sem lançamento, e cruza
  com `pendentes` em vez de excluí-los.
- Cliente fechado pode estar incompleto.

## 12. Fora de escopo

- Importar lançamentos de planilha.
- Qualquer forma de pré-preencher os campos (mês anterior, relatórios, médias) —
  ver seção 3: é decisão, não lacuna.
- Histórico de alterações dos lançamentos (só `atualizado_em`/`atualizado_por`).
- Qualquer mudança no Painel CS ou no relatório semanal.
