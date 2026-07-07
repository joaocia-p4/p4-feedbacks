# Observações — Editor de Blocos · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a seção "Observações" do gerador num editor de blocos (texto/imagem) com formatação (negrito/itálico/lista), imagens intercaladas e redimensionáveis, reordenação e modo maximizar — renderizando fiel no PDF A4.

**Architecture:** Modelo de dados `d.obsBlocks` (lista ordenada de blocos `text`/`image`). Um único componente `ObsEditor` (usado no form e num modal maximizado) edita a lista; blocos de texto são `contentEditable` não-controlados com `execCommand`. O `report.jsx` renderiza os blocos, sanitiza o HTML e pagina em nível de bloco. Retrocompatível com `obs`+`obsImages` (migra ao carregar; fallback legado na renderização).

**Tech Stack:** React 18 + Babel standalone (CDN, sem build), JSX in-browser. Sem bibliotecas externas.

## Global Constraints

- **Sem build / sem npm:** todo código é JSX transpilado no navegador. Validar cada `.jsx` editado transpilando com o Babel local:
  `node "$SP/check.js" "$SP" "$BASE/<arquivo>.jsx"` onde
  `SP=/c/Users/joaop/AppData/Local/Temp/claude/c--Users-joaop-OneDrive-Desktop-Sistema-de-relatorios-de-ADS/59f43382-1538-4588-bf10-b716f3c6c583/scratchpad/jsxcheck` e
  `BASE=/c/Users/joaop/OneDrive/Desktop/Sistema de relatorios de ADS/Sistema de Feedbacks/design_handoff_sistema_feedbacks`. Esperado: `OK`.
- **Sem bibliotecas externas.** Reordenar com ↑/↓. Formatação via `document.execCommand` (`bold`/`italic`/`insertUnorderedList`).
- **Verificação manual** no servidor local `http://localhost:5178/gerador.html` (recarregar com Ctrl+Shift+R).
- **Imagens:** entre blocos (não no meio da frase). Tamanho: presets P=35/M=60/G=85/Cheia=100 + slider 15–100 (`widthPct`).
- **Retrocompatível** com `d.obs` (texto) + `d.obsImages` (data-URLs).
- **Sem mudança de backend** (payload é JSON livre — `.passthrough()`).
- **Commits adiados:** trabalhar na branch existente `feat/relatorio-metas-reputacao-filtros`. NÃO commitar sem o usuário pedir; onde o template pede "commit", fazer um checkpoint de verificação.
- Tags de texto permitidas: `p, br, b, strong, i, em, ul, li`.

---

### Task 1: Modelo de blocos + migração (dados, sem mudar a UI)

**Files:**
- Modify: `design_handoff_sistema_feedbacks/app.jsx` (helpers de bloco; `ensureObsBlocks` no boot e no import; `setObsBlocks`)

**Interfaces:**
- Produces:
  - `newId(): string`
  - `makeTextBlock(html?): {id,type:'text',html}`
  - `makeImageBlock(src, widthPct?): {id,type:'image',src,widthPct}`
  - `obsToBlocks(obs, obsImages): Block[]`
  - `blocksToPlainText(blocks): string`
  - `ensureObsBlocks(d): d` (adiciona `obsBlocks` se ausente, convertendo de `obs`/`obsImages`)
  - Em `App`: `setObsBlocks(blocks)` → grava `obsBlocks` + espelho `obs`.

- [ ] **Step 1: Adicionar os helpers de bloco (topo do app.jsx, perto de `blankPeriod`)**

```js
function newId() { return 'b' + Math.random().toString(36).slice(2, 9); }
function makeTextBlock(html) { return { id: newId(), type: 'text', html: html || '' }; }
function makeImageBlock(src, widthPct) { return { id: newId(), type: 'image', src, widthPct: widthPct == null ? 100 : widthPct }; }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function obsTextToHtml(text) {
  const paras = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paras.map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>').join('');
}
function obsToBlocks(obs, obsImages) {
  const blocks = [];
  const html = obsTextToHtml(obs);
  if (html) blocks.push(makeTextBlock(html));
  (obsImages || []).forEach((src) => { if (src) blocks.push(makeImageBlock(src, 100)); });
  return blocks;
}
function blocksToPlainText(blocks) {
  return (blocks || [])
    .filter((b) => b.type === 'text')
    .map((b) => String(b.html || '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim())
    .filter(Boolean).join('\n\n');
}
// só adiciona obsBlocks quando ausente (relatório antigo) — não sobrescreve
function ensureObsBlocks(d) {
  if (Array.isArray(d.obsBlocks)) return d;
  return { ...d, obsBlocks: obsToBlocks(d.obs, d.obsImages) };
}
```

