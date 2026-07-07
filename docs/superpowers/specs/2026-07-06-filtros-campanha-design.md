# Design — Filtros de campanha no relatório

**Data:** 2026-07-06
**Componente:** Gerador de Relatório (`design_handoff_sistema_feedbacks/`)
**Status:** Aprovado (abordagem A) — pronto para plano de implementação

## 1. Contexto e objetivo

As campanhas de Ads de um relatório vivem em `d.campanhas[]` e são renderizadas
em `CampaignsPage` (`report.jsx`), hoje já ordenadas por ROAS (melhor → pior). O
único "filtro" atual remove linhas sem nome **e** sem investimento.

O usuário quer **controle total**: filtros combináveis, configurados no gerador,
que afetam o **PDF impresso**. Objetivo: deixar o analista enxugar/priorizar as
campanhas que entram no relatório sem editar/apagar dados.

## 2. Escopo

**No escopo**
- Três filtros combináveis (AND): investimento mínimo, ROAS mínimo, só novas/alteradas.
- **Ordenação selecionável** das campanhas no PDF (ROAS ↓/↑, Investimento ↓/↑,
  Faturamento ↓, Nome A–Z; default ROAS ↓).
- Controles num sub-bloco ("Exibição das campanhas") dentro da seção "Campanhas de
  Ads" do formulário.
- Configuração (filtros + ordenação) salva **por relatório**, no payload (sem
  mudança de backend).
- Campanhas filtradas **somem do PDF sem nota** (decisão do usuário).

**Fora do escopo (YAGNI)**
- Limite "top N campanhas".
- Filtros por orçamento/faturamento/ACOS/TACOS.
- Presets prontos (Todas / Relevantes / etc.).
- Qualquer nota/listagem das ocultadas no PDF.

## 3. Modelo de dados

Novo campo no objeto do relatório (`d`):

```js
d.campanhasFiltro = {
  investMin: '',    // BRL string "50,00" | '' (sem filtro)
  roasMin:   '',    // string "3,00"     | '' (sem filtro)
  soNovas:   false, // boolean
}
d.campanhasOrdem = 'roasDesc'; // roasDesc | roasAsc | investDesc | investAsc | fatDesc | nome
```

Constante default em `app.jsx`:

```js
const CAMP_FILTRO_DEFAULT = { investMin: '', roasMin: '', soNovas: false };
```

> **Nota sobre a UI de seleção (seção 6):** o seletor "Filtrar por" + chips é apenas
> uma camada de apresentação sobre estes três campos — cada dimensão é única, então
> "adicionar Investimento" só grava `investMin`, e o chip some ao limpar o campo. Um
> filtro está **ativo** quando seu campo é não-vazio (`investMin`/`roasMin`) ou
> `true` (`soNovas`). O modelo de dados e os predicados (seções 4–5) não mudam.

**Persistência**
- Incluído em `EMPTY` e `DEFAULTS` com o default acima → comportamento atual
  preservado (nenhuma campanha some enquanto os filtros estiverem vazios).
- Salvo junto no payload: `localStorage['p4-report']` e `createReport` (o schema
  do backend usa `.passthrough()`, então aceita e preserva o campo — **sem
  mudança de schema**).
- `fullRestore(imp)` já preserva via spread; garantir `campanhasFiltro` presente
  com fallback ao default.
- `rollForward(imp)` **carrega os filtros para o próximo período**
  (`imp.campanhasFiltro || CAMP_FILTRO_DEFAULT`) — os filtros continuam de uma
  semana para a outra.
- `reset()` (limpar período atual) **mantém** `campanhasFiltro`, como já faz com
  as metas (é preferência de exibição, não dado do período).

## 4. Semântica dos filtros

Predicado por campanha, aplicado **depois** do filtro-base (nome/investimento
presentes) e **antes** da ordenação por ROAS e da paginação. Combináveis via AND;
campo vazio/zero/`false` = filtro inativo.

- **Investimento mínimo:** se `parseNum(filtro.investMin) > 0`, manter só
  `parseNum(c.investimento) >= investMin`.
- **ROAS mínimo:** se `parseNum(filtro.roasMin) > 0`, manter só
  `campRoasNum(c) >= roasMin`. (`campRoasNum` deriva `fat/inv` quando `roas` não
  vem; sem ROAS calculável retorna `-1` → sai quando `roasMin > 0`.)
- **Só novas/alteradas:** se `filtro.soNovas`, manter só
  `c.novo || (c.mudancas && c.mudancas.length)`.

### Fonte única de verdade (predicados exportados)

Em `report.jsx`, expor via `window` (como os demais helpers) duas funções puras,
reusadas pelo relatório **e** pela dica do formulário:

