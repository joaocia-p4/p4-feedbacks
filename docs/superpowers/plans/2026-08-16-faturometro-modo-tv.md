# Modo TV do Faturômetro — Plano de Implementação

> **Para executores agênticos:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam
> caixas (`- [ ]`) para acompanhamento.

**Objetivo:** Transformar a tela do Faturômetro num painel de parede legível a
metros de distância, sem duplicar tela e sem tocar no backend.

**Arquitetura:** Uma classe no `<body>` liga o figurino; todo o resto é CSS. Os
mesmos componentes (`FatChart`, `FatClientes`, métricas) continuam sendo
renderizados com os mesmos dados, vindos do mesmo `GET /faturometro`, com o
mesmo polling de 30s. Nenhum componente novo, nenhuma rota nova, nenhum cálculo
novo. **O modo TV é figurino, não lógica.**

**Stack:** React 18 via Babel-no-navegador (sem build step), CSS no `<style>` do
`index.html`. O frontend **não tem suíte de testes** — a verificação está
definida na §7 da spec e é reproduzida na Tarefa 5.

**Spec:** `docs/superpowers/specs/2026-08-06-faturometro-modo-tv-design.md`

---

## Restrições globais

- **Fundo claro.** Sem modo escuro. Decisão do dono do produto (spec §2).
- **Sem `requestFullscreen`.** O modo quiosque do navegador resolve (spec §2).
- **Resolução alvo: 1920×1080.** É a do painel, e é onde o aceite acontece.
- **Nada de backend.** Nenhuma rota, migration ou serviço muda.
- **O polling não muda:** 30s, pausado com a aba oculta.
- **Login semanal aceito.** O token de 7 dias expira e alguém relogra no painel.
  Decisão reconfirmada em 2026-08-16 — não implemente sessão longa nem link
  público (spec §6).
- **Contraste:** rótulos em `--muted` (~3:1) viram `--ink-2` (~7:1) **apenas**
  dentro do modo TV.

---

## Duas correções de rumo em relação à spec

A spec foi escrita antes de o código ser lido de perto. Dois pontos dela não se
sustentam como escritos, e o plano os corrige:

**1. A classe vai no `<body>`, não no contêiner da tela.**
A spec §5 diz "uma classe `tv` no contêiner raiz da tela". Isso não alcança a
Sidebar: `p4-shell.jsx:574` renderiza `<Sidebar>` como **irmã** do conteúdo, não
como filha. Uma classe no contêiner do Faturômetro nunca poderia escondê-la. A
classe vai em `document.body`, que é ancestral dos dois.

Bônus: `.shell` já reserva o espaço do menu com `padding-left:var(--side-w)`
(`index.html:162`), e `.app-side` usa a mesma variável para sua largura
(`index.html:165`). Zerar `--side-w` no body esconde o menu **e** devolve o
espaço numa tacada — o mesmo truque que o CSS já usa no breakpoint da linha 261.

**2. `?tv=1` sozinho não abre o Faturômetro.**
A spec §4 afirma que "abrir uma URL que já tenha `?tv=1` entra direto no modo".
Não é verdade hoje: `screen` nasce de `useState` em `p4-shell.jsx:355` lendo só
o papel do usuário, e cai em `'clients'`. O painel reiniciaria na lista de
clientes, e alguém teria de clicar em Faturômetro para o modo TV aparecer — o
que anula o propósito de um painel que abre sozinho.

A correção é uma linha no inicializador do `screen`, e por isso este plano toca
um **terceiro arquivo** que a spec §8 não lista: `p4-shell.jsx`.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | O que muda |
|---|---|---|
| `design_handoff_sistema_feedbacks/p4-faturometro.jsx` | A tela | Estado do modo, sincronia com a URL, `Esc`, classe no body, botões de entrar/sair, prop `limite`, títulos por classe |
| `design_handoff_sistema_feedbacks/index.html` | CSS central | Bloco novo `/* Modo TV */` no fim do CSS do Faturômetro (depois da linha 677) |
| `design_handoff_sistema_feedbacks/p4-shell.jsx` | Roteamento de tela | Abrir no Faturômetro quando a URL trouxer `?tv=1` |

