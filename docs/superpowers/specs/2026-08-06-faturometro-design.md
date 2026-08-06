# Design — Faturômetro

**Data:** 2026-08-06
**Componente:** Backend (`backend/`) + Frontend (`design_handoff_sistema_feedbacks/`)
**Status:** Aprovado — pronto para plano de implementação

## 1. Contexto e objetivo

O sistema já conecta contas do Mercado Livre via OAuth (`meli_connections`) e já
sabe somar faturamento de um período pela API de Pedidos
(`meliService.ordersTotals`), mas só sob demanda, uma conta por vez, para
preencher relatório.

O **Faturômetro** responde uma pergunta que hoje ninguém consegue responder:
**quanto a carteira inteira está faturando agora**. Um número grande, ao vivo,
somando todos os clientes conectados, com a lista de quem está puxando esse
número.

Referência visual: a tela "Vendas de hoje ao vivo" do próprio Mercado Livre —
com a diferença de que a dele é de **um** vendedor e a nossa é da **carteira**.

## 2. Escopo

**No escopo**

- Tela nova `Faturômetro` no menu lateral, **exclusiva para `admin`**.
- Número grande de **hoje** ao vivo, com relógio correndo e comparação com ontem
  no mesmo horário.
- Card **Métricas-chave** (grade 2×3): Vendas · Compradores · Unidades ·
  Preço médio · Mês até agora · vs mês passado.
- Gráfico **Tendências em vendas brutas**: curva por hora, Hoje × Ontem,
  somando a carteira.
- **Lista por cliente**, ordenada pelo faturamento de hoje.
- **Webhook `orders_v2`** do Mercado Livre alimentando o número em tempo real.
- **Reconciliação** via API de Pedidos como rede de proteção.
- **Backfill** progressivo do mês corrente e do anterior, em segundo plano.

**Fora do escopo (YAGNI)**

- SSE / WebSocket (a tela usa polling de 30s).
- Ping externo / cron para manter o Render acordado.
- Visitas e conversão (exigem outro endpoint do ML, ~1 chamada por conta por
  atualização, e a API pública devolve visitas **totais**, não únicas — o número
  não bateria com o painel do ML).
- Outros marketplaces (Shopee, Amazon…). A modelagem é por `account_id`, então
  cabe depois sem refazer nada.
- Alertas de queda / notificação.
- Alimentar o `monthly_figures` do Fechamento automaticamente.
- Metas / objetivo de faturamento na tela.

## 3. Decisões tomadas no brainstorming

| Tema | Decisão |
|---|---|
| Pergunta principal | Quanto a carteira faturou **hoje** (total grande + lista por cliente) |
| Recortes | Hoje **e** mês até agora, ambos com comparação |
| Atualização | **Webhook do ML** (tempo real de verdade) |
| Hibernação do Render | **Sem ping externo** — reconciliação quando a tela é aberta |
| Contas na soma | Todas conectadas, **exceto clientes Encerrados** |
| Definição de faturamento | **Bruto**, igual ao relatório (todo pedido criado, sem filtrar status) |
| Tela ao vivo | **Polling de 30s** (não SSE) |
| Armazenamento | **Livro de pedidos** (uma linha por pedido, id do ML como chave) |
| Escala | 40+ contas conectadas → backfill obrigatoriamente em lotes |
| Métricas-chave | Só as que saem dos pedidos (sem visitas/conversão) |

## 4. Arquitetura — como o dado entra

Três caminhos alimentam a **mesma** tabela de pedidos. Todos são idempotentes,
porque a chave é o `order_id` do Mercado Livre: gravar o mesmo pedido duas vezes
atualiza a linha, nunca soma de novo.

### 4.1 Webhook (tempo real)

O endpoint `POST /integrations/mercadolivre/notifications` já existe e hoje só
responde 200. Passa a:

1. Responder **200 imediatamente** — o ML espera resposta em ~500ms; processar
   antes de responder causaria reenvios em cascata.
2. Em seguida (fora do ciclo da resposta): se `topic === 'orders_v2'`, mapear
   `user_id` → conta via `meli_connections.ml_user_id`.
3. `GET /orders/{id}` com o token daquela conta e gravar/atualizar a linha no
   livro, mais o recálculo do dia em `faturometro_daily`.

Tópico diferente, `user_id` sem conexão ou pedido que não volta: responde 200 e
ignora — reenviar não resolveria nada.

### 4.2 Reconciliação (rede de proteção)

