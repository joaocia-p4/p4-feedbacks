# Design — Modo TV do Faturômetro

**Data:** 2026-08-06
**Componente:** Frontend (`design_handoff_sistema_feedbacks/`)
**Status:** Aprovado — pronto para plano de implementação
**Depende de:** `2026-08-06-faturometro-design.md`

## 1. Contexto e objetivo

O Faturômetro foi desenhado para uma pessoa olhando de perto, com menu lateral,
barra do topo e a lista completa de clientes. Vai virar **painel de parede**, e
nesse uso quase tudo isso atrapalha: a moldura rouba área, a lista expõe nome e
faturamento de cada cliente para quem passa na sala, e a tipografia some a
poucos metros.

Objetivo: um modo de exibição que transforme a mesma tela num painel legível de
longe, sem duplicar tela nem tocar no backend.

## 2. Escopo

**No escopo**

- Botão **Modo TV** no cabeçalho da tela.
- O modo fica gravado no endereço (`?tv=1`), para o painel abrir já pronto.
- Saída pelo botão de canto ou pela tecla **Esc**.
- Layout ampliado: sem menu lateral, sem barra do topo, número grande maior,
  métricas e gráfico em escala de leitura à distância.
- Lista completa de clientes substituída por **Top 5**.
- Rótulos em `--muted` promovidos a `--ink-2` no modo TV.

**Fora do escopo (YAGNI)**

- Tela cheia nativa (`requestFullscreen`). O navegador só concede a partir de um
  clique, então não valeria na abertura automática do painel — no painel, o modo
  quiosque do próprio navegador resolve melhor.
- Modo escuro. Decisão do dono do produto: manter a identidade clara do sistema.
- Tema escuro do produto inteiro.
- Rodízio automático entre telas, som ou alerta.
- Sessão longa para o painel (ver §6).

## 3. Decisões tomadas no brainstorming

| Tema | Decisão |
|---|---|
| O que aparece | Total, métricas, gráfico e **Top 5** — não a lista inteira |
| Por quê | A lista completa pendura nome e faturamento de cada cliente numa parede |
| Entrada | **Botão + endereço próprio** (`?tv=1`), para o painel abrir sozinho |
| Fundo | **Claro**, igual ao resto do sistema |
| Tela cheia nativa | Fora do escopo |

## 4. Comportamento

**Entrar:** o botão **Modo TV** fica na faixa de contexto (`.fat-contexto`), ao
lado de "Conferir agora". Ele liga o modo e grava `?tv=1` via
`history.replaceState` — sem recarregar a página. Abrir uma URL que já tenha
`?tv=1` entra direto no modo.

**Sair:** botão discreto no canto superior direito, e a tecla **Esc**. Sair
remove o `?tv=1` do endereço, de novo sem recarregar.

**O que some:** menu lateral (`Sidebar`), barra do topo (`TopBar`), o botão
"Conferir agora" e a lista completa de clientes.

**O que cresce:** número de hoje, métricas-chave (mesma grade 2×3), gráfico
(mesma curva, traços mais grossos, rótulos maiores) e o Top 5.

**O que não muda:** o polling continua em 30s; os números continuam vindo do
mesmo `GET /faturometro`; nada é recalculado no cliente. O modo TV é figurino,
não lógica.

> O polling hoje pausa quando a aba perde o foco. Num painel a aba está sempre
> visível, então esse comportamento não aparece — e continua valendo quando o
> modo TV é usado numa aba comum.

## 5. Implementação

Uma classe `tv` no contêiner raiz da tela, mais um bloco `.fat-tv …` no CSS de
`index.html`. **Sem componente novo e sem tela duplicada:** os mesmos
`FatChart`, `FatClientes` e métricas, com outro figurino.

- O Top 5 é `clientes.slice(0, 5)` no próprio componente da lista, acionado por
  uma prop (`limite`). Nenhuma mudança no backend, nenhuma rota nova.
- O estado do modo vive na tela (`useState`), inicializado a partir de
  `URLSearchParams`.
- O `Esc` é um listener registrado só enquanto o modo está ligado, removido na
  limpeza do efeito.

**Contraste:** `--muted` é `#8A978C`, que sobre branco dá ~3:1. Na tela normal
passa; num painel a metros de distância é o primeiro texto a sumir. No modo TV
os rótulos passam a `--ink-2` (`#4E5D54`, ~7:1). É a única mudança de cor, e
fica contida em `.fat-tv`.

## 6. Erros e casos de borda

| Situação | Comportamento |
|---|---|
| Menos de 5 clientes | Mostra os que houver, sem espaço vazio reservado |
| Nenhuma conta conectada | Estado vazio do Faturômetro, ampliado |
| Backend sem responder | Selo vira âmbar e **o número segura o último valor** — numa parede, zerar sozinho seria pior que ficar velho |
| Cliente com erro de conexão | O chip continua aparecendo no Top 5 |
| Aba comum (não painel) | O modo funciona igual; o polling volta a pausar quando a aba perde o foco |
| **Token expirado (7 dias)** | O painel cai na tela de login e alguém precisa entrar de novo. **Limitação conhecida e aceita**; resolvê-la exigiria uma sessão longa dedicada ao painel, que é assunto próprio e está fora deste escopo |

## 7. Verificação

O frontend não tem suíte de testes nem build step, então a verificação é:

1. Transpilação do JSX com Babel fora do repositório (pega erro de sintaxe, que
   neste projeto se manifesta como tela branca).
2. Conferência visual pelo dono do produto em **1920×1080**, que é a resolução
   do painel: número legível de longe, gráfico sem corte, Top 5 completo, e a
   saída funcionando pelo botão e pelo Esc.

O item 2 não pode ser automatizado neste ambiente e é parte obrigatória do
aceite.

## 8. Arquivos afetados

- `design_handoff_sistema_feedbacks/p4-faturometro.jsx` — estado do modo, botão,
  `Esc`, sincronia com a URL, prop `limite` na lista
- `design_handoff_sistema_feedbacks/index.html` — bloco de CSS `.fat-tv`