---

## Tarefa 1: Mecânica de entrar e sair

Entregável: dá para entrar e sair do modo TV pelo botão, pelo `Esc` e pela URL,
e o `<body>` ganha e perde a classe corretamente. Ainda nada muda de aparência —
isso é a Tarefa 2 em diante.

**Arquivos:**
- Modificar: `design_handoff_sistema_feedbacks/p4-faturometro.jsx:201-215` (estado) e `:309-315` (botão)
- Modificar: `design_handoff_sistema_feedbacks/p4-shell.jsx:355-359`
- Modificar: `design_handoff_sistema_feedbacks/index.html` (só o botão de sair)

**Interfaces:**
- Produz: o estado booleano `tv` dentro de `Faturometro`, e a classe
  `fat-tv` em `document.body` enquanto o modo está ligado. **Todo o CSS das
  tarefas seguintes desce de `body.fat-tv`.**

- [ ] **Passo 1: Adicionar o estado e os três efeitos**

Em `p4-faturometro.jsx`, logo depois de `const [forcando, setForcando] = React.useState(false);` (linha 206):

```jsx
  // Modo TV — painel de parede. Nasce do endereço para o painel abrir pronto
  // depois de um reboot, sem ninguém clicar em nada.
  const [tv, setTv] = React.useState(() => {
    try { return new URLSearchParams(window.location.search).get('tv') === '1'; }
    catch (e) { return false; }
  });

  // A classe vive no BODY, não no contêiner da tela: a Sidebar é IRMÃ da tela
  // (p4-shell.jsx renderiza as duas lado a lado), então uma classe na tela não
  // alcançaria ela. O cleanup é obrigatório — sair da tela com a classe grudada
  // deixaria o RESTO do sistema sem menu lateral.
  React.useEffect(() => {
    document.body.classList.toggle('fat-tv', tv);
    return () => document.body.classList.remove('fat-tv');
  }, [tv]);

  // O endereço acompanha o modo, sem recarregar a página.
  React.useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (tv) u.searchParams.set('tv', '1'); else u.searchParams.delete('tv');
      window.history.replaceState(null, '', u);
    } catch (e) {}
  }, [tv]);

  // Esc só escuta enquanto o modo está ligado; sai junto com ele.
  React.useEffect(() => {
    if (!tv) return;
    const aoTeclar = (e) => { if (e.key === 'Escape') setTv(false); };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [tv]);
```

- [ ] **Passo 2: Adicionar o botão de entrar**

Em `p4-faturometro.jsx`, dentro de `<div className="fat-contexto">`, depois do
botão "Conferir agora" (linha 314):

```jsx
            <button className="btn-ghost" onClick={() => setTv(true)}>Modo TV</button>
```

- [ ] **Passo 3: Adicionar o botão de sair**

Em `p4-faturometro.jsx`, como **primeiro filho** do `<div className="shell">`
(logo antes de `<window.TopBar …>`, linha 284):

```jsx
      {tv
        ? <button className="fat-tv-sair" onClick={() => setTv(false)} title="Sair do Modo TV (Esc)">Sair</button>
        : null}
```

- [ ] **Passo 4: Estilizar o botão de sair**

Em `index.html`, depois da linha 677 (fim do bloco `.fat-backfill-bar > div`):