Como não há ping externo, o Render hiberna e perde notificações. Toda chamada de
`GET /faturometro` dispara, **em segundo plano**, a reconciliação das contas cuja
última conferência passou de **10 minutos**, no máximo **5 contas por ciclo**
(rodízio pela mais antiga). Cada reconciliação rebusca o **dia de hoje** daquela
conta via API de Pedidos, regrava o livro e recalcula a linha do dia em
`faturometro_daily`.

O rodízio é o que torna isso viável com 40+ contas: sem ele, abrir a tela
dispararia 40 varreduras simultâneas. Com polling de 30s, o rodízio cobre todas
as contas em poucos minutos.

### 4.3 Backfill (histórico)

Mês corrente e anterior precisam vir da API, dia a dia. Com 40+ contas × ~60 dias
são **alguns milhares de chamadas** na primeira execução — então roda em fila, em
segundo plano, com progresso salvo em `faturometro_sync` para retomar depois de
uma hibernação.

Ordem de prioridade:

1. **Hoje**, todas as contas → a tela já fica útil.
2. **Mês corrente**, do dia mais recente para o mais antigo.
3. **Mês anterior**, idem.

A tela mostra o que já está pronto e exibe "montando histórico… 62%". O
progresso é a fração de pares (conta, dia) já preenchidos sobre o total alvo,
derivada de `faturometro_sync.backfill_dia` de cada conta.

**Expurgo:** na primeira chamada de `GET /faturometro` de cada dia, o mesmo
processo de segundo plano apaga os pedidos com mais de 70 dias.

**Por que o histórico é buscado uma vez só:** faturamento bruto pela **data de
criação** do pedido não muda retroativamente. Dia fechado é imutável.

## 5. Modelo de dados

> Ids vão como `t.string`, **nunca** `t.uuid` — no Postgres a coluna nativa
> quebraria a FK contra o `varchar` de `accounts.id` e derrubaria o boot, como já
> está anotado em `20260726000001_monthly_figures.js`.

### `faturometro_orders` — o livro

| Coluna | Tipo | Papel |
|---|---|---|
| `order_id` | string, PK | Id do pedido no ML. É o que torna tudo idempotente |
| `account_id` | string, FK `accounts` (cascade) | |
| `dia` | string `'YYYY-MM-DD'` | Data de criação **em São Paulo** |
| `criado_em_ml` | string ISO | Timestamp do pedido — dá a curva por hora e o corte "até o mesmo horário" |
| `total_amount` | decimal(14,2) | |
| `unidades` | integer | Σ `quantity` dos `order_items` |
| `comprador_id` | string | Alimenta "Total de compradores" |
| `atualizado_em` | string ISO | |

Índices: `(account_id, dia)` e `(dia)`.
**Expurgo:** pedidos com `dia` anterior a 70 dias são apagados. 70 dias cobrem
com folga o dia equivalente do mês anterior (no pior caso, 31 dias atrás).

### `faturometro_daily` — o consolidado

| Coluna | Tipo |
|---|---|
| `id` | string, PK |
| `account_id` | string, FK `accounts` (cascade) |
| `dia` | string `'YYYY-MM-DD'` |
| `faturamento` | decimal(14,2) |
| `unidades` | integer |
| `pedidos` | integer |
| `atualizado_em` | string ISO |

`unique(account_id, dia)`. Recalculado a partir do livro sempre que um pedido
daquele dia entra ou muda. Sobrevive ao expurgo — o histórico não se perde, só a
granularidade por hora.

### `faturometro_sync` — estado por conta

| Coluna | Papel |
|---|---|
| `account_id` | string, PK, FK `accounts` (cascade) |
| `backfill_dia` | dia mais antigo já preenchido (`null` = nunca rodou) |
| `backfill_status` | `'pendente' \| 'rodando' \| 'pronto'` |
| `reconciliado_em` | ISO da última conferência de hoje |
| `erro` | último erro (ex.: token expirado); `null` quando a última chamada deu certo |
| `atualizado_em` | ISO |

## 6. Regras de cálculo

**Fuso:** tudo em America/São_Paulo (`-03:00` fixo, igual ao `ordersTotals`
atual). O `dia` de um pedido é a data da sua criação convertida para SP.

**Faturamento:** Σ `total_amount` de todos os pedidos criados no recorte, **sem
filtrar status** — mesma definição do relatório, para não existirem dois números
de faturamento no sistema.

**De onde vem cada número:**

- Métricas de **hoje** e a curva por hora → do **livro** (hoje e ontem estão
  sempre dentro da janela de 70 dias).
- Totais do **mês** → do **consolidado** (`faturometro_daily`), somando os dias.

**Definições exatas:**