- [ ] **Step 2: NÃO adicionar `obsBlocks` a EMPTY/DEFAULTS** (deixar ausente para `ensureObsBlocks` disparar a conversão). Confirmar que `EMPTY`/`DEFAULTS` não têm a chave.

- [ ] **Step 3: Funnel no boot** — em `App`, trocar a inicialização do estado:

```js
const [d, setD] = useState(() => ensureObsBlocks(bootRef.current.initialD));
```

- [ ] **Step 4: Funnel no import** — em `onImportFile`, envolver:

```js
setD(ensureObsBlocks(roll ? rollForward(imp) : fullRestore(imp)));
```

- [ ] **Step 5: Setter com espelho** — em `App`, adicionar (perto de `set`/`setTone`):

```js
const setObsBlocks = useCallback((blocks) => setD((p) => ({ ...p, obsBlocks: blocks, obs: blocksToPlainText(blocks) })), []);
```

- [ ] **Step 6: Transpilar**

Run: `node "$SP/check.js" "$SP" "$BASE/app.jsx"`
Expected: `OK`

- [ ] **Step 7: Verificar no navegador (checkpoint)**

Recarregar `http://localhost:5178/gerador.html`. A seção Observações continua com o textarea antigo (ainda não trocada), o app carrega sem erro no console. (A migração roda internamente; sem regressão visível.)

---

### Task 2: `ObsEditor` — blocos de texto + toolbar + reordenar (troca o textarea)

**Files:**
- Modify: `design_handoff_sistema_feedbacks/app.jsx` (componente `ObsEditor`; uso na seção Observações)
- Modify: `design_handoff_sistema_feedbacks/gerador.html` (CSS do editor)

**Interfaces:**
- Consumes: helpers da Task 1; `setObsBlocks`.
- Produces: `<ObsEditor blocks onChange addImages? large? />` (Task 3 acrescenta imagens). Nesta task, `ObsEditor` já renderiza blocos `image` como preview read-only (largura `widthPct%`), mas sem controles de tamanho/inserção.

- [ ] **Step 1: Adicionar o componente `ObsEditor` (antes de `function App`)**