```js
// já existe hoje (mantido): base — tem conteúdo suficiente para aparecer
function campanhaTemConteudo(c) {
  return String(c.nome || '').trim() || String(c.investimento || '').trim();
}
// novo: passa nos filtros do usuário
function campanhaPassaFiltro(c, filtro) {
  if (!filtro) return true;
  const invMin = parseNum(filtro.investMin);
  if (invMin > 0 && parseNum(c.investimento) < invMin) return false;
  const roasMin = parseNum(filtro.roasMin);
  if (roasMin > 0 && campRoasNum(c) < roasMin) return false;
  if (filtro.soNovas && !(c.novo || (c.mudancas && c.mudancas.length))) return false;
  return true;
}
```

## 5. Aplicação no relatório (`CampaignsPage`)

```js
const filtro = d.campanhasFiltro || null;
const all = (d.campanhas || [])
  .filter(campanhaTemConteudo)
  .filter((c) => campanhaPassaFiltro(c, filtro))
  .slice()
  .sort((a, b) => campRoasNum(b) - campRoasNum(a));
if (!all.length) return null;
```

- O contador do cabeçalho ("N ativa(s)") usa `all.length` (já é assim), então
  reflete só o que é exibido — sem contradição com a lista impressa.
- Se os filtros zerarem tudo, `all.length === 0` → a página de campanhas some
  inteira (consistente com "sumir totalmente"). O analista percebe no preview e
  afrouxa o filtro.

## 6. UI no formulário — "Exibição das campanhas" (ordenar + filtrar)

Sub-bloco compacto no topo do corpo da seção **"Campanhas de Ads"** (`app.jsx`),
acima do botão "Puxar campanhas ativas" / dos cards. Primeiro a **ordenação**
(dropdown de largura cheia), depois o seletor de **filtros**. Layout:

```
Exibição das campanhas (PDF)
Ordenar por: [ ROAS (maior → menor) ▾ ]
┌───────────────────────────────┐
│ Filtrar por: [ Investimento ▾]│
│ Valor mín.:  [ R$ 50,00      ]│
│              [ + adicionar ]  │
└───────────────────────────────┘
Ativos:  Invest ≥ R$ 50  ×    ROAS ≥ 3x  ×
2 ocultada(s) do PDF
```

**Componentes**
- Rótulo: **"Exibição das campanhas (PDF)"**.
- **Dropdown "Ordenar por"** (largura cheia) — opções `CAMP_ORDEM_OPTS`
  (`roasDesc`/`roasAsc`/`investDesc`/`investAsc`/`fatDesc`/`nome`); grava
  `d.campanhasOrdem` via o setter genérico `set('campanhasOrdem')`. Aplicado em
  `CampaignsPage` por `campanhaCompare(d.campanhasOrdem)` (exportado do `report.jsx`).
- **Dropdown "Filtrar por"** — dimensões: `Investimento mínimo` (R$),
  `ROAS mínimo` (x), `Só novas/alteradas` (sem valor).
- **Campo de valor** que se adapta à dimensão escolhida:
  - Investimento → input R$ com máscara BRL (`maskBRL`).
  - ROAS → input numérico, sufixo "x".
  - Só novas/alteradas → campo oculto/desabilitado (não tem valor).
- **Botão "+ adicionar"** — aplica o filtro selecionado (seção "handlers").
- **Chips ativos** — um por filtro ativo, com o valor e um "×" que o remove
  (limpa o campo correspondente). Ex.: `Invest ≥ R$ 50 ×`, `ROAS ≥ 3x ×`,
  `Só novas/alteradas ×`.
- **Dica só no formulário** (não vai para o PDF): quando há filtro ativo, mostrar
  "N ocultada(s) do PDF", com
  `N = campanhasComConteudo.length − campanhasVisiveis.length`, calculado em `App`
  reusando `campanhaTemConteudo` + `campanhaPassaFiltro`.

Os cards de campanha continuam **todos visíveis e editáveis** no formulário — o
filtro só afeta o que é renderizado/impresso.

**Metadados das dimensões** (`app.jsx`):

```js
const CAMP_FILTRO_DIMS = [
  { key: 'investMin', label: 'Investimento mínimo', money: true,  chip: (v) => `Invest ≥ R$ ${v}` },
  { key: 'roasMin',   label: 'ROAS mínimo',         money: false, chip: (v) => `ROAS ≥ ${v}x` },
  { key: 'soNovas',   label: 'Só novas/alteradas',  bool: true,   chip: () => 'Só novas/alteradas' },
];
```

**Estado transitório do seletor** (só UI; não entra em `d`):