- `Preço médio` = faturamento ÷ **unidades** (não ÷ pedidos).
- `Compradores` = `COUNT(DISTINCT comprador_id)` dos pedidos de hoje no escopo.
- `Ontem até agora` = Σ dos pedidos de ontem cujo horário local é ≤ o horário
  atual. É o que impede a tela de mostrar queda toda manhã por comparar meio dia
  contra um dia inteiro.
- `Mês até agora` = Σ do consolidado, dia 1 até hoje (hoje incluso e parcial).
- `Mês anterior até agora` = Σ do consolidado do mês anterior, dia 1 até
  `D-1`, **mais** o parcial do dia `D` do mês anterior (do livro, cortado pelo
  horário atual), onde `D` é o dia do mês de hoje.
  - Borda: se o mês anterior não tem o dia `D` (hoje é 31, mês anterior tem 30),
    compara com o **mês anterior inteiro** e a tela rotula "vs julho inteiro".
- `Variação` = (atual − anterior) ÷ anterior. Anterior igual a zero → a tela
  mostra "—", não "+∞".

**Escopo da soma:** contas com conexão ativa cujo cliente **não** está
Encerrado. Pausado e Onboarding continuam somando — o cliente segue faturando
mesmo sem relatório no período.

## 7. API

### `GET /faturometro` — admin

Responde **direto do banco**, sem esperar nada do Mercado Livre, e dispara
reconciliação/backfill em segundo plano. Com polling de 30s, a correção entra no
ciclo seguinte sem ninguém perceber.

```json
{
  "agora": "2026-08-06T10:45:28-03:00",
  "hoje": {
    "faturamento": 4836.89, "pedidos": 21, "unidades": 22,
    "compradores": 20, "precoMedio": 219.86,
    "ontemAteAgora": 4098.20, "variacao": 0.18
  },
  "mes": {
    "ym": "2026-08", "faturamento": 210490.00,
    "anteriorAteAgora": 193100.00, "variacao": 0.09,
    "anteriorParcial": true
  },
  "porHora": [{ "h": 0, "hoje": 320.0, "ontem": 410.5 }],
  "contas": { "conectadas": 43, "comErro": 2 },
  "backfill": { "pronto": false, "progresso": 0.62, "etapa": "mês anterior" },
  "clientes": [
    {
      "clienteId": "...", "cliente": "Acme", "contas": 1,
      "hoje": 1240.50, "mes": 38200.00, "variacaoMes": 0.12, "erro": null
    }
  ]
}
```