```jsx
// Editor de observações por blocos. Blocos de texto = contentEditable NÃO-controlado
// (conteúdo inicial via dangerouslySetInnerHTML, sincroniza no onInput; key={id} para
// não resetar o cursor). Toolbar age no bloco focado via execCommand.
function TextBlock({ block, onHtml, onFocusBlock }) {
  const ref = React.useRef(null);
  return (
    <div
      ref={ref}
      className="ob-text"
      contentEditable
      suppressContentEditableWarning
      dangerouslySetInnerHTML={{ __html: block.html || '' }}
      onFocus={() => onFocusBlock(block.id)}
      onInput={(e) => onHtml(e.currentTarget.innerHTML)}
      data-empty={!block.html ? '1' : undefined}
    />
  );
}

function ObsEditor({ blocks, onChange, large, onAddImages, onMaximize, maximized }) {
  const list = blocks || [];
  const [focusId, setFocusId] = React.useState(null);
  const update = (id, patch) => onChange(list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (id, dir) => {
    const i = list.findIndex((b) => b.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const arr = list.slice(); const [x] = arr.splice(i, 1); arr.splice(j, 0, x); onChange(arr);
  };
  const remove = (id) => onChange(list.filter((b) => b.id !== id));
  const addText = () => onChange([...list, makeTextBlock('')]);
  const exec = (cmd) => { document.execCommand(cmd, false, null); };
  const toolBtn = (cmd, label, title) => (
    <button type="button" className="ob-tool" title={title}
      onMouseDown={(e) => { e.preventDefault(); exec(cmd); }}>{label}</button>
  );
  return (
    <div className={'ob-editor' + (large ? ' ob-large' : '')}>
      <div className="ob-toolbar">
        {toolBtn('bold', <b>B</b>, 'Negrito')}
        {toolBtn('italic', <i>I</i>, 'Itálico')}
        {toolBtn('insertUnorderedList', '•', 'Lista')}
        <span className="ob-tool-sep" />
        <button type="button" className="ob-tool" onMouseDown={(e) => e.preventDefault()} onClick={addText}>+ Texto</button>
        {onAddImages ? (
          <label className="ob-tool" title="Adicionar imagem">
            + Imagem
            <input type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={(e) => { onAddImages(e.target.files, focusId); e.target.value = ''; }} />
          </label>
        ) : null}
        {onMaximize ? <button type="button" className="ob-tool ob-max" onClick={onMaximize} title={maximized ? 'Fechar' : 'Maximizar'}>{maximized ? '✕ Fechar' : '⤢ Maximizar'}</button> : null}
      </div>
      <div className="ob-blocks">
        {list.length === 0 ? <div className="ob-empty" onClick={addText}>Clique para escrever ou cole um print…</div> : null}
        {list.map((b) => (
          <div className={'ob-block ob-' + b.type + (focusId === b.id ? ' focus' : '')} key={b.id}>
            <div className="ob-block-main">
              {b.type === 'text'
                ? <TextBlock block={b} onHtml={(html) => update(b.id, { html })} onFocusBlock={setFocusId} />
                : <img className="ob-img" src={b.src} alt="" style={{ width: (b.widthPct || 100) + '%' }} />}
            </div>
            <div className="ob-block-side">
              <button type="button" className="ob-mini" title="Mover para cima" onClick={() => move(b.id, -1)}>↑</button>
              <button type="button" className="ob-mini" title="Mover para baixo" onClick={() => move(b.id, 1)}>↓</button>
              <button type="button" className="ob-mini ob-del" title="Remover" onClick={() => remove(b.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Trocar o uso na seção Observações**

Substituir, dentro do `<Section title="Observações" …>`, o `<Field label="Notas do período" …/>` + `<ObsImages …/>` por:

```jsx
<ObsEditor blocks={d.obsBlocks} onChange={setObsBlocks} />
```

Atualizar `obsSummary` para refletir blocos:

```js
const obsBlocksArr = d.obsBlocks || [];
const obsImgCount = obsBlocksArr.filter((b) => b.type === 'image').length;
const obsHasText = obsBlocksArr.some((b) => b.type === 'text' && String(b.html || '').replace(/<[^>]+>/g, '').trim());
const obsSummary = (obsHasText ? 'nota' : 'sem nota') + (obsImgCount ? ` · ${obsImgCount} print${obsImgCount > 1 ? 's' : ''}` : '');
```

- [ ] **Step 3: CSS do editor (gerador.html, perto do bloco `.obs-imgs`/observações do painel)**

```css
.ob-editor{border:1px solid var(--panel-line);border-radius:10px;background:var(--panel-2);overflow:hidden}
.ob-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 9px;border-bottom:1px solid var(--panel-line);background:var(--panel)}
.ob-tool{appearance:none;border:1px solid var(--panel-line);background:transparent;color:var(--panel-txt);cursor:pointer;font-family:'Sora';font-size:12px;font-weight:600;min-width:28px;height:28px;padding:0 9px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;transition:.12s}
.ob-tool:hover{border-color:var(--green);color:var(--green)}
.ob-tool-sep{width:1px;height:18px;background:var(--panel-line);margin:0 2px}
.ob-max{margin-left:auto}
.ob-blocks{display:flex;flex-direction:column;gap:7px;padding:9px;max-height:300px;overflow-y:auto}
.ob-large .ob-blocks{max-height:none}
.ob-empty{color:var(--panel-mut);font-size:12.5px;padding:10px;cursor:text}
.ob-block{display:flex;gap:7px;align-items:flex-start}
.ob-block-main{flex:1;min-width:0}
.ob-text{min-height:32px;background:var(--panel);border:1px solid var(--panel-line);border-radius:7px;color:var(--panel-txt);font-family:'Sora';font-size:13px;line-height:1.5;padding:8px 10px;outline:none}
.ob-text:focus{border-color:var(--green)}
.ob-text[data-empty="1"]:before{content:'Escreva…';color:#5d6b74}
.ob-text ul{margin:4px 0 4px 18px}
.ob-img{display:block;border:1px solid var(--panel-line);border-radius:7px;max-width:100%}
.ob-block-side{display:flex;flex-direction:column;gap:3px;flex:none}
.ob-mini{width:24px;height:22px;border:1px solid var(--panel-line);background:transparent;color:var(--panel-mut);border-radius:5px;cursor:pointer;font-size:11px;line-height:1;display:grid;place-items:center}
.ob-mini:hover{border-color:var(--panel-mut);color:var(--panel-txt)}
.ob-del:hover{border-color:var(--red-lt);color:var(--red-lt)}
```

- [ ] **Step 4: Transpilar**

Run: `node "$SP/check.js" "$SP" "$BASE/app.jsx"`
Expected: `OK`

- [ ] **Step 5: Verificar no navegador**

Recarregar. Na seção Observações: digitar texto; selecionar uma frase e clicar **B**/**I**/**•** → aplica negrito/itálico/lista. **+ Texto** adiciona bloco. ↑/↓ reordena; ✕ remove. Se havia imagens antigas (relatório migrado), elas aparecem como blocos de imagem (preview). Cursor não "pula" ao digitar.

---

### Task 3: Imagens — inserir (botão + colar) e tamanho (presets + slider)

**Files:**
- Modify: `design_handoff_sistema_feedbacks/app.jsx` (`onAddImages`; paste no TextBlock; controles de tamanho no bloco de imagem)
- Modify: `design_handoff_sistema_feedbacks/gerador.html` (CSS dos controles de imagem)

**Interfaces:**
- Consumes: `resizeImage(file, cb)` (já existe), `makeImageBlock`.
- Produces: inserção de bloco de imagem após o bloco focado; `widthPct` editável.

- [ ] **Step 1: Handler de adicionar imagens em `App`**

```js
const addObsImages = (files, afterId) => {
  Array.from(files || []).filter((f) => f.type && f.type.startsWith('image/')).forEach((f) => {
    resizeImage(f, (url) => setD((p) => {
      const arr = (p.obsBlocks || []).slice();
      const idx = afterId ? arr.findIndex((b) => b.id === afterId) : -1;
      const block = makeImageBlock(url, 100);
      if (idx >= 0) arr.splice(idx + 1, 0, block); else arr.push(block);
      return { ...p, obsBlocks: arr, obs: blocksToPlainText(arr) };
    }));
  });
};
```

Passar para o editor: `<ObsEditor blocks={d.obsBlocks} onChange={setObsBlocks} onAddImages={addObsImages} … />`.

- [ ] **Step 2: Colar imagem dentro de um bloco de texto** — no `TextBlock`, adicionar `onPaste`:

```jsx
onPaste={(e) => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  const imgs = [];
  for (const it of items) { if (it.type && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) imgs.push(f); } }
  if (imgs.length && onPasteImages) { e.preventDefault(); onPasteImages(imgs, block.id); }
}}
```

Encadear `onPasteImages` de `ObsEditor` (recebe `onAddImages`) para o `TextBlock`. (Sem imagem no clipboard → paste de texto normal.)

- [ ] **Step 3: Controles de tamanho no bloco de imagem** — no `ObsEditor`, quando `b.type === 'image'`, abaixo do `<img>`:

```jsx
<div className="ob-imgctl">
  {[['P', 35], ['M', 60], ['G', 85], ['Cheia', 100]].map(([lab, w]) => (
    <button type="button" key={w} className={'ob-size' + ((b.widthPct || 100) === w ? ' on' : '')} onClick={() => update(b.id, { widthPct: w })}>{lab}</button>
  ))}
  <input className="ob-slider" type="range" min="15" max="100" value={b.widthPct || 100}
    onChange={(e) => update(b.id, { widthPct: Math.max(15, Math.min(100, parseInt(e.target.value, 10) || 100)) })} />
  <span className="ob-pct">{b.widthPct || 100}%</span>
