# Design — Página de fechamento mensal dos clientes

**Data:** 2026-07-25
**Componentes:** Backend (migration + `lib/metrics` + `lib/monthlyClosing` + service + rota) + tela nova `p4-closing.jsx`.
**Status:** Aprovado — pronto para plano de implementação.

## 1. Objetivo

Uma tela onde, no fim do mês, se percorre cliente a cliente: ver o consolidado do
mês, comparar com as metas cadastradas, escrever a análise e marcar o mês como
fechado.

Decisões tomadas no brainstorming:

1. **Consolidado do mês vs. metas**, não checklist de entrega nem relatório para
   enviar ao cliente. É controle interno.
2. **Linha por cliente, expansível em contas.** A comparação com meta acontece na
   linha da conta, porque é lá que a meta existe.
3. **Fechar grava marca + observação**, é reabrível, e os números continuam sendo
   lidos dos relatórios em tempo real.
4. **Entram os clientes que operaram no mês**, com ou sem relatório. Quem ficou
   sem entrega aparece sinalizado — é justamente o que o fechamento precisa pegar.

## 2. Navegação e acesso

Item "Fechamento" na sidebar, abaixo de "Painel CS". Tela `p4-closing.jsx`,
registrada como `closing` no `p4-shell.jsx`, no mesmo molde de `dashboard`.

Acesso segue a regra que o app já aplica: admin e CS veem todos os clientes,
analista vê só os seus. Nenhuma lógica de permissão nova — o service reusa o
mesmo filtro por `analista_id` que `clientService.listClients` usa.

**Escrita também é escopada:** a rota de fechar/reabrir precisa verificar que o
cliente pertence ao escopo do usuário antes de gravar. Um analista não pode
fechar o mês de cliente de outro.

## 3. A que mês pertence um relatório

Um relatório semanal de 29/06 a 05/07 precisa cair em um mês só. A regra:

```
reportMonth(r) = mês de (periodo_fim || periodo_ini || criado_em)   → 'YYYY-MM'
```

Não é regra nova: é exatamente o que o bloco "Métricas por analista" já faz em
`dashboardService`. A função sai de lá e vira **`lib/metrics.js`**, consumida
pelos dois — duas telas calculando "mês do relatório" de formas diferentes
divergiriam mais cedo ou mais tarde.

**Aproximação assumida e explícita:** julho inclui os dias de junho quando a
semana atravessa a virada. Ratear o relatório proporcionalmente entre os dois
meses seria mais fiel, e bem mais complexo; para fechamento de agência o
relatório é a unidade indivisível. Fica registrado.

## 4. Quem entra na lista do mês

Uma **conta** entra no mês `ym` se qualquer uma das duas valer:

1. **Tem relatório no mês** (`reportMonth(r) === ym`) — evidência direta de
   operação, vale mesmo que a conta já esteja encerrada hoje.
2. **A janela de datas cobre o mês:** `data_entrada` (ou `criado_em` como
   fallback) é anterior ou igual ao fim do mês, **e** `data_encerramento` é nulo
   ou posterior ou igual ao início do mês.

Um **cliente** entra se pelo menos uma conta sua entrou.

A regra 2 é o que evita o furo de listar cliente cadastrado em setembro no
fechamento de julho. A regra 1 é o que garante que conta encerrada em agosto
ainda apareça no fechamento de julho, quando ela operou.

Cliente pausado ou em onboarding aparece normalmente, com a tag de status que a
tela de Clientes já usa (ver [[status-tags-pausado-onboarding-hoje]]).

## 5. Consolidação

Por conta, somando os relatórios do mês: `faturamento`, `vendas`, `receitaAds`,
`vendasAds`, `investimento`.

Por cliente: soma as somas das contas.

Em ambos os níveis, **ROAS/ACOS/TACOS são recalculados a partir das somas**,
nunca média das razões:

```
roas  = receitaAds / investimento          (null se investimento = 0)
acos  = investimento / receitaAds  * 100   (null se receitaAds = 0)
tacos = investimento / faturamento * 100   (null se faturamento = 0)
```

É a mesma `ratios()` que o `dashboardService` já usa; vai junto para
`lib/metrics.js`.

## 6. Comparação com meta

Só na linha da conta. As direções vêm da própria UI do relatório, que já as
declara em texto ("Meta 4,0x", "Meta ≤ 20%", "Meta: R$ X"):

| meta | direção | atingiu quando |
|---|---|---|
| `meta_roas` | piso | `roas >= meta` |
| `meta_acos` | teto | `acos <= meta` |
| `meta_tacos` | teto | `tacos <= meta` |
| `meta_investimento` | orçamento | sem ✓/✗ — mostra % do orçamento usado |

As metas são strings pt-BR (`"4,00"`). **String vazia significa "sem meta"** e a
célula mostra `—`. Nunca ✗ — meta ausente não é meta não batida.

Métrica sem valor (razão nula porque o denominador é zero) também mostra `—`, não
✗.

## 7. Persistência

Migration nova, tabela `monthly_closings`:

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid | PK |
| `client_id` | uuid | FK → `clients`, cascade on delete |
| `ym` | text | `'2026-07'` |
| `observacoes` | text | análise do mês |
| `fechado_em` | timestamp | **null = aberto** |
| `fechado_por` | uuid | FK → `users`, null quando aberto |
| `criado_em` / `atualizado_em` | timestamp | |

Índice único em (`client_id`, `ym`).

A linha nasce no primeiro dos dois eventos: salvar observação ou fechar.
**Reabrir zera `fechado_em`/`fechado_por` e preserva `observacoes`** — reabrir não
apaga a análise.