```js
const [filtroDim, setFiltroDim] = useState('investMin'); // dimensão do dropdown
const [filtroVal, setFiltroVal] = useState('');          // valor pendente
```

Ao trocar a dimensão no dropdown, pré-preenche o valor com o atual (para editar):
`onChange → setFiltroDim(k); setFiltroVal(k === 'soNovas' ? '' : (d.campanhasFiltro?.[k] || ''))`.

**Atualização de `d.campanhasFiltro`**:

```js
const setCampFiltro = (k) => (v) => setD((p) => ({
  ...p,
  campanhasFiltro: { ...(p.campanhasFiltro || CAMP_FILTRO_DEFAULT), [k]: v },
}));
```

**Handlers**

```js
const addFiltro = () => {
  const dim = CAMP_FILTRO_DIMS.find((x) => x.key === filtroDim);
  if (dim.bool) { setCampFiltro('soNovas')(true); return; }
  if (window.parseNum(filtroVal) > 0) { setCampFiltro(dim.key)(filtroVal); setFiltroVal(''); }
};
const removeFiltro = (key) => setCampFiltro(key)(key === 'soNovas' ? false : '');
```

Chips ativos = `CAMP_FILTRO_DIMS.filter((x) => x.bool ? filtro.soNovas : parseNum(filtro[x.key]) > 0)`.
Adicionar um limiar vazio/zero é no-op (não cria chip); `soNovas` sempre aplica.

## 7. Arquivos alterados

- **`report.jsx`**
  - Extrair `campanhaTemConteudo(c)` (o filtro-base atual) e adicionar
    `campanhaPassaFiltro(c, filtro)`; exportar ambas no `Object.assign(window, …)`.
  - `CampaignsPage`: aplicar os dois filtros antes de ordenar/paginar (seção 5).
- **`app.jsx`**
  - `CAMP_FILTRO_DEFAULT` e `CAMP_FILTRO_DIMS`; incluir `campanhasFiltro` em
    `EMPTY` e `DEFAULTS`.
  - `rollForward`: carregar `campanhasFiltro`.
  - `setCampFiltro`; estado transitório `filtroDim`/`filtroVal`; handlers
    `addFiltro`/`removeFiltro`; UI do sub-bloco (dropdown "Filtrar por" + campo de
    valor adaptável + botão adicionar + chips ativos); cálculo da dica de ocultadas.
- **`gerador.html`**
  - CSS do sub-bloco `.camp-filtros` (rótulo, dropdown, input de valor, botão
    "adicionar", chips ativos com "×", dica) no padrão do painel (variáveis
    `--panel-*`). Reaproveitar `SelectField`/`.is-select` para o dropdown e o
    visual de chip próximo a `.camp-badge`/`.camp-chg span`.

## 8. Casos de borda

- **Nenhum filtro ativo:** saída idêntica ao comportamento atual.
- **Filtro zera tudo:** página de campanhas some (aceito).
- **Campanha sem `roas` nem `fat/inv`:** `campRoasNum = -1`; só é cortada se
  `roasMin > 0`.
- **Relatório restaurado antigo (sem `campanhasFiltro`):** trata como default
  (todos vazios) → nada é filtrado; retrocompatível.
- **`investMin`/`roasMin` com texto inválido:** `parseNum` → 0 → filtro inativo
  (não quebra).

## 9. Decisões (rastreabilidade do brainstorming)

- Propósito: **controle total** (filtros combináveis).
- Local/escopo: **sub-bloco na seção Campanhas, por relatório** (payload).
- Seleção: **seletor "Filtrar por" (dropdown) + valor + adicionar**, com chips
  ativos removíveis — camada de UI sobre os mesmos três campos.
- Ordenação: **dropdown "Ordenar por"** no mesmo sub-bloco (`d.campanhasOrdem`,
  default `roasDesc`), também salvo por relatório.
- Ocultadas no PDF: **somem sem nota** (transparência fica só no formulário via a
  dica de contagem).
- Abordagem: **A** (limiares + toggle), preferida sobre presets (B) e construtor
  de regras (C).

## 10. Verificação

- Sem filtro → PDF de campanhas idêntico ao atual.
- `investMin` acima do gasto de algumas campanhas → elas somem do preview/PDF; a
  dica no formulário mostra a contagem correta.
- `roasMin` corta as de ROAS baixo; a ordenação melhor→pior se mantém.
- `soNovas` deixa só campanhas `novo`/com `mudancas`.
- Salvar e reabrir o relatório → filtros restaurados iguais.
- Iniciar novo período a partir do anterior (`rollForward`) → filtros carregados.
