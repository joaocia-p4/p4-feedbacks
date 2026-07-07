# Design — Observações como editor de blocos

**Data:** 2026-07-07
**Componente:** Gerador de Relatório (`design_handoff_sistema_feedbacks/`)
**Status:** Aprovado — pronto para plano de implementação

## 1. Contexto e objetivo

Hoje a Observação é um `textarea` de texto puro (`d.obs`) + uma galeria de imagens
(`d.obsImages`, data-URLs) mostrada **no fim** da página de observações. No PDF, o
`report.jsx` (ReportA) pagina o texto por medição (`splitObs`) e anexa todas as
imagens ao final.

Objetivo: transformar em um editor onde o analista possa **intercalar imagens com
o texto**, **reordenar**, **definir o tamanho** de cada imagem, **maximizar** a
área de edição e **formatar** (negrito, itálico, lista).

## 2. Escopo

**No escopo**
- Modelo de **blocos** ordenáveis: bloco de texto ou bloco de imagem.
- Formatação no texto: **negrito, itálico, lista com marcadores**.
- Imagem **entre blocos** (não no meio da frase); tamanho por **presets P/M/G/Cheia
  + slider (largura %)**; **reordenar** (↑/↓); remover.
- Botão **Maximizar** → modal grande com o mesmo editor.
- Renderização no PDF com imagens inline no tamanho escolhido; **paginação por
  bloco**.
- **Retrocompatível** com relatórios antigos (`obs` + `obsImages`).

**Fora do escopo (YAGNI)**
- Sublinhado, listas numeradas, títulos, cores, tabelas.
- Arrastar-soltar (usa ↑/↓ na v1).
- Imagem no meio de uma frase (só entre blocos).
- Bibliotecas externas (decisão do usuário: sem dependências).

## 3. Modelo de dados

Novo campo no relatório (`d`):

```js
d.obsBlocks = [
  { id: 'b…', type: 'text',  html: '<p>Texto com <b>negrito</b>…</p>' },
  { id: 'b…', type: 'image', src: 'data:image/jpeg;…', widthPct: 60 },
];
```

- `type: 'text'` → `html` restrito às tags `p, br, b, strong, i, em, ul, li`
  (sanitizado na renderização).
- `type: 'image'` → `src` (data-URL, já reduzida por `resizeImage()`), `widthPct`
  numérico **15–100** (% da largura da coluna). Presets: P=35, M=60, G=85, Cheia=100.
- `id`: gerado no app (`'b' + Math.random().toString(36).slice(2)` — ambiente
  navegador, `Math.random` disponível).

### Migração / retrocompatibilidade

- Ao carregar (`consumeReportContext`/`fullRestore`/`rollForward`), se `obsBlocks`
  **não existir**, converter de `obs` + `obsImages`:
  - `obs` (texto puro) → 1 bloco `text`: escapar HTML, dividir por linha em branco
    em parágrafos (`<p>`), quebras simples viram `<br>`. `obs` vazio → sem bloco de
    texto.
  - cada `obsImages[i]` → bloco `image` com `widthPct: 100`, na ordem original.
- Salvamento: `obsBlocks` entra no payload (backend `.passthrough()` — **sem
  mudança de schema**). Mantém-se um espelho `obs` em texto puro (derivado dos
  blocos de texto) para qualquer leitor de `d.obs`; `obsImages` deixa de ser
  atualizado.
- `report.jsx` renderiza `obsBlocks` quando presente; senão, cai no formato antigo
  (`obs` + `obsImages`) — relatórios nunca reabertos continuam corretos.

## 4. Componente `ObsEditor` (isolado)

Único componente, usado **no campo do form** e **no modal maximizado**, ligado ao
mesmo estado (`d.obsBlocks`). Props: `blocks`, `onChange(blocks)`, `large` (modal).

**Barra de ferramentas (topo):** `B` (negrito), `I` (itálico), `• Lista`. Agem
sobre a seleção do **bloco de texto focado** via `document.execCommand('bold' |
'italic' | 'insertUnorderedList')`. Os botões usam `onMouseDown` com
`preventDefault` para não perder a seleção. Rastreia o `id` do bloco focado.

**Bloco de texto:** `div contentEditable` **não-controlado** (para o cursor não
"pular"): conteúdo inicial via `dangerouslySetInnerHTML`, sincroniza para o estado
no `onInput` (lendo `innerHTML`), sem reescrever o DOM a cada tecla; re-monta só
quando o `id` muda (React `key={id}`).

**Controles por bloco:** `↑` / `↓` (reordenar), `✕` (remover).
**Adicionar:** botões **+ Texto** e **+ Imagem** (input de arquivo, múltiplo).

**Operações:** `updateBlock(id, patch)`, `moveBlock(id, dir)`, `removeBlock(id)`,
`addTextBlock(afterId?)`, `addImageBlock(src, afterId?)`.

## 5. Imagens