```css
/* ─── Modo TV do Faturômetro ─────────────────────────────────────────────────
   Painel de parede em 1920×1080. Daqui para baixo é SÓ figurino: nenhuma regra
   muda dado, rota ou cálculo. A classe fica no <body> porque a Sidebar é IRMÃ
   da tela (p4-shell.jsx), fora do alcance de uma classe no contêiner da tela. */
.fat-tv-sair{position:fixed;top:14px;right:16px;z-index:60;border:1px solid var(--line);background:rgba(255,255,255,.86);color:var(--ink-2);border-radius:999px;padding:8px 16px;font-size:14px;font-weight:700;cursor:pointer;opacity:.32;transition:opacity .2s var(--ease)}
.fat-tv-sair:hover,.fat-tv-sair:focus-visible{opacity:1}
```

- [ ] **Passo 5: Abrir no Faturômetro quando a URL pedir**

Em `p4-shell.jsx`, substituir o inicializador do `screen` (linhas 355-359) por:

```jsx
  const [screen, setScreen] = useState(() => {
    // O painel de parede abre direto no Faturômetro: sem isto, um reboot da TV
    // cairia na lista de clientes e alguém teria de ir lá clicar.
    try {
      if (new URLSearchParams(window.location.search).get('tv') === '1') return 'faturometro';
    } catch (e) {}
    // CS começa no painel; demais, na lista de clientes.
    try { const s = localStorage.getItem('p4-shell-user'); if (s && JSON.parse(s).papel === 'cs') return 'dashboard'; } catch (e) {}
    return 'clients';
  }); // dashboard | clients | history | new | edit | faturometro
```

> A tela do Faturômetro já é exclusiva de `admin` — `p4-shell.jsx:548` só a
> monta nesse caso e a Sidebar só a oferece a admin (`:105`). Um não-admin com
> `?tv=1` cai no destino normal dele. Não é preciso checar papel aqui.

- [ ] **Passo 6: Verificar que transpila**

O front não tem build step: erro de sintaxe vira **tela branca**, sem mensagem.
Esta é a rede de proteção automatizável.

```bash
mkdir -p /tmp/p4-check && cd /tmp/p4-check && npm install --silent @babel/standalone@7
cat > check.js <<'EOF'
const fs=require('fs'),path=require('path'),Babel=require('@babel/standalone');
const dir=process.argv[2];let falhas=0;
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.jsx')).sort()){
  try{Babel.transform(fs.readFileSync(path.join(dir,f),'utf8'),{presets:['react'],filename:f});console.log('  ok    '+f);}
  catch(e){falhas++;console.log('  FALHA '+f+'\n        '+e.message.split('\n')[0]);}
}
console.log('\n'+falhas+' falha(s).');process.exit(falhas?1:0);
EOF
node check.js /Users/joaopedromancinicia/dev/p4-feedbacks/design_handoff_sistema_feedbacks
```

Esperado: `0 falha(s).`

- [ ] **Passo 7: Verificar o comportamento no navegador**

Suba o app (backend em `:4000`, handoff servido por HTTP — `file://` não
funciona, o Babel busca os `.jsx` por XHR), entre como admin e:

1. Na tela do Faturômetro, clicar **Modo TV** → a URL ganha `?tv=1` **sem
   recarregar**, e `document.body` ganha a classe `fat-tv` (confira no
   inspetor).
2. Apertar **Esc** → o `?tv=1` sai da URL e a classe sai do body.
3. Recarregar com `?tv=1` na URL → abre **direto no Faturômetro**, já em modo TV.
4. Estando em modo TV, sair e navegar para Clientes → **a Sidebar volta**. (Se
   ela sumir para sempre, o cleanup do efeito da classe está errado.)

- [ ] **Passo 8: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-faturometro.jsx design_handoff_sistema_feedbacks/p4-shell.jsx design_handoff_sistema_feedbacks/index.html
git commit -m "feat(faturometro): entra e sai do modo TV pelo botao, pelo Esc e pela URL"
```

---

## Tarefa 2: O que some

Entregável: em modo TV a moldura desaparece — menu lateral, barra do topo e o
botão "Conferir agora" — e o conteúdo ocupa a largura toda.

**Arquivos:**
- Modificar: `design_handoff_sistema_feedbacks/p4-faturometro.jsx:284` e `:312-314`
- Modificar: `design_handoff_sistema_feedbacks/index.html` (bloco do Modo TV)

**Interfaces:**
- Consome: `tv` e a classe `body.fat-tv` da Tarefa 1.

- [ ] **Passo 1: Esconder a TopBar e o "Conferir agora" no JSX**

Em `p4-faturometro.jsx`, trocar a linha 284 por:

```jsx
      {tv ? null : <window.TopBar title="Faturômetro" user={user} role={role} onLogout={onLogout} onManageUsers={onManageUsers} />}
