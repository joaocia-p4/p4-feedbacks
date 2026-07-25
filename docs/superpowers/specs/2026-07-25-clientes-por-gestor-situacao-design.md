# Design — Clientes por gestor, quebrado por situação

**Data:** 2026-07-25
**Componentes:** Backend (`dashboardService`) + Painel CS (`p4-cs-dashboard.jsx`).
**Status:** Aprovado — pronto para plano de implementação.

## 1. Contexto e objetivo

O Painel CS tem hoje o card **"Clientes por gestor"** (`p4-cs-dashboard.jsx`, via
`HBars`) que mostra apenas **total + atrasados** por gestor. O backend
(`dashboardService.getDashboard`) descarta **todos os clientes encerrados** logo
na entrada, antes de qualquer cálculo.

Objetivo: transformar esse card em uma leitura completa da carteira de cada
gestor — quantos clientes **ativos, encerrados, em onboarding e em pausa** ele
tem — mantendo o alerta de atraso que o card já dá hoje.

Decisões tomadas no brainstorming:

1. **Substituir e evoluir** o card existente, em vez de criar um quinto card
   quase idêntico ao lado.
2. **Ativos aparecem subdivididos** em *em dia* e *atrasado*. "Atrasado" não é
   uma situação contratual, é um cliente ativo que está atrasado — então vira uma
   subdivisão da fatia de ativos, não uma quinta categoria fora do total.
3. **Encerrados ficam em trilha própria**, fora da barra da carteira viva. Assim
   um gestor com muito churn antigo não fica com a maior barra do gráfico.

## 2. Escopo do "encerrado" no painel

A exclusão de encerrados na entrada de `getDashboard` **permanece** para todo o
resto: KPIs, ROAS médio, faturamento, entrada por mês, clientes por marketplace,
métricas por analista e a lista "Relatórios em atraso".

Somente a agregação por gestor passa a ler da lista completa (`allClients`).

Consequência aceita e explícita: o somatório de `carteira + encerrado` do card
**não bate** com o KPI "Clientes" do topo, que segue contando só a carteira viva.
O card sinaliza isso na própria rotulagem — a barra viva é rotulada
"na carteira" e os encerrados aparecem numerados à parte, nunca somados ao mesmo
número.

## 3. Agregação por gestor (`backend/src/services/dashboardService.js`)

Substitui o bloco "clientes por gestor" atual. Itera sobre `allClients`
(inclui encerrados), agrupando por `c.analista || '—'`.

Cada entrada acumula, a partir do `statusTag` já calculado por
`lib/clientAggregate.js` (precedência Encerrado > Pausado > Onboarding >
Atrasado > Enviar hoje > Em dia, ver [[status-tags-pausado-onboarding-hoje]]):

| campo | condição |
|---|---|
| `emDia` | `statusTag === 'em-dia' \|\| statusTag === 'hoje'` |
| `atrasado` | `statusTag === 'atrasado'` |
| `onboarding` | `statusTag === 'onboarding'` |
| `pausado` | `statusTag === 'pausado'` |
| `encerrado` | `statusTag === 'encerrado'` |

Derivados:

- `carteira` = `emDia + atrasado + onboarding + pausado`
- `total` = `carteira + encerrado`

Nenhuma regra de status nova é escrita. O card consome exatamente a mesma
classificação que a tela de Clientes mostra nas tags, o que impede as duas telas
de divergirem.

**Compatibilidade:** os campos `clients` e `overdue` continuam no payload
(`clients = carteira`, `overdue = atrasado`), para não quebrar nenhum consumidor
existente de `clientsByManager`.

**Ordenação:** `carteira` desc; empate por `total` desc; empate por nome asc
(ordem estável e determinística).

**Escopo por papel:** `clientService.listClients(user, {})` já filtra por
`analista_id` quando `user.papel === 'analista'`. Um analista vê só a própria
linha. Nenhuma lógica de permissão nova.

## 4. Visual — card "Clientes por gestor"

Componente novo no `p4-cs-dashboard.jsx` (`ManagerStatusBars`), substituindo o
uso de `HBars` nesse card. `HBars` continua existindo — o card "Clientes por
marketplace" ainda o usa.

### 4.1 Anatomia da linha

Duas trilhas separadas por um divisor vertical:

```
● em dia   ● atrasado   ● onboarding   ● pausa        │  ▨ encerrado

João Pedro                    14 na carteira          │        4
████████████ ███ ▓ ▒                                  │  ▨▨▨▨
9 em dia · 3 atrasado · 1 onboarding · 1 pausa        │

Mariana                       11 na carteira          │        9
██████████ ▒                                          │  ▨▨▨▨▨▨▨▨▨
10 em dia · 1 pausa                                   │
```