- **Inserir:** (a) **colar** (Ctrl+V) dentro de um bloco de texto com imagem no
  clipboard → `preventDefault` + `resizeImage()` → insere bloco `image` logo após
  o bloco atual; (b) botão **+ Imagem** (arquivo). Reusa o `resizeImage()` existente.
- **Tamanho:** presets **P / M / G / Cheia** (setam `widthPct` 35/60/85/100) +
  **slider 15–100%** para ajuste fino. Preview reflete na hora.
- **Reordenar/remover:** ↑ / ↓ / ✕ como qualquer bloco.

## 6. Maximizar

Botão **Maximizar** no cabeçalho do editor abre um **modal** (overlay fixo, scrim
escuro ~50%, z-index alto, fecha no ✕ e `Esc`) com o `ObsEditor` em tamanho grande.
Enquanto o modal está aberto, o editor pequeno do form mostra um aviso
("editando em tela cheia…") e **não** renderiza um segundo `contentEditable` — evita
dois editores sincronizando o mesmo bloco ao mesmo tempo. Ambos usam o mesmo
`onChange` → `d.obsBlocks`.

## 7. Renderização no PDF (`report.jsx`)

- `sanitizeObsHtml(html)` — mantém só as tags permitidas (`p, br, b, strong, i, em,
  ul, li`) e remove atributos; conteúdo é do próprio usuário, mas limpa para
  impressão previsível.
- `ObsBlocksRender({ blocks })` — renderiza em ordem: texto via
  `dangerouslySetInnerHTML={{__html: sanitizeObsHtml(b.html)}}`; imagem como
  `<img style={{ width: b.widthPct + '%' }}>`.
- **Paginação por bloco:** substitui o `splitObs` (que fatiava texto) por
  `packObsBlocks(blocks, measurer, firstMax, contMax)`: mede a altura de cada bloco
  (renderizado no medidor oculto, na largura da coluna) e preenche folhas A4 em
  sequência; **imagem nunca é cortada** (`break-inside: avoid`). Um único bloco
  maior que a página ganha a própria página e transborda um pouco (edge raro,
  aceito na v1).
- ReportA: quando `d.obsBlocks` existe, usa o caminho novo; senão mantém o legado
  (`obs` + `obsImages`).

## 8. Arquivos alterados

- **`app.jsx`**
  - Componente `ObsEditor` (+ helpers de bloco) e o modal de maximizar.
  - Substituir, na seção **Observações**, o `Field`(textarea) + `ObsImages` por
    `<ObsEditor blocks={d.obsBlocks} onChange={setObsBlocks} />`.
  - Migração `obs`/`obsImages` → `obsBlocks` em `consumeReportContext`,
    `fullRestore`, `rollForward`; incluir `obsBlocks` em `EMPTY`/`DEFAULTS`.
  - Espelho `obs` (texto puro) derivado no salvamento.
- **`report.jsx`**
  - `sanitizeObsHtml`, `ObsBlocksRender`, `packObsBlocks`; ramo novo em ReportA
    (mantendo o legado). (`ReportB` também passa a usar `ObsBlocksRender` quando há
    blocos.)
- **`gerador.html`**
  - CSS do editor (blocos, toolbar, bloco de imagem + slider, modal maximizar) no
    padrão do painel escuro; CSS de impressão dos blocos no A4 (imagens
    `break-inside: avoid`, `max-width:100%`).

## 9. Casos de borda

- `obsBlocks` vazio → sem página de observações no PDF (igual ao obs vazio hoje).
- Relatório antigo (só `obs`/`obsImages`) → migra ao abrir; PDF antigo não reaberto
  usa o caminho legado.
- Bloco de texto mais alto que a página → própria página, transborda (v1).
- Colar conteúdo não-imagem → paste de texto normal.
- `widthPct` fora de 15–100 → clamp.
- HTML colado com tags não permitidas → removidas pelo sanitizador na renderização.

## 10. Decisões (rastreabilidade do brainstorming)

- Modelo: **blocos reordenáveis** (texto/imagem), não inline-no-meio-da-frase.
- Formatação: **negrito + itálico + lista** (execCommand).
- Tamanho de imagem: **presets P/M/G/Cheia + slider**.
- Maximizar: **modal grande só com o editor**.
- Biblioteca: **nenhuma** (reordenar com ↑/↓).

## 11. Verificação

- Digitar texto, aplicar negrito/itálico/lista numa seleção.
- Colar um print entre dois parágrafos; ajustar tamanho por preset e por slider.
- Reordenar blocos com ↑/↓; remover um bloco.
- Maximizar, editar no modal, fechar → conteúdo idêntico no form.
- Pré-visualização/PDF: blocos na ordem, imagens inline no tamanho escolhido,
  imagem nunca cortada entre páginas.
- Abrir relatório antigo → converte para blocos sem perda; salvar e restaurar →
  round-trip fiel.