```

E envolver **os dois botões** da faixa de contexto — "Conferir agora" e o
próprio "Modo TV" adicionado na Tarefa 1. Dentro do modo TV nenhum dos dois faz
sentido: um é operação de mesa, o outro ligaria um modo já ligado. Trocar as
linhas 312-315 por:

```jsx
            {tv ? null : (
              <>
                <button className="btn-ghost" onClick={forcar} disabled={forcando}>
                  {forcando ? 'conferindo…' : 'Conferir agora'}
                </button>
                <button className="btn-ghost" onClick={() => setTv(true)}>Modo TV</button>
              </>
            )}
```

> A saída do modo TV **não** fica aqui: é o botão de canto da Tarefa 1, mais o
> `Esc`. Se os dois de cima também sumissem sem aquele existir, o painel
> entraria num modo do qual não se sai com o mouse.

> Estes dois são condicional no JSX, não `display:none`: estão dentro do
> componente e não faz sentido montar DOM que ninguém vai ver. A Sidebar é o
> caso oposto — está fora do componente, e só o CSS a alcança.

- [ ] **Passo 2: Esconder a Sidebar e devolver o espaço**

Em `index.html`, no bloco do Modo TV criado na Tarefa 1:

```css
/* Zerar --side-w faz as DUAS coisas: .app-side usa a variável como largura
   (linha 165) e .shell a usa como padding-left (linha 162). Mesmo truque do
   breakpoint da linha 261. */
body.fat-tv{--side-w:0px}
body.fat-tv .app-side{display:none}
body.fat-tv .page-inner{max-width:1760px;padding:20px 44px 32px}
```

- [ ] **Passo 3: Verificar que transpila**

Rode o mesmo comando do Passo 6 da Tarefa 1. Esperado: `0 falha(s).`

- [ ] **Passo 4: Verificar no navegador**

Entrar no modo TV: sem menu lateral, sem barra do topo, sem "Conferir agora", e
o conteúdo começando na borda esquerda da janela (não com 248px de recuo).
Sair: tudo volta.

- [ ] **Passo 5: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-faturometro.jsx design_handoff_sistema_feedbacks/index.html
git commit -m "feat(faturometro): modo TV tira a moldura e ocupa a largura toda"
```

---

## Tarefa 3: Top 5 no lugar da lista inteira

Entregável: em modo TV a lista mostra só os 5 maiores. Fora do modo TV, nada
muda.

> **Por que isso importa e não é enfeite:** a lista completa pendura o nome e o
> faturamento de **cada cliente** numa parede, à vista de quem passar na sala.
> É o motivo declarado na spec §3.

**Arquivos:**
- Modificar: `design_handoff_sistema_feedbacks/p4-faturometro.jsx:148` e `:163` e `:338`

**Interfaces:**
- Produz: `FatClientes` passa a aceitar a prop opcional `limite` (número).
  Ausente ou `0` = lista inteira.

- [ ] **Passo 1: Aceitar a prop `limite`**

Em `p4-faturometro.jsx`, trocar a assinatura (linha 148) e a fonte da lista:

```jsx
function FatClientes({ clientes, onOpenClient, limite }) {
```

E, logo depois do bloco do estado vazio (depois da linha 156), antes do
`return (`:

```jsx
  // No modo TV a lista vira Top 5: a lista inteira exporia nome e faturamento
  // de cada cliente para quem passa na sala. Sem limite, mostra tudo.
  const visiveis = limite ? clientes.slice(0, limite) : clientes;
```