- **Trilha da carteira** (esquerda, ~72% da largura da linha) — escalada por
  `max(carteira)` entre os gestores.
- **Trilha de encerrados** (direita, ~22%, separada por um divisor de 1px) —
  escalada por `max(encerrado)` entre os gestores.

As duas trilhas têm **escalas independentes**. Isso não é um gráfico de eixo
duplo: são dois mini-gráficos justapostos, separados por um divisor — a
alternativa explicitamente sancionada pelo dataviz quando duas medidas têm
grandezas diferentes. A leitura pretendida é *coluna contra coluna* (compare
carteiras na esquerda, compare churn na direita), nunca *trilha contra trilha
dentro da mesma linha*. Como as contagens ficam sempre visíveis em texto, a
leitura não depende da comparação entre trilhas.

### 4.2 Cores

Ordem **fixa**, nunca ciclada, idêntica às tags de status da tela de Clientes e
aos chips de filtro:

| fatia | token | hex |
|---|---|---|
| em dia | `--brand` | `#22C55E` |
| atrasado | `--red` | `#E5484D` |
| onboarding | `--violet` | `#7C5CFC` |
| pausa | `--amber` | `#F59E0B` |
| encerrado | `--muted` @ ~45% | `#8A978C` |

Validação (`dataviz/scripts/validate_palette.js`, light, surface `#FFFFFF`), nas
4 cores da barra viva:

```
[PASS] Lightness band       all 4 inside L 0.43–0.77
[PASS] Chroma floor         all 4 >= 0.1
[PASS] CVD separation       pior par #E5484D↔#22C55E ΔE 8.4 (deutan) · tritan 27.4
[PASS] Normal-vision floor  pior par #7C5CFC↔#E5484D ΔE 31.5
[WARN] Contraste vs surface #22C55E 2.28 · #F59E0B 2.15 (< 3:1)
→ ALL CHECKS PASS
```

Dois pontos de atenção e como são resolvidos:

- **ΔE 8.4 no par em dia↔atrasado (deuteranopia)** passa, mas é o pior par e os
  dois segmentos são adjacentes na barra. Aliviado pelo gap de 2px entre
  segmentos, pela legenda e pelas contagens em texto — a identidade nunca depende
  só da cor.
- **WARN de contraste** obriga rótulos visíveis. Temos legenda no topo e
  contagens por linha, o que satisfaz a exigência.

`--muted` reprova no piso de croma se avaliado como cor categórica — o que é
intencional: encerrado deve ler como cinza recessivo, está fora da paleta
categórica e fica em trilha fisicamente separada, não adjacente às outras.

### 4.3 Especificação das marcas

- Altura da trilha: 12px.
- Gap de 2px na cor da superfície entre segmentos adjacentes.
- Cantos 4px apenas nas pontas externas de cada trilha.
- `title` por segmento (ex.: `"Atrasado: 3"`), no mesmo padrão de `VBars`/`HBars`.
- Legenda uma vez no topo do card, com bolinha + rótulo por categoria.
- Contagens por linha em 11px `--muted`, listando **apenas** categorias não-zeradas.
- Nome do gestor e total da carteira na linha de cabeçalho da barra.

### 4.4 Card

Título "Clientes por gestor", subtítulo "carteira por situação · encerrados à
parte". Mantém `dash-no-break` para não quebrar no PDF; o `@media print` do
`index.html` já força `print-color-adjust: exact`, então as fatias saem coloridas
na impressão.

## 5. Casos de borda

- **Gestor sem carteira viva, só encerrados** — aparece no fim da lista, trilha
  da esquerda vazia, trilha de churn preenchida.
- **Cliente sem analista** — agrupa em `—`, como já acontece hoje.
- **Nenhum encerrado em nenhum gestor** — a coluna da direita, seu divisor e sua
  legenda somem inteiros; o card degrada para um gráfico de barras simples.
- **Nenhum cliente** — mensagem "sem dados", como o `HBars` atual já faz.
- **Analista logado** — vê apenas a própria linha.

## 6. Testes

Em `backend/test/`, ao lado de `atraso.test.js` e `update-client.test.js`:

- A soma `emDia + atrasado + onboarding + pausado` é igual a `carteira`, e
  `carteira + encerrado` é igual a `total`.
- Cliente encerrado entra em `encerrado` e **não** vaza para `carteira`.
- Cliente com `statusTag === 'hoje'` é contado em `emDia`.
- Cliente sem analista cai no grupo `—`.
- Um cliente de cada `statusTag` cai na fatia correspondente.
- Gestor que só tem clientes encerrados aparece na lista com `carteira === 0`.
- Os demais números do painel (KPI `totalClients`, lista `overdue`) **não mudam**
  ao existirem clientes encerrados — protege a decisão da seção 2.
