# Handoff: Sistema de Feedbacks · Método P4

## Overview
Plataforma web para uma agência gerenciar e enviar relatórios ("feedbacks") de performance de Ads dos seus clientes em marketplaces. O sistema cobre:

- **Login** (e-mail + senha) com níveis de acesso **admin** e **analista**.
- **Seleção de cliente** com busca, filtros e um **filtro de envio por data** ("o que precisa ser enviado hoje", incluindo atrasados).
- **Cadastro/edição de cliente**, onde um cliente **agrupa vários marketplaces**, cada um com suas **metas** (Investimento, ROAS, ACOS, TACOS), e onde se define a **agenda de envio** do feedback.
- **Histórico do cliente** com KPIs, gráfico e tabela de relatórios, com abas por marketplace.
- O botão **"Novo relatório"** abre o **Gerador de Relatório P4** (app HTML já existente, incluído no bundle) que produz o PDF do feedback.

O objetivo deste handoff é **construir o backend** (banco de dados + API + autenticação) e ligar as telas a ele.

## About the Design Files
Os arquivos `.html`/`.jsx` deste bundle são **referências de design feitas em HTML/React (via Babel no browser)** — protótipos que mostram a aparência e o comportamento pretendidos, **não** código de produção para copiar diretamente. A tarefa é **recriar estas telas no ambiente do codebase alvo** (React/Next, Vue, etc.), usando os padrões e bibliotecas já estabelecidos lá — e implementar o backend descrito abaixo. Se ainda não houver um ambiente, escolha o framework mais adequado.

Os dados em `p4-data.jsx` são **mock** (clientes, marketplaces, relatórios, usuários, agendas). Eles documentam o **formato dos dados** e devem ser substituídos por leituras reais do banco.

## Fidelity
**High-fidelity (hifi).** Cores, tipografia, espaçamentos e interações são finais. Recrie a UI fielmente usando as bibliotecas do codebase. Os tokens estão listados ao final.

---

## Telas / Views

### 1. Login (`p4-login.jsx`)
- **Propósito**: autenticar o usuário. Não há cadastro aberto — contas são criadas pelo admin.
- **Layout**: card central (max 404px) sobre fundo escuro `#11181f` com leve glow verde e grid sutil. Card `background var(--panel)`, borda `var(--panel-line)`, radius 18px, padding 36/34/28.
- **Componentes**:
  - Marca: logo `assets/p4-mark-white.png` (46px) + "MÉTODO P4" (mono, verde) + "Sistema de Relatórios".
  - Título "Entrar" + subtítulo.
  - Campo **E-mail** (ícone envelope) e **Senha** (ícone cadeado + botão olho mostrar/ocultar). Inputs escuros, foco com anel verde.
  - Linha: checkbox "Manter conectado" + link "Esqueci a senha".
  - Botão primário verde "Entrar" (largura total).
  - Rodapé: "As contas são criadas pelo administrador." + link "Solicitar convite".
- **Comportamento**:
  - Validação: e-mail e senha obrigatórios; senão exibe erro inline (`.login-err`).
  - "Esqueci a senha" → mensagem: *"Para redefinir sua senha, fale com o administrador do sistema."* (no protótipo é `alert`; no produto, um modal/toast).
  - "Solicitar convite" → mensagem orientando falar com o admin.
  - **NÃO há login com Google** (removido).
  - Submit autentica e leva à Seleção de Cliente.

### 2. Seleção de Cliente (`p4-clients.jsx`)
- **Propósito**: listar clientes e identificar o que precisa de envio.
- **Escopo por papel**: **admin** vê todos os clientes; **analista** vê só os clientes onde é o responsável.
- **Topbar** (escura): marca; à direita, chip do usuário (avatar com iniciais + nome + pill do papel) que abre menu (e-mail, "Gerenciar usuários" só admin, "Sair").
- **Cabeçalho**: título ("Todos os clientes" / "Meus clientes") + subtítulo com contagem e nº de atrasados; botão verde "Adicionar cliente" (só admin).
- **Filtro de envio (`.duebar`)**: botão **"Para enviar"** (toggle). Ativo, mostra: seletor de data (`<input type=date>`, default = hoje), botão "Hoje", badge do dia da semana, e badge "+N atrasados".
- **Toolbar**: busca (loja/analista/marketplace) + chips de marketplace (com bolinha na cor da marca) + chips de status (Todos / Em dia / Atrasado).
- **Grade de cards** (`auto-fill minmax(296px,1fr)`, gap 16). Card (`.ccard`, branco, radius 15):
  - Nome da loja (bold 15.5) + linha "Tipo · Analista".
  - Chip de agenda: ícone calendário + "Envio · segundas".
  - Linha de chips de marketplace (cor tonal da marca + bolinha; bolinha vermelha se aquele marketplace está atrasado).
  - Bloco de métricas (fundo `#f6f8f6`): **ROAS médio** (ponderado por faturamento) e **Faturamento** (soma do último de cada marketplace).
  - Rodapé: "Último · <data>" + contagem "N marketplaces · M rel." + lápis **Editar** (admin, aparece no hover).
  - Status pill canto sup. direito: "Em dia" (verde) / "Atrasado" (vermelho).
  - Card tracejado "Adicionar cliente" ao final (admin).