Depois troque `clientes.map((c) => (` (linha 163) por:

```jsx
        {visiveis.map((c) => (
```

- [ ] **Passo 2: Passar o limite no modo TV**

Em `p4-faturometro.jsx`, linha 338:

```jsx
            <window.FatClientes clientes={clientes} onOpenClient={onOpenClient} limite={tv ? 5 : 0} />
```

- [ ] **Passo 3: Ajustar o título do bloco**

Na linha 337, para o painel não dizer "Por cliente" mostrando só cinco:

```jsx
            <b className="fat-card-tit">{tv ? 'Top 5 clientes hoje' : 'Por cliente'}</b>
```

> Note que o `style={{ fontSize: 14 }}` sai e vira a classe `fat-card-tit`. Isso
> é pré-requisito da Tarefa 4: **estilo inline vence CSS de folha**, então um
> título com `style` inline seria impossível de aumentar no modo TV sem
> `!important`.

- [ ] **Passo 4: Criar a classe do título (mantendo o tamanho atual)**

Em `index.html`, junto às demais regras `.fat-*` (perto da linha 677), **fora**
do bloco do Modo TV:

```css
.fat-card-tit{font-size:14px}
```

- [ ] **Passo 5: Verificar que transpila**

Mesmo comando da Tarefa 1, Passo 6. Esperado: `0 falha(s).`

- [ ] **Passo 6: Verificar no navegador**

Fora do modo TV: lista completa, título "Por cliente", tamanho de fonte
inalterado. Em modo TV: no máximo 5 linhas, título "Top 5 clientes hoje". Com
menos de 5 contas, mostra as que houver **sem espaço vazio reservado** (spec §6).

- [ ] **Passo 7: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-faturometro.jsx design_handoff_sistema_feedbacks/index.html
git commit -m "feat(faturometro): modo TV mostra Top 5 em vez da carteira inteira"
```

---

## Tarefa 4: O que cresce

Entregável: número, métricas, gráfico e lista em escala de leitura à distância,
e os rótulos com contraste de parede.

**Arquivos:**
- Modificar: `design_handoff_sistema_feedbacks/index.html` (bloco do Modo TV)
- Modificar: `design_handoff_sistema_feedbacks/p4-faturometro.jsx:111-115` e `:319`

**Interfaces:**
- Consome: `body.fat-tv` (Tarefa 1), `.fat-card-tit` (Tarefa 3).

- [ ] **Passo 1: Tirar os estilos inline que bloqueiam o CSS**

Estilo inline vence folha de estilo. Três lugares precisam virar classe antes de
poderem crescer. Em `p4-faturometro.jsx`:

Linha 111 (título do gráfico):
```jsx
        <b className="fat-card-tit">Tendências em vendas brutas</b>
```

Linhas 112-115 (legenda do gráfico) — trocar o `<span style={{…}}>` de abertura por:
```jsx
        <span className="fat-leg">
```

Linha 319 (título das métricas):
```jsx
              <b className="fat-card-tit">Métricas-chave</b>