</div>
```

- [ ] **Step 4: CSS dos controles (gerador.html)**

```css
.ob-imgctl{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}
.ob-size{appearance:none;border:1px solid var(--panel-line);background:transparent;color:var(--panel-mut);cursor:pointer;font-family:'JetBrains Mono',monospace;font-size:10px;padding:3px 8px;border-radius:5px}
.ob-size:hover{border-color:var(--panel-mut);color:var(--panel-txt)}
.ob-size.on{border-color:var(--green);color:var(--green)}
.ob-slider{flex:1;min-width:80px;accent-color:var(--green)}
.ob-pct{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--panel-mut);width:34px;text-align:right}
```

- [ ] **Step 5: Transpilar**

Run: `node "$SP/check.js" "$SP" "$BASE/app.jsx"`
Expected: `OK`

- [ ] **Step 6: Verificar no navegador**

Colar um print dentro de um bloco de texto → vira bloco de imagem logo abaixo. **+ Imagem** insere via arquivo. Presets P/M/G/Cheia e o slider mudam a largura na hora. ↑/↓ move a imagem entre os textos.

---

### Task 4: Modo maximizar (modal)

**Files:**
- Modify: `design_handoff_sistema_feedbacks/app.jsx` (estado `obsMax`; modal; aviso no editor pequeno)
- Modify: `design_handoff_sistema_feedbacks/gerador.html` (CSS do modal)

- [ ] **Step 1: Estado + modal em `App`**

```js
const [obsMax, setObsMax] = useState(false);
useEffect(() => {
  if (!obsMax) return;
  const onKey = (e) => { if (e.key === 'Escape') setObsMax(false); };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, [obsMax]);
```

Na seção Observações, quando `obsMax` estiver aberto, o editor pequeno mostra só um aviso (evita dois `contentEditable` do mesmo bloco):

```jsx
{obsMax
  ? <div className="ob-editing-note">Editando em tela cheia…</div>
  : <ObsEditor blocks={d.obsBlocks} onChange={setObsBlocks} onAddImages={addObsImages} onMaximize={() => setObsMax(true)} />}
```

Modal (no fim do JSX do `App`, junto do `TweaksPanel`):

```jsx
{obsMax ? (
  <div className="ob-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setObsMax(false); }}>
    <div className="ob-modal-card">
      <div className="ob-modal-head"><span>Observações</span><button type="button" className="ob-tool" onClick={() => setObsMax(false)}>✕ Fechar</button></div>
      <ObsEditor blocks={d.obsBlocks} onChange={setObsBlocks} onAddImages={addObsImages} large maximized onMaximize={() => setObsMax(false)} />
    </div>
  </div>
) : null}
```

- [ ] **Step 2: CSS do modal (gerador.html)**

```css
.ob-editing-note{border:1px dashed var(--panel-line);border-radius:10px;color:var(--panel-mut);font-size:12.5px;padding:14px;text-align:center}
.ob-modal{position:fixed;inset:0;z-index:12000;background:rgba(6,10,14,.55);display:flex;align-items:center;justify-content:center;padding:28px}
.ob-modal-card{width:min(900px,94vw);max-height:90vh;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--panel-line);border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}
.ob-modal-head{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--panel-line);font-weight:700}
.ob-modal-card .ob-editor{border:0;border-radius:0;flex:1;min-height:0;display:flex;flex-direction:column}
.ob-modal-card .ob-blocks{max-height:none;flex:1}
```

- [ ] **Step 3: Transpilar**

Run: `node "$SP/check.js" "$SP" "$BASE/app.jsx"`
Expected: `OK`

- [ ] **Step 4: Verificar no navegador**

Clicar **⤢ Maximizar** → abre modal grande; editar (texto/imagens/ordem) reflete no `d.obsBlocks`; fechar (✕/Esc/clique fora) → o editor pequeno volta com o mesmo conteúdo.

---

### Task 5: Renderização no PDF (report.jsx) — sanitizar, renderizar, paginar por bloco

**Files:**
- Modify: `design_handoff_sistema_feedbacks/report.jsx` (`sanitizeObsHtml`, `ObsBlocksRender`, `packObsBlocks`; ramo em `ReportA` e `ReportB`)
- Modify: `design_handoff_sistema_feedbacks/gerador.html` (CSS de impressão dos blocos)

**Interfaces:**
- Consumes: `d.obsBlocks` (quando presente).
- Produces: `sanitizeObsHtml(html): string`, `ObsBlocksRender({blocks})`, `packObsBlocks(blocks, measurer, firstMax, contMax): Block[][]`.

- [ ] **Step 1: Sanitizador + render (topo de report.jsx, perto de `splitObs`)**

```jsx
const OBS_ALLOWED = { P: 1, BR: 1, B: 1, STRONG: 1, I: 1, EM: 1, UL: 1, LI: 1 };
function sanitizeObsHtml(html) {
  if (typeof document === 'undefined') return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');
  const walk = (node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === 1) {
        if (!OBS_ALLOWED[child.tagName]) {
          // desembrulha tags não permitidas, preservando o texto/filhos
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child); return;
        }
        Array.from(child.attributes).forEach((a) => child.removeAttribute(a.name));
        walk(child);
      }
    });
  };
  walk(tmp);
  return tmp.innerHTML;
}
function ObsBlockView({ block }) {
  if (block.type === 'image') return <img className="ra-obs-img" src={block.src} alt="" style={{ width: (block.widthPct || 100) + '%' }} />;
  return <div className="ra-obs-text" dangerouslySetInnerHTML={{ __html: sanitizeObsHtml(block.html) }} />;
}
function ObsBlocksRender({ blocks }) {
  return <div className="ra-obs">{(blocks || []).map((b) => <ObsBlockView key={b.id} block={b} />)}</div>;
}
```

- [ ] **Step 2: Paginação por bloco**

```js
// mede cada bloco no medidor oculto (mesma largura da coluna) e empacota em páginas
function packObsBlocks(blocks, measurer, firstMax, contMax) {
  const pages = []; let cur = []; let h = 0; let max = firstMax;
  const measure = (b) => {
    measurer.innerHTML = '';
    if (b.type === 'image') {
      const img = document.createElement('img'); img.src = b.src; img.style.width = (b.widthPct || 100) + '%'; img.style.display = 'block';
      measurer.appendChild(img);
    } else {
      const div = document.createElement('div'); div.innerHTML = String(b.html || ''); measurer.appendChild(div);
    }
    return measurer.offsetHeight + 8; // + gap
  };
  (blocks || []).forEach((b) => {
    const bh = measure(b);
    if (cur.length && h + bh > max) { pages.push(cur); cur = []; h = 0; max = contMax; }
    cur.push(b); h += bh;
  });
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}
```

> Nota: imagem nunca é fatiada (um bloco = uma unidade). Bloco único maior que a página ocupa a própria página e pode transbordar (edge raro; aceito na v1).

- [ ] **Step 3: Ramo em `ReportA`**

Onde hoje calcula `obsText`/`obsPages` via `splitObs`, usar os blocos quando presentes. Manter o legado:

```jsx
const useBlocks = Array.isArray(d.obsBlocks);
const obsBlocks = d.obsBlocks || [];
// ...
React.useLayoutEffect(() => {
  if (!useBlocks) { /* caminho legado com splitObs, inalterado */ return; }
  const measurer = measureRef.current, body = obsBodyRef.current;
  if (!measurer || !body) return;
  const recompute = () => {
    measurer.style.width = body.offsetWidth + 'px';
    const PAGE_H = 1123; const bodyTop = body.offsetTop;
    const avail = Math.max(300, PAGE_H - bodyTop - 30 - 50 - 20);
    const pages = packObsBlocks(obsBlocks, measurer, avail, PAGE_H - 120);
    setObsPages((prev) => (prev.length === pages.length ? prev : pages)); // (comparar por conteúdo se necessário)
  };
  recompute();
  const raf = requestAnimationFrame(recompute); const t = setTimeout(recompute, 250);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(recompute);
  const mo = new MutationObserver(recompute); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => { cancelAnimationFrame(raf); clearTimeout(t); mo.disconnect(); };
}, [useBlocks, JSON.stringify(obsBlocks)]);
```

Renderizar as páginas de observação: para o modo blocos, cada página mostra `<ObsBlocksRender blocks={chunk} />` (chunk = array de blocos). Substituir o corpo `{chunk ? <p className="ra-notes-text">…` por:

```jsx
{useBlocks ? <ObsBlocksRender blocks={chunk} /> : (chunk ? <p className="ra-notes-text">{chunk}</p> : null)}
{(!useBlocks && last) ? obsImgsEl : null}
```

E a condição de existir página de observação passa a ser `useBlocks ? obsBlocks.length : (obsText || imgs.length)`.

- [ ] **Step 4: `ReportB`** — trocar `<p>{d.obs || 'Sem observações…'}</p>` por:

```jsx
{Array.isArray(d.obsBlocks) ? (d.obsBlocks.length ? <ObsBlocksRender blocks={d.obsBlocks} /> : <p>Sem observações para este período.</p>) : <p>{d.obs || 'Sem observações para este período.'}</p>}
```

- [ ] **Step 5: CSS de impressão dos blocos (gerador.html)**

```css
.ra-obs{display:flex;flex-direction:column;gap:9px}
.ra-obs-text{font-size:12.5px;line-height:1.55;color:var(--ink);white-space:normal;overflow-wrap:anywhere}
.ra-obs-text p{margin:0 0 6px}
.ra-obs-text ul{margin:4px 0 6px 20px}
.ra-obs-img{display:block;max-width:100%;border-radius:8px;break-inside:avoid;page-break-inside:avoid}
```

- [ ] **Step 6: Transpilar (os dois)**

Run: `node "$SP/check.js" "$SP" "$BASE/report.jsx" "$BASE/app.jsx"`
Expected: `OK` nos dois.

- [ ] **Step 7: Verificar no navegador**

Na pré-visualização (direita): as observações aparecem como blocos na ordem (texto formatado + imagens no tamanho escolhido, intercaladas). Muitas imagens/texto longo → páginas A4 adicionais, sem cortar imagem no meio. Imprimir (Baixar PDF) mantém o layout.

---

### Task 6: Retrocompatibilidade + limpeza final

**Files:**
- Modify: `design_handoff_sistema_feedbacks/app.jsx` (remover `ObsImages`/`onObsPaste`/`addImages`/`removeImage` órfãos se não usados; `reset`)

- [ ] **Step 1: `reset`** — garantir que limpar o período zera as observações em blocos:

Em `reset()`, o objeto resultante herda `...EMPTY` (sem `obsBlocks`); adicionar `obsBlocks: []` explicitamente para o editor limpar.

- [ ] **Step 2: Remover código órfão** — se `ObsImages`, `onObsPaste`, `addImages`, `removeImage` não forem mais referenciados, remover (o `resizeImage` PERMANECE, usado por `addObsImages`). Rodar busca:

Run (Grep): `ObsImages|onObsPaste|removeImage\b`
Ação: remover definições sem uso.

- [ ] **Step 3: Transpilar**

Run: `node "$SP/check.js" "$SP" "$BASE/app.jsx"`
Expected: `OK`

- [ ] **Step 4: Verificação de retrocompatibilidade**

Abrir um relatório antigo (via histórico "Gerar relatório atual" ou importar um `.json` antigo com `obs`+`obsImages`): as observações migram para blocos (texto + imagens) sem perda. Editar, salvar, e reabrir (restore) → conteúdo idêntico (round-trip). Um relatório antigo NUNCA reaberto renderiza pelo caminho legado.

- [ ] **Step 5: Checkpoint final**

Rodar a verificação completa da spec (seção 11). Reportar ao usuário; commit só quando ele pedir.

---

## Self-Review

- **Cobertura da spec:** §3 modelo/migração → Task 1; §4 ObsEditor/toolbar/reordenar → Task 2; §5 imagens (inserir/tamanho) → Task 3; §6 maximizar → Task 4; §7 PDF (sanitizar/render/paginar) → Task 5; §2/§9 retrocompat + bordas → Tasks 1/5/6. ✔
- **Placeholders:** nenhum passo com "TBD/etc."; código presente nos passos de código. ✔
- **Consistência de tipos:** `obsToBlocks/blocksToPlainText/ensureObsBlocks/setObsBlocks` (Task 1) usados igual nas Tasks 2–6; `makeImageBlock(src,widthPct)`, `widthPct` numérico e `packObsBlocks(blocks,measurer,firstMax,contMax)` consistentes entre app.jsx e report.jsx. ✔
- **Nota de risco:** o padrão `contentEditable` não-controlado (Task 2) é o ponto mais sensível — validar que o cursor não reseta ao digitar antes de seguir para a Task 3.