- **Layout alternativo "lista"** (`.clist`): tabela com Loja/Analista, Marketplace, ROAS, Faturamento, Último, Status. (Alternável via Tweaks; pode virar uma preferência do usuário.)
- **Clique no card** → Histórico do cliente.

### 3. Cadastro / Edição de Cliente (`p4-new-client.jsx`)
Mesmo componente serve para **criar** e **editar** (recebe `client` quando edita).
- **Seção 01 · Identificação**: Nome do cliente (texto), Tipo (segmented "Loja"/"Marca"), Analista responsável (select de analistas; travado quando o usuário é analista).
- **Seção 02 · Marketplaces**: lista de **cards de marketplace**. Cada card:
  - Select do marketplace (apenas os 5 suportados; remove os já escolhidos das opções), campo "Identificação da conta" (apelido/ID do seller), botão remover.
  - Linha de **metas**: Investimento (R$), ROAS (x), ACOS (%), TACOS (%) — defaults `20,00 / 4,00 / 20,00 / 15,00`.
  - Botão "+ Adicionar marketplace" (limitado ao nº de marketplaces).
- **Seção 03 · Envio do feedback**: Frequência (segmented "Semanal"/"Quinzenal"/"Mensal"); para Semanal/Quinzenal mostra chips de dia da semana (Seg–Dom, single-select); para Mensal mostra "Dia do mês" (1–28). Preview ao vivo: "Toda segunda-feira" / "Todo dia 5".
- **Rodapé**: "Cancelar" + "Salvar cliente"/"Salvar alterações"; em edição (admin) há "Excluir cliente".
- **Validação**: nome, analista e ≥1 marketplace obrigatórios.

### 4. Histórico do Cliente (`p4-history.jsx`)
- **Cabeçalho**: breadcrumb "Clientes / Histórico"; nome do cliente + status; meta (marketplace selecionado, analista, nº de marketplaces, "Envio · toda segunda-feira"). Ações: "Editar" (admin), "Importar", "Novo relatório" (abre o gerador).
- **Abas por marketplace** (`.mk-tabs`) quando o cliente tem mais de um — cada aba com bolinha na cor da marca e contagem; troca KPIs/gráfico/tabela.
- **KPIs**: Relatórios, ROAS atual (Δ vs. anterior), Faturamento último (Δ), Faturamento acumulado.
- **Gráfico**: faturamento por período (área + linha na cor da marca, últimos 12).
- **Tabela** (`.rtable`): Período, Faturamento, ROAS, ACOS, Status, Marketplace, Ações (Abrir → gerador, Duplicar, Excluir só admin).

### 5. Gerenciar Usuários (modal, em `p4-shell.jsx`)
Admin: lista de usuários (avatar, nome, e-mail, pill do papel) + botão "Convidar". Contas criadas pelo admin.

---

## Interações & Comportamento
- **Navegação** (SPA, em `p4-shell.jsx`): `login → clients → history`; `clients → new`; `clients/history → edit`; back retorna. Persistência da sessão em `localStorage` (`p4-shell-user`).
- **Filtro "Para enviar"**: a lista passa a mostrar clientes cujo feedback está **agendado para a data selecionada OU que estão atrasados** (de qualquer data). Atrasados aparecem **primeiro**. Cabeçalho: "N para enviar · X no dia (dia, data) · Y atrasados".
- **Hover**: cards elevam e ganham borda verde; lápis de editar aparece.
- **Estados vazios**: mensagens específicas para busca/filtro e para "nada para enviar".
- **Responsivo**: grids colapsam; abaixo de 720px o form e a tabela reduzem colunas.