`anteriorParcial: false` sinaliza a borda do dia inexistente (rótulo "vs mês
inteiro").

### `POST /faturometro/reconciliar` — admin

Enfileira a reconciliação de **todas** as contas ignorando a janela de 10 min e
responde na hora — com 40+ contas, esperar a fila terminar estouraria o tempo da
requisição. Botão explícito na tela; o resultado chega no polling seguinte.

### Webhook

O `POST /integrations/mercadolivre/notifications` existente ganha o
processamento de `orders_v2` descrito em 4.1. A rota continua pública e
continua respondendo 200 para tudo.

## 8. Tela

Nova `p4-faturometro.jsx`, item no `Sidebar` de `p4-shell.jsx` visível só para
`admin`.

**Faixa herói** — verde da marca (`--brand: #22C55E`), não o amarelo do ML.
Título "Vendas de hoje ao vivo", pílula com data e relógio correndo em segundos,
e o cartão branco elevado com o número grande (Sora, peso 800, tamanho fluido
via `clamp`). Abaixo: "vs ontem até 10:45 · +18%".

O pontinho ao vivo é **sólido, sem pulsar**: a base de UX é explícita que
animação infinita distrai e deve ficar restrita a carregamento. O relógio
correndo já comunica "isto está vivo"; a animação fica reservada para a
transição do número quando ele muda (~600ms).

**Faixa de contexto** logo abaixo do herói: "43 contas conectadas · 2 precisam
reconectar", com o segundo trecho em âmbar e clicável, rolando a página até os
clientes com problema. É o que impede o total de mentir em silêncio quando uma
conexão quebra.

**Métricas-chave** — grade 2×3 à esquerda, mesma anatomia do print de
referência: Vendas · Compradores · Unidades · Preço médio · Mês até agora ·
vs mês passado. Números com separador de milhar.

**Tendências em vendas brutas** — SVG desenhado à mão, no padrão do
`MiniLineChart` de `report.jsx`; sem biblioteca nova (o front não tem build
step). Hoje em verde sólido com área a 20%, parando na hora atual com o ponto
destacado; Ontem em cinza **tracejado**, dia completo. As séries se distinguem
por **estilo de linha, não só por cor** — é o que mantém o gráfico legível para
daltônicos. Eixo X de 00 a 23h; hover mostra a hora e os dois valores.

**Lista por cliente** — largura total, ordenada pelo faturamento de hoje.
Colunas: Cliente · Hoje · Mês · vs mês passado. Quem não vendeu hoje vai para o
fim, zerado e em cinza. Cliente com 2+ contas ML aparece somado, com o rótulo
"2 contas" e detalhe ao expandir. Clicar leva para o Histórico do cliente.

**Polling** de 30s, pausado quando a aba perde o foco (`document.hidden`).

**Estados:**

| Estado | Comportamento |
|---|---|
| Nenhuma conta conectada | Estado vazio explicando que é preciso conectar contas do ML |
| Montando histórico | Barra de progresso + "montando histórico… 62%"; os números prontos já aparecem |
| Backend sem responder | Selo cai para âmbar "atualizado às 14:32" e segura o último número |
| Zero vendas hoje | `R$ 0,00`. É resposta legítima, não erro |
| Conta com erro | Chip âmbar "reconectar" na linha do cliente, com link para a tela dele |

## 9. Erros e casos de borda

- **Conta com token expirado:** o erro fica em `faturometro_sync.erro`, a linha
  do cliente ganha o chip "reconectar" e a faixa de contexto do topo mostra
  "43 contas conectadas · 2 precisam reconectar".
  **O que já foi faturado hoje continua somando** — é receita que
  realmente aconteceu, e zerá-la faria o total *cair* na hora em que o token
  quebra, o que confunde mais do que informa. O aviso no topo é o que impede o
  número de mentir em silêncio.
- **Webhook de conta desconhecida ou tópico diferente:** 200 e ignora.
- **Pedido cancelado depois:** continua somando (definição bruta, igual ao
  relatório).
- **Pedido às 23h50 de São Paulo:** cai no dia de SP, não no dia UTC.
- **Cliente Encerrado:** fora da soma e fora da lista.
- **ML fora do ar na reconciliação:** mantém o último valor, grava o erro e o
  selo de frescor vira âmbar.
- **Anterior igual a zero na variação:** mostra "—".
- **Duas contas ML do mesmo cliente:** somadas na linha do cliente.

## 10. Testes

`node --test`, no padrão dos cinco arquivos que já existem em `backend/test/`,
com o `fetch` do Mercado Livre mockado — nenhuma chamada real.

- Notificação repetida do mesmo pedido **não dobra** o número.
- Notificação de **update** de um pedido corrige o valor, não soma por cima.
- `user_id` sem conexão → responde 200 e não grava nada.
- Tópico diferente de `orders_v2` → 200 e ignora.
- Pedido às 23h50 em SP cai no dia certo (virada de fuso).
- "Ontem até agora" corta pelo horário atual.
- Mês anterior sem o dia equivalente → cai na regra do mês inteiro.
- Cliente Encerrado fica fora da soma; conta com erro continua somando o que já
  tinha e aparece em `comErro`.
- Reconciliação repõe um pedido que o webhook perdeu.
- Agregação por hora bate com a soma do dia.
- Expurgo de 70 dias não altera os totais do consolidado.

## 11. Pré-requisito manual

A integração só recebe notificações se o app do Mercado Livre estiver **inscrito
no tópico `orders_v2`** no painel de aplicações. A URL de notificações já está
configurada (a rota existe desde a integração original), mas **sem essa
inscrição nenhuma notificação chega** e o Faturômetro só se atualiza pela
reconciliação. Passo a fazer no painel do ML antes de publicar.

## 12. Arquivos afetados

**Novos**

- `backend/src/db/migrations/20260806000001_faturometro.js`
- `backend/src/services/faturometroService.js` — leitura e agregação
- `backend/src/lib/faturometroSync.js` — webhook, reconciliação, backfill
- `backend/src/routes/faturometro.js`
- `backend/test/faturometro.test.js`
- `design_handoff_sistema_feedbacks/p4-faturometro.jsx`

**Alterados**

- `backend/src/services/meliService.js` — ganha `ordersOfDay()` devolvendo os
  pedidos crus; o `ordersTotals()` atual passa a somar em cima dela, sem uma
  segunda varredura. O arquivo já está com ~480 linhas, então a lógica do
  Faturômetro fica fora dele.
- `backend/src/routes/integrations.js` — processamento de `orders_v2` no webhook
- `backend/src/app.js` — registra a rota
- `design_handoff_sistema_feedbacks/p4-api.js` — `getFaturometro()` e
  `reconciliarFaturometro()`
- `design_handoff_sistema_feedbacks/p4-shell.jsx` — item no Sidebar (só admin) e
  rota da tela
- `design_handoff_sistema_feedbacks/index.html` — CSS da tela e o novo `<script>`