```

- [ ] **Passo 2: Criar a classe da legenda com o visual atual**

Em `index.html`, ao lado de `.fat-card-tit` (fora do bloco do Modo TV):

```css
.fat-leg{font-size:11.5px;color:var(--muted);display:flex;gap:12px}
```

- [ ] **Passo 3: Escrever o figurino ampliado**

Em `index.html`, no bloco do Modo TV:

```css
body.fat-tv .fat-hero{border-radius:26px;padding:22px 26px 40px;margin-bottom:-30px}
body.fat-tv .fat-hero h1{font-size:44px;margin-bottom:14px}
body.fat-tv .fat-pill{font-size:22px;padding:9px 22px;gap:11px}
body.fat-tv .fat-dot{width:12px;height:12px}
body.fat-tv .fat-hero-card{max-width:1100px;padding:30px 26px;border-radius:24px}
body.fat-tv .fat-big{font-size:clamp(90px,9.5vw,190px)}
body.fat-tv .fat-big-load{font-size:44px}
body.fat-tv .fat-hero-sub{font-size:26px;margin-top:10px}
body.fat-tv .fat-erro{font-size:20px;padding:12px 18px}
body.fat-tv .fat-contexto{font-size:20px;gap:22px;margin:44px 0 20px}
body.fat-tv .fat-grid{grid-template-columns:minmax(420px,520px) 1fr;gap:26px}
body.fat-tv .fat-card-tit{font-size:26px}
body.fat-tv .fat-leg{font-size:19px;gap:22px}
body.fat-tv .fat-metricas{margin-top:18px}
body.fat-tv .fat-metrica{padding:18px 14px;gap:8px}
body.fat-tv .fat-metrica-val{font-size:36px}
body.fat-tv .fat-tab{font-size:26px;margin-top:16px}
body.fat-tv .fat-tab td{padding:15px 12px}
body.fat-tv .fat-var{font-size:24px}
body.fat-tv .fat-chip{font-size:16px;padding:3px 12px;margin-left:12px}

/* Contraste: --muted é #8A978C, ~3:1 no branco. Passa na mesa; numa parede a
   metros é o PRIMEIRO texto a sumir. --ink-2 (#4E5D54) dá ~7:1. Esta é a única
   mudança de cor do modo TV, e ela não escapa do body.fat-tv. */
body.fat-tv .fat-metrica-lbl{font-size:17px;color:var(--ink-2)}
body.fat-tv .fat-tab th{font-size:17px;color:var(--ink-2);padding:10px 12px}

/* O gráfico é um SVG com viewBox 720×260 e tamanhos em ATRIBUTO
   (fontSize="10.5", strokeWidth="2.8"). CSS vence atributo de apresentação,
   então dá para engrossar tudo sem tocar no JSX do FatChart. Os valores abaixo
   são em UNIDADES DO VIEWBOX, não pixels de tela. */
body.fat-tv .fat-grid svg text{font-size:17px}
body.fat-tv .fat-grid svg path[stroke]{stroke-width:5}
body.fat-tv .fat-grid svg circle{r:8}
```

- [ ] **Passo 4: Verificar que transpila**

Mesmo comando da Tarefa 1, Passo 6. Esperado: `0 falha(s).`

- [ ] **Passo 5: Verificar que o modo normal não regrediu**

Este é o passo que pega o erro mais provável desta tarefa. **Fora** do modo TV,
com a tela do Faturômetro aberta: os três títulos (`Métricas-chave`,
`Tendências em vendas brutas`, `Por cliente`) e a legenda do gráfico
(`Hoje`/`Ontem`) precisam estar **exatamente como antes** — 14px e 11.5px. Se
encolheram ou cresceram, a classe criada no Passo 2 da Tarefa 3 ou no Passo 2
desta tarefa está com o valor errado.

- [ ] **Passo 6: Commit**

```bash
git add design_handoff_sistema_feedbacks/p4-faturometro.jsx design_handoff_sistema_feedbacks/index.html
git commit -m "feat(faturometro): modo TV em escala de leitura a distancia"
```

---

## Tarefa 5: Aceite visual em 1920×1080

Entregável: uma captura da tela real, no modo TV, na resolução do painel — e o
aceite do dono do produto. **A spec §7 trata este passo como obrigatório**, não
opcional: ele é a única verificação que pega corte de layout.

**Arquivos:**
- Criar (temporário, já ignorado pelo git via `_mockup-*.html`):
  `design_handoff_sistema_feedbacks/_mockup-tv-shot.html`

- [ ] **Passo 1: Subir o app com dados**

```bash
cd backend && npm install && npm run setup   # migrations + seed de demonstração (senha: metodop4)
npm run dev                                   # API em :4000
```

Noutro terminal:

```bash
cd design_handoff_sistema_feedbacks && npx serve . -l 3000
```

- [ ] **Passo 2: Obter um token de admin**

O Chrome headless não sabe preencher formulário de login. O token é lido de
`localStorage['p4-token']` (`p4-api.js:12`), então basta plantá-lo.

```bash
curl -s -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@metodop4.com","senha":"metodop4"}'
```

Copie o valor de `token` da resposta. Se o e-mail do seed for outro, confira em
`backend/src/db/seeds/01_seed.js`.

- [ ] **Passo 3: Criar a página que planta o token e redireciona**

`design_handoff_sistema_feedbacks/_mockup-tv-shot.html` (o padrão `_mockup-*`
já é ignorado pelo git — veja `.gitignore:28`):

```html
<!doctype html>
<meta charset="utf-8">
<title>bootstrap da captura</title>
<script>
  // Mesma origem do app, então este localStorage é o mesmo que o app lê.
  localStorage.setItem('p4-token', 'COLE_O_TOKEN_AQUI');
  location.replace('/?tv=1');