## Regras de Negócio (críticas para o backend)
- **Marketplaces suportados (fazemos ads):** Mercado Livre, Shopee, Magalu, Amazon, Tiktok. Só esses.
- **Cliente agrupa N marketplaces ("contas").** Cada conta tem suas metas e seu próprio histórico de relatórios.
- **Agenda de envio** (por cliente): `{ freq: 'Semanal'|'Quinzenal'|'Mensal', diaSemana?: 'Segunda'..'Domingo', diaMes?: 1..28 }`. Quinzenal = ocorre no dia da semana em **semanas ISO pares**.
- **"Agendado na data D"**: Mensal → `D.dia === diaMes`; Semanal → dia da semana de D == `diaSemana`; Quinzenal → idem + semana ISO de D é par.
- **Atrasado (overdue)** — um cliente está atrasado se **qualquer** das condições for verdadeira:
  1. a ocorrência agendada mais recente **anterior a hoje** é posterior à data do último relatório enviado (de qualquer marketplace) → ou seja, passou uma data de envio sem feedback; **ou**
  2. algum marketplace está com o último relatório há mais de ~9 dias.
  O status "atrasado" é **independente da data** selecionada no filtro.
- **Metas padrão**: Investimento `20,00`, ROAS `4,00`, ACOS `20,00`, TACOS `15,00` (strings no formato BR com vírgula).
- **ROAS médio do cliente** = média ponderada pelo faturamento do último relatório de cada marketplace. **Faturamento do cliente** = soma do último de cada marketplace.

## Modelo de Dados sugerido
```
User        { id, nome, email, senha_hash, papel: 'admin'|'analista' }
Client      { id, loja, tipo: 'Loja'|'Marca', analista_id (User),
              agenda: { freq, diaSemana?, diaMes? } }
Account     { id, client_id, marketplace: enum(5), apelido,
              meta_investimento, meta_roas, meta_acos, meta_tacos }  // "conta"
Report      { id, account_id, periodo_ini, periodo_fim, criado_em,
              faturamento, vendas, receita_ads, vendas_ads, investimento,
              roas, acos, tacos, status_por_metrica, obs, obs_imagens }
```
Campos do Report espelham o payload exportado pelo Gerador (ver `app.jsx`, objeto `EMPTY` e função `fullRestore`/`rollForward`). O gerador já importa/exporta esse JSON — o backend deve persistir o mesmo shape.

## Endpoints sugeridos
```
POST /auth/login                      → { token, user }
POST /auth/logout
GET  /clients            ?due=YYYY-MM-DD&q=&marketplace=&status=
                                       (admin: todos; analista: só os seus)
POST /clients                         (admin) cria cliente + contas + agenda
GET  /clients/:id                     cliente + contas + agenda
PUT  /clients/:id                     (admin) atualiza
DELETE /clients/:id                   (admin)
GET  /clients/:id/accounts/:accId/reports
POST /accounts/:accId/reports         cria relatório (payload do gerador)
DELETE /reports/:id                   (admin)
GET  /users / POST /users             (admin) gerenciar usuários
```
O parâmetro `due=` deve retornar agendados na data **+** atrasados (regra acima).

## Design Tokens
**Cores**
- Verde primário `#56D54F` (texto sobre verde `#0d1410`; verde-tinta legível `#2f9a2b` / `var(--green-ink)`)
- Tinta/escuro `#1C242E`; vermelho `#d8423a`; âmbar `#e0922f`
- Chrome escuro: panel `#161e26`, panel-2 `#1f2a33`, linha `#2c3a45`, texto `#e8eef0`, muted `#8c9aa3`
- Stage (fundo claro) `#eceeec`; papel `#FEFEFE`; linha clara `#e9ece9`; muted `#6b7570`
- **Marketplaces** (marca / tinta legível p/ texto): Mercado Livre `#FFE600`/`#8A7400` · Shopee `#EE4D2D`/`#CC3D1D` · Magalu `#0E89FF`/`#0A6FCC` · Amazon `#232F3E`/`#232F3E` · Tiktok `#FE2858`/`#D6123F`. Fundo do chip = cor da marca a 13% alpha.

**Tipografia**: `Sora` (300–800) para UI; `JetBrains Mono` (400/500/700) para números, labels/kicker e datas.

**Raios**: cards 14–16px; campos/botões 9–10px; chips 999px (pills) ou 7–8px. **Foco**: borda verde + anel `rgba(86,213,79,.12–.14)`.

## Assets
- `assets/p4-mark.png` (logo escuro) e `assets/p4-mark-white.png` (logo claro p/ fundos escuros). Ícones são SVG inline em `p4-icons.jsx`.

## Arquivos neste bundle
- `Sistema P4 — Telas.html` — host das telas (todo o CSS).
- `p4-data.jsx` — dados mock + helpers (agenda, overdue, cores de marketplace, formatação).
- `p4-icons.jsx`, `p4-login.jsx`, `p4-clients.jsx`, `p4-new-client.jsx`, `p4-history.jsx`, `p4-shell.jsx`, `tweaks-panel.jsx`.
- `Gerador de Relatório P4.html` + `app.jsx` + `report.jsx` — gerador de PDF do feedback (define o shape do Report e o import/export JSON).
- `assets/` — logos.
