# Sistema de Feedbacks · Método P4

Plataforma web para a agência gerenciar e enviar relatórios ("feedbacks") de
performance de Ads dos clientes em marketplaces.

| Parte | Pasta | Hospedagem |
|---|---|---|
| Frontend (telas) | `design_handoff_sistema_feedbacks/` | [Vercel](https://p4-feedbacks.vercel.app) |
| Backend (API + auth) | `backend/` | Render (`p4-feedbacks-api.onrender.com`) |
| Banco (produção) | — | Neon (PostgreSQL) |
| Banco (desenvolvimento) | `backend/data/p4.sqlite` | local (SQLite, fora do git) |

> **Deploy:** `git push` na branch `main` publica automaticamente no Vercel e no
> Render. Detalhes da publicação original em [DEPLOY.md](DEPLOY.md).

---

## 🖥️ Configurar em um computador novo

### 1. Pré-requisitos

Instale:

- [Git](https://git-scm.com) (ou o [GitHub CLI](https://cli.github.com), que facilita o login)
- [Node.js](https://nodejs.org) 18 ou mais novo (`node -v` para conferir)
- (Opcional) [Claude Code](https://claude.com/claude-code), se for continuar o desenvolvimento com ele

### 2. Clonar o repositório

> ⚠️ Clone **fora do OneDrive/Dropbox** (ex.: `C:\dev\`). Repositório git dentro
> de pasta sincronizada causa conflitos e lentidão.

```bash
git clone https://github.com/joaocia-p4/p4-feedbacks.git
cd p4-feedbacks
```

Se pedir login, o caminho mais fácil é `gh auth login` (GitHub CLI) com a conta
`joaocia-p4`.

### 3. Instalar e rodar o backend

```bash
cd backend
npm install
npm run dev
```

Pronto — a API sobe em `http://localhost:4000`. Sem `DATABASE_URL` definida, o
backend usa **SQLite local** (`backend/data/p4.sqlite`) e cria as tabelas
sozinho no primeiro boot (migrations automáticas). Produção não é afetada: o
Neon só é usado pelo Render.

**`.env` é opcional em desenvolvimento.** Se precisar (ex.: testar OAuth do
Mercado Livre com `MELI_APP_ID`/`MELI_SECRET`), copie o modelo e preencha:

```bash
copy .env.example .env   # Windows
```

### 4. Trazer os dados locais do PC antigo (opcional)

O banco local **não vai para o GitHub** (protegido pelo `.gitignore`). Para
continuar com os mesmos dados de desenvolvimento do PC antigo:

1. Copie `backend/data/p4.sqlite` do PC antigo (pendrive, OneDrive, etc.)
2. Cole em `backend/data/p4.sqlite` no PC novo (crie a pasta `data` se não existir)

Se preferir começar do zero, apenas rode o backend: com o banco vazio ele cria
um usuário admin inicial (variáveis `ADMIN_*` do `.env`, ou use
`npm run setup` para carregar os dados de demonstração — senha `metodop4`).

### 5. Rodar o frontend

O frontend é estático e o [`config.js`](design_handoff_sistema_feedbacks/config.js)
detecta sozinho o ambiente: em `localhost` aponta para `http://localhost:4000`,
em produção para o Render. Com o backend rodando, sirva a pasta:

```bash
cd design_handoff_sistema_feedbacks
npx serve .
```

E abra a URL que aparecer (ex.: `http://localhost:3000`).

### 6. (Opcional) Memória do Claude Code

Para o Claude do PC novo lembrar do contexto do projeto (regras de negócio,
roadmap, preferências), copie a pasta `C:\Users\<usuário>\.claude` do PC antigo
para o mesmo lugar no PC novo. A memória é indexada pelo **caminho do projeto**;
se o projeto ficar em um caminho diferente, renomeie a subpasta correspondente
dentro de `.claude\projects\` para o novo caminho.

### 7. Conferir que está tudo certo

- [ ] `http://localhost:4000/health` responde OK
- [ ] O frontend abre e o login funciona
- [ ] `git push` de um commit qualquer na `main` dispara deploy no Vercel/Render
      (nada a reconfigurar — os serviços ficam ligados ao GitHub, não ao PC)

---

## Comandos úteis (backend)

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe a API com auto-reload (`--watch`) |
| `npm start` | Sobe a API (modo produção) |
| `npm test` | Roda os testes (`node --test`) |
| `npm run migrate` | Aplica migrations pendentes |
| `npm run seed` | Carrega dados de demonstração |
| `npm run db:reset` | ⚠️ Zera o banco local e recarrega o seed |

## O que NUNCA vai para o git

- `backend/data/` — banco SQLite com dados reais
- `.env` — segredos (JWT, chaves do Mercado Livre)
- `node_modules/` — dependências (recriadas com `npm install`)
