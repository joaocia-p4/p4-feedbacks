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
tem. O card deixa de sinalizar atraso: isso já é coberto pelo KPI "Atrasados" e
pela lista "Relatórios em atraso", ambos na mesma página.

Decisões tomadas no brainstorming:

1. **Substituir e evoluir** o card existente, em vez de criar um quinto card
   quase idêntico ao lado.
2. **Ativo é uma fatia só**, atrasado ou não. Atraso é assunto do KPI
   "Atrasados" e da lista "Relatórios em atraso"; este card responde
   *composição da base*, não *cumprimento de prazo*. O backend continua
   devolvendo `emDia` e `atrasado` separados — ver seção 7.
3. **A forma é um anel (pizza vazada) por analista** — small multiples. Isso
   substitui a versão anterior em barras empilhadas.
4. **Encerrados entram dentro do anel**, como quinta fatia. Na versão em barras
   eles ficavam de fora para que churn antigo não inflasse a barra e
   distorcesse a comparação entre gestores; num small multiple cada anel é
   normalizado no próprio total, então essa distorção não existe e a razão para
   mantê-los fora cai.

## 2. Escopo do "encerrado" no painel

A exclusão de encerrados na entrada de `getDashboard` **permanece** para todo o
resto: KPIs, ROAS médio, faturamento, entrada por mês, clientes por marketplace,
métricas por analista e a lista "Relatórios em atraso".

Somente a agregação por gestor passa a ler da lista completa (`allClients`).

Consequência aceita e explícita: o número no miolo do anel (`total`, que inclui
encerrados) **não bate** com o KPI "Clientes" do topo, que segue contando só a
carteira viva. O card distingue os dois na rotulagem — o miolo traz o total e
logo abaixo do nome do analista aparece "N na carteira", que é o número
comparável ao KPI.

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

- `ativos` = `emDia + atrasado` — a fatia que o anel desenha
- `carteira` = `ativos + onboarding + pausado`
- `total` = `carteira + encerrado`

`emDia` e `atrasado` seguem no payload mesmo sem serem desenhados: são a matéria
prima da tela dedicada (seção 7) e não custam nada para carregar.

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

Componente novo no `p4-cs-dashboard.jsx` (`ManagerDonuts` + `Donut`),
substituindo o uso de `HBars` nesse card. `HBars` continua existindo — o card
"Clientes por marketplace" ainda o usa.

### 4.1 Forma: small multiples de anel

Um **anel (pizza vazada) por analista**, em grade responsiva
(`repeat(auto-fill, minmax(248px, 1fr))`). Cada anel é uma parte-do-todo com
**4 fatias no máximo** — confortavelmente dentro do limite de 6 que o dataviz
impõe para pizza/anel.

O anel é a forma pedida. Ela custa a comparação de tamanho entre gestores (todos
os anéis têm o mesmo diâmetro), e é por isso que os números ficam todos escritos:
o total no miolo, a carteira sob o nome e a contagem de cada fatia ao lado.

Como cada anel é normalizado no próprio total, **encerrados voltam para dentro do
gráfico**. A razão de tê-los deixado fora na versão de barras — churn antigo
inflar a barra e distorcer a comparação entre gestores — deixa de existir num
small multiple: a fatia cinza só ocupa espaço dentro do anel do próprio gestor.

```
┌────────────────────────────────────────────────────────────────┐
│ ● ativos   ● onboarding   ● em pausa   ● encerrado             │
│                                                                │
│   ╭────╮  João Pedro         ╭────╮  Mariana                   │
│   │ 18 │  14 na carteira     │ 20 │  11 na carteira            │
│   ╰────╯  ● 12 ativos        ╰────╯  ● 10 ativos               │
│           ●  1 onboarding            ●  1 em pausa             │
│           ●  1 em pausa              ●  9 encerrado            │
│           ●  4 encerrado                                       │
└────────────────────────────────────────────────────────────────┘
```

Um anel por analista precisa de largura, então o card **sai da grade de quatro
cards estreitos** e vira um bloco próprio de largura inteira, logo acima dela —
mesmo tratamento que o bloco "Métricas por analista" já recebe. A grade restante
fica com três cards, que continuam preenchendo bem.

### 4.2 Ordem das fatias — derivada, não escolhida

Numa pizza qualquer fatia encosta na vizinha e o anel ainda fecha (a última toca
a primeira), então o critério de separação de cor vale para o ciclo inteiro — e
não só para a lista, como valeria numa barra.

O par perigoso é `ativos ↔ em pausa`: verde `#22C55E` contra âmbar `#F59E0B` dá
**ΔE 5.7 sob protanopia**, abaixo até do piso de 6, e portanto ilegal mesmo com
codificação secundária. Tons mais escuros não salvam (`#E5484D↔#16A34A` = 1.8;
`#B45309↔#C4353A` = 7.9 até para visão normal).

Com quatro fatias há uma saída limpa: **verde e âmbar em lados opostos do anel**,
onde nunca se tocam. E essa ordem coincide com a ordem semântica:

| # | fatia | cor | vizinhas no anel |
|---|---|---|---|
| 1 | ativos | `--brand` `#22C55E` | encerrado · onboarding |
| 2 | onboarding | `--violet` `#7C5CFC` | ativos · em pausa |
| 3 | em pausa | `--amber` `#F59E0B` | onboarding · encerrado |
| 4 | encerrado | `--muted` `#8A978C` | em pausa · ativos |

Validação com a primeira cor repetida no fim, para forçar o par do fechamento a
entrar na conta:

```
node scripts/validate_palette.js "#22C55E,#7C5CFC,#F59E0B,#8A978C,#22C55E" \
  --mode light --surface "#FFFFFF"

[PASS] Lightness band        all 5 inside L 0.43–0.77
[PASS] CVD separation        pior adjacente #22C55E↔#8A978C ΔE 9.9 (deutan) · tritan 13.2
[PASS] Normal-vision floor   pior adjacente #22C55E↔#8A978C ΔE 18.0 (normal)
```

Pior par adjacente **9.9**, acima do piso de 8. Ainda assim reforçado pelo vão de
2px entre fatias e pelas contagens escritas ao lado de cada anel.

`--pairs all` continua reprovando (5.7 no par verde↔âmbar, agora não-adjacente).
É uma limitação assumida: quem comparar as duas fatias *atravessando* o anel
depende do rótulo, não da cor. Como cada fatia vem com número e nome escritos ao
lado, a informação nunca é exclusiva da cor.

**Esta ordem é uma restrição, não uma preferência.** Reordenar as fatias pode
encostar verde em âmbar e reintroduzir o par de 5.7. O comentário no topo de
`MGR_SEGS` registra isso no código.

**Desvio aceito:** `#8A978C` reprova no piso de croma (0.022) se avaliado como
cor categórica. É intencional — "encerrado" deve ler como cinza recessivo, fora
da base viva, e é o mesmo `--muted` que `.chip.st-closed` e `.stat.closed` já
usam na tela de Clientes. A fatia é grande, tem vão dos dois lados e vem
rotulada, então o risco que o piso protege (confundir dado com cromo do gráfico)
não se aplica.

### 4.3 Especificação das marcas

- Anel de 84px, `r = 38`, espessura 13, sobre trilha `--stage`.
- Cada fatia é um `<circle>` próprio com `stroke-dasharray` — permite `<title>`
  por fatia (tooltip) em vez de um `conic-gradient` opaco.
- Vão de 2.5 unidades de circunferência entre fatias (~2px), **zerado quando há
  uma fatia só**, senão um anel de 100% ganharia um entalhe sem sentido.
- Comprimento mínimo de 1 unidade por fatia, para que um cliente isolado em 40
  não desapareça.
- Miolo: total em mono 17px + "clientes" em 8.5px `--muted`.
- Ao lado: nome do analista (truncado com `title`), "N na carteira", e uma linha
  por fatia não-zerada com bolinha + número + rótulo.
- Fatias zeradas não são desenhadas nem listadas; a legenda no topo do card
  documenta o vocabulário completo.
- Texto sempre em tokens de tinta (`--ink`, `--ink-2`, `--muted`), nunca na cor
  da série.

### 4.4 Card

Título "Clientes por gestor", subtítulo "composição da base de cada analista".
Cada facet carrega `dash-no-break` para não partir no meio na geração do PDF; o
`@media print` do `index.html` já força `print-color-adjust: exact`, então as
fatias saem coloridas na impressão.

## 5. Casos de borda

- **Gestor sem carteira viva, só encerrados** — anel 100% cinza, miolo com o
  total, "0 na carteira". Aparece no fim da lista.
- **Gestor com uma situação só** — anel cheio de uma cor, sem vão (ver 4.3).
- **Cliente sem analista** — agrupa em `—`, como já acontece hoje.
- **Nenhum cliente** — mensagem "sem dados".
- **Analista logado** — vê apenas o próprio anel.

## 6. Testes

Em `backend/test/dashboard-aggregates.test.js`, contra a função pura `byManager`:

- `ativos` junta em dia, "enviar hoje" e atrasado.
- `ativos` **não** inclui onboarding, pausado nem encerrado.
- `emDia` e `atrasado` continuam detalhados no payload, para a tela da seção 7.
- A soma `ativos + onboarding + pausado` é igual a `carteira`, e
  `carteira + encerrado` é igual a `total`.
- Cliente encerrado entra em `encerrado` e **não** vaza para `carteira`.
- Cliente com `statusTag === 'hoje'` é contado em `emDia`.
- Cliente sem analista cai no grupo `—`.
- Um cliente de cada `statusTag` cai na fatia correspondente.
- Gestor que só tem clientes encerrados aparece na lista com `carteira === 0`.
- A ordenação é por `carteira` desc, com desempate por `total` e por nome.
- Os campos legados `clients`/`overdue` continuam com o valor de antes.

## 7. Fora de escopo — a tela dedicada

Está combinado que a composição da base ganha **uma tela própria** depois. Este
card fica sendo o resumo do painel; o detalhamento (incluindo a quebra de
`ativos` em em dia / atrasado, que o payload já carrega) vai para lá.

Nada aqui foi desenhado para essa tela ainda. O que este spec deixa pronto para
ela: `byManager` é uma função pura, testada e independente de HTTP — a tela nova
consome a mesma agregação sem duplicar regra de status.