</script>
```

- [ ] **Passo 4: Capturar em 1920×1080**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars \
  --window-size=1920,1080 \
  --virtual-time-budget=12000 \
  --screenshot=/tmp/faturometro-tv.png \
  "http://localhost:3000/_mockup-tv-shot.html"
```

O `--virtual-time-budget` alto é necessário: o Babel transpila os `.jsx` no
navegador e a tela ainda faz uma chamada à API antes de ter número.

- [ ] **Passo 5: Conferir a captura**

Abra `/tmp/faturometro-tv.png` e verifique, item a item:

1. Nenhum menu lateral, nenhuma barra do topo, nenhum "Conferir agora".
2. O número de hoje domina a tela e é legível de longe.
3. O gráfico aparece **inteiro**, sem corte na direita nem na base.
4. No máximo 5 clientes na lista, com o título "Top 5 clientes hoje".
5. Nenhuma barra de rolagem horizontal.
6. Os rótulos pequenos (eixos, "Quantidade de vendas", cabeçalho da tabela)
   estão em cinza **escuro**, não claro.
7. O botão "Sair" aparece discreto no canto superior direito.

- [ ] **Passo 6: Apagar a página temporária**

```bash
rm design_handoff_sistema_feedbacks/_mockup-tv-shot.html
```

> Ela carrega um token de admin válido em texto puro. Não deixe para depois.

- [ ] **Passo 7: Aceite do dono do produto**

Mostre a captura. **Este item não pode ser automatizado e é parte obrigatória do
aceite** (spec §7). Só depois disso a tarefa fecha.

---

## Casos de borda a conferir (spec §6)

Nem todos dão para forçar localmente; confira os que der.

| Situação | Comportamento esperado |
|---|---|
| Menos de 5 clientes | Mostra os que houver, sem espaço vazio reservado |
| Nenhuma conta conectada | Estado vazio do Faturômetro, ampliado |
| Backend sem responder | Selo vira âmbar e **o número segura o último valor** — numa parede, zerar sozinho seria pior que ficar velho |
| Cliente com erro de conexão | O chip continua aparecendo no Top 5 |
| Aba comum (não painel) | O modo funciona igual; o polling volta a pausar quando a aba perde o foco |
| Token expirado (7 dias) | Cai na tela de login. **Limitação conhecida e aceita** — não implemente sessão longa |

---

## O que este plano NÃO faz

Guardado aqui para não ser relitigado durante a execução:

- Tela cheia nativa (`requestFullscreen`) — o navegador só concede a partir de
  um clique, o que não serve para abertura automática. Modo quiosque resolve.
- Modo escuro, no painel ou no produto.
- Rodízio automático entre telas, som, alerta.
- Sessão longa ou link público para o painel.
- Qualquer mudança de backend, rota, cálculo ou frequência de polling.