Nada de snapshot dos números: como decidido, o consolidado é sempre lido dos
relatórios, então corrigir um relatório de um mês já fechado atualiza o
consolidado. É a leitura desejada.

## 8. Backend

**`lib/metrics.js`** (puro, novo): `reportMonth(report)`, `ratios(fat, inv, rec)`.
Extraídos de `dashboardService`, que passa a importá-los. Refactor sem mudança de
comportamento — as fórmulas são as mesmas.

**`lib/monthlyClosing.js`** (puro, novo): recebe contas (com metadados e metas),
relatórios do período e as linhas de fechamento já existentes; devolve as linhas
da tela e o resumo. Toda a regra das seções 4, 5 e 6 mora aqui, sem banco, o que
a torna testável direto.

**`services/closingService.js`**: busca no banco e delega ao lib.

A consulta de relatórios usa uma janela de ±45 dias em torno do mês sobre
`COALESCE(periodo_fim, periodo_ini, criado_em)` — larga o bastante para pegar
qualquer semana que atravesse a virada, estreita o bastante para não carregar o
histórico inteiro. `reportMonth` decide em definitivo em JS; a janela é só o
recorte da consulta.

**`routes/closings.js`**, montada em `/api/closings` no `app.js`, com
`router.use(authenticate)` como as demais:

- `GET /api/closings?ym=YYYY-MM` → linhas + resumo
- `PUT /api/closings/:clientId/:ym` → body `{ observacoes?, fechado? }`

O `GET` sem `ym` assume o mês corrente. `ym` inválido responde 400.

Formato do `GET`:

```
{
  ym: '2026-07',
  resumo: { clientes, fechados, pendentes, semRelatorio },
  clients: [{
    clientId, loja, analista, statusTag,
    nReports, totals: { faturamento, vendas, receitaAds, vendasAds,
                        investimento, roas, acos, tacos },
    contas: [{ accountId, marketplace, apelido, nReports, totals,
               metas: { investimento, roas, acos, tacos },
               atingiu: { roas: true|false|null, acos: …, tacos: … } }],
    closing: { observacoes, fechadoEm, fechadoPor } | null
  }]
}
```

`atingiu` já vem resolvido do backend (`null` = sem meta ou sem valor), para a
tela não reimplementar a direção de piso vs. teto.

Definição de cada número do `resumo`, para não haver dúvida — **`semRelatorio`
cruza com `pendentes`**, não é uma quarta categoria exclusiva:

| campo | definição |
|---|---|
| `clientes` | linhas na lista |
| `fechados` | `closing.fechadoEm != null` |
| `pendentes` | `clientes - fechados` |
| `semRelatorio` | `nReports === 0` (fechado ou não) |

## 9. Tela

```
Fechamento mensal              ◀  julho / 2026  ▶

4 clientes · 1 fechado · 3 pendentes · 1 sem relatório ⚠

CLIENTE           FATURAMENTO  INVESTIM.    ROAS
▾ Diego Block          48.200      6.410    4,8x     ● a fechar
   Mercado Livre       39.100      5.200    4,9x ✓ meta 4,0
   Shopee               9.100      1.210    4,1x ✗ meta 5,0
   ┌ observação do mês ────────────────────┐
   │                                        │  [ Fechar mês ]
   └────────────────────────────────────────┘
▸ Loja Verde           22.100      3.900    2,7x     ✓ fechado
▸ Casa Moldávia             —          —      —   ⚠ ● a fechar
```

- Navegador de mês no cabeçalho; o mês corrente é o padrão.
- Linha do cliente com os totais; expandir revela as contas e o painel de
  observação. Só uma linha expandida por vez.
- Cliente sem nenhum relatório no mês: valores em `—` e marcador ⚠.
- Fechado ganha marcador próprio e a linha fica recessiva, sem sumir.
- Sem gráfico: a página é de revisão e ação, não de análise visual. Quem quer a
  série histórica já tem o histórico do cliente.
- Ordenação: pendentes primeiro, depois por faturamento desc — o que falta
  fazer sobe.

Estados: carregando, erro, e mês sem nenhum cliente ("nenhum cliente operou neste
mês").

## 10. Testes

Em `backend/test/`, contra as funções puras — sem banco:

**`lib/metrics`:**
- Semana que atravessa a virada (29/06–05/07) cai em julho, pelo `periodo_fim`.
- Sem `periodo_fim`, usa `periodo_ini`; sem os dois, `criado_em`.
- `ratios` recalcula da soma: duas semanas com ROAS 2x e 8x e investimentos
  diferentes **não** dão 5x.
- Denominador zero devolve `null`, não `Infinity` nem `0`.

**`lib/monthlyClosing`:**
- Conta com relatório no mês entra mesmo já encerrada hoje.
- Conta criada depois do mês não entra.
- Conta encerrada antes do mês não entra.
- Conta ativa sem relatório no mês entra, zerada e sinalizada.
- Totais do cliente somam os das contas, com as razões recalculadas do total.
- Meta vazia devolve `atingiu: null`, nunca `false`.
- ROAS abaixo da meta → `false`; ACOS **abaixo** da meta → `true` (teto).
- Resumo conta fechados, pendentes e sem-relatório corretamente.

## 11. Fora de escopo

- Rateio de relatório entre dois meses (seção 3).
- Snapshot/congelamento dos números (seção 7).
- Exportar o fechamento em PDF ou planilha.
- Fechamento em lote ("fechar todos os que bateram meta").
