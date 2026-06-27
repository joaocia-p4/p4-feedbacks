# Backend — Sistema de Feedbacks · Método P4

API + banco de dados + autenticação para a plataforma de relatórios de Ads.
Construído a partir do handoff em `../design_handoff_sistema_feedbacks` — toda a
regra de negócio (agenda de envio, "atrasado", ROAS médio ponderado, fórmulas de
ROAS/ACOS/TACOS) foi portada **fielmente** dos protótipos `p4-data.jsx` e
`report.jsx`.

- **Stack:** Node.js + Express
- **Banco:** SQLite no desenvolvimento (zero-config) · PostgreSQL em produção
  — o mesmo código roda nos dois (camada Knex).
- **Auth:** JWT + bcrypt. Contas são criadas pelo admin (não há cadastro aberto).

---

## 1. Requisitos

- Node.js 18+ (testado no 24)
- npm 9+

## 2. Início rápido (local, SQLite)

```bash
cd backend
npm install
cp .env.example .env        # no Windows (PowerShell): Copy-Item .env.example .env
npm run setup               # cria o banco (migrations) e popula os mocks (seed)
npm start                   # sobe a API em http://localhost:4000
```

Pronto. A API estará em `http://localhost:4000`. O banco SQLite fica em
`backend/data/p4.sqlite` (ignorado pelo Git).

### Credenciais do seed

Todos os usuários mock usam a senha definida em `SEED_PASSWORD` (padrão **`metodop4`**):

| E-mail               | Papel    | Nome          |
| -------------------- | -------- | ------------- |
| `diego@metodop4.com` | admin    | Diego Martins |
| `ana@metodop4.com`   | analista | Ana Prado     |
| `bruno@metodop4.com` | analista | Bruno Reis    |
| `carla@metodop4.com` | analista | Carla Nunes   |

## 3. Scripts npm

| Comando                    | O que faz                                            |
| -------------------------- | ---------------------------------------------------- |
| `npm start`                | Sobe a API (roda migrations pendentes no boot)       |
| `npm run dev`              | Igual, com auto-reload (`node --watch`)              |
| `npm run migrate`          | Aplica as migrations                                 |
| `npm run seed`             | Popula o banco com os dados mock                     |
| `npm run setup`            | `migrate` + `seed`                                   |
| `npm run db:reset`         | Recria tudo do zero (rollback + migrate + seed)      |

---

## 4. Variáveis de ambiente (`.env`)

| Variável         | Padrão                  | Descrição                                                        |
| ---------------- | ----------------------- | --------------------------------------------------------------- |
| `PORT`           | `4000`                  | Porta HTTP                                                       |
| `NODE_ENV`       | `development`           | `production` exige `JWT_SECRET` forte                            |
| `CORS_ORIGIN`    | `*`                     | Origem(ns) do front. Em produção, a URL do site (vírgula p/ N)  |
| `BUSINESS_TZ`    | `America/Sao_Paulo`     | Fuso para calcular "hoje" (status atrasado / filtro de envio)   |
| `JWT_SECRET`     | _(inseguro)_            | **Troque em produção** por uma string longa e aleatória         |
| `JWT_EXPIRES_IN` | `7d`                    | Validade do token                                               |
| `DATABASE_URL`   | _(vazio)_               | Se definida → PostgreSQL. Se vazia → SQLite local               |
| `DATABASE_SSL`   | `false`                 | `true` para provedores que exigem SSL (Render/Heroku)           |
| `SQLITE_FILE`    | `./data/p4.sqlite`      | Caminho do arquivo SQLite (modo local)                          |
| `SEED_PASSWORD`  | `metodop4`              | Senha aplicada aos usuários do seed (apenas dev/demo)           |

---

## 5. API

Base: `http://localhost:4000`. Respostas em JSON. Autenticação por
`Authorization: Bearer <token>` (obtido no login).

### Auth
| Método | Rota           | Acesso  | Corpo / Notas                                      |
| ------ | -------------- | ------- | -------------------------------------------------- |
| POST   | `/auth/login`  | público | `{ email, senha }` → `{ token, user }`             |
| POST   | `/auth/logout` | público | Stateless: o cliente apenas descarta o token       |
| GET    | `/auth/me`     | logado  | `{ user }` do token atual                          |

### Clients
| Método | Rota                                          | Acesso | Notas                                                       |
| ------ | --------------------------------------------- | ------ | ----------------------------------------------------------- |
| GET    | `/clients?due=&q=&marketplace=&status=`       | logado | admin: todos · analista: só os seus. Filtros abaixo         |
| GET    | `/clients/:id`                                | logado | Cliente + contas + agenda + relatórios por conta            |
| POST   | `/clients`                                    | admin  | Cria cliente + contas + agenda                              |
| PUT    | `/clients/:id`                                | admin  | Atualiza (reconcilia contas)                                |
| DELETE | `/clients/:id`                                | admin  | Remove cliente (cascata: contas + relatórios)               |
| GET    | `/clients/:id/accounts/:accId/reports`        | logado | Relatórios de uma conta (mais novo primeiro)                |

**Filtros de `GET /clients`:**
- `due=YYYY-MM-DD` → retorna clientes **agendados na data** + **todos os atrasados**
  (atrasados primeiro). O status "atrasado" é independente da data.
- `q=` → busca em loja / analista / marketplace.
- `marketplace=` → nome de um dos 5 marketplaces (ou `Todos`).
- `status=` → `Em dia` | `Atrasado` | `Todos`.

A resposta inclui `meta` com `{ total, late, asOf }` e, quando `due` é usado,
`{ due, weekday, scheduled, toSend }` — para o cabeçalho "N para enviar · X no dia · Y atrasados".

### Reports
| Método | Rota                         | Acesso              | Notas                                       |
| ------ | ---------------------------- | ------------------- | ------------------------------------------- |
| POST   | `/accounts/:accId/reports`   | admin ou analista†  | Cria relatório a partir do payload do gerador |
| DELETE | `/reports/:id`               | admin               | Remove um relatório                         |

† o analista responsável pelo cliente da conta.

O **payload** do `POST` é exatamente o JSON exportado pelo *Gerador de Relatório P4*
(o objeto `EMPTY`/`fullRestore` do `app.jsx`). O backend guarda o payload inteiro e
extrai colunas numéricas (faturamento, roas, acos…) aplicando o auto-cálculo das
métricas para KPIs e ordenação.

### Users (admin)
| Método | Rota      | Corpo                                   |
| ------ | --------- | --------------------------------------- |
| GET    | `/users`  | Lista usuários (sem hash de senha)      |
| POST   | `/users`  | `{ nome, email, senha, papel }`         |

### Exemplos (cURL)

```bash
# Login
curl -s -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"diego@metodop4.com","senha":"metodop4"}'

# Lista de clientes "para enviar" hoje (use o token retornado acima)
TOKEN=...
curl -s "http://localhost:4000/clients?due=2026-06-27" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 6. Modelo de dados

```
users    ( id, nome, email, senha_hash, papel[admin|analista], iniciais )
clients  ( id, loja, tipo[Loja|Marca], analista_id→users,
           agenda_freq[Semanal|Quinzenal|Mensal], agenda_dia_semana?, agenda_dia_mes? )
accounts ( id, client_id→clients, marketplace[5], apelido,
           meta_investimento, meta_roas, meta_acos, meta_tacos )   -- a "conta"
reports  ( id, account_id→accounts, periodo_ini, periodo_fim, criado_em,
           faturamento, vendas, receita_ads, vendas_ads, investimento,
           roas, acos, tacos,            -- colunas numéricas derivadas
           payload                       -- JSON completo do gerador )
```

Regras críticas implementadas em [`src/lib/p4.js`](src/lib/p4.js) e
[`src/lib/clientAggregate.js`](src/lib/clientAggregate.js):
- **Marketplaces:** Mercado Livre, Shopee, Magalu, Amazon, Tiktok (só esses).
- **Agenda / "agendado na data D":** Mensal = dia do mês; Semanal = dia da semana;
  Quinzenal = dia da semana em semanas ISO **pares**.
- **Atrasado:** passou uma data de envio agendada sem relatório **ou** algum
  marketplace está há mais de ~9 dias sem relatório.
- **ROAS médio** = média ponderada pelo faturamento do último relatório de cada
  conta. **Faturamento do cliente** = soma do último de cada conta.

---

## 7. Subir no GitHub e hospedar (sistema web)

O GitHub guarda o **código**; ele não roda o servidor nem o banco. Fluxo recomendado:

1. **Versionar** (a partir da raiz do projeto, ou só da pasta `backend/`):
   ```bash
   cd backend
   git init
   git add .
   git commit -m "Backend P4"
   git branch -M main
   git remote add origin https://github.com/<voce>/<repo>.git
   git push -u origin main
   ```
   O `.gitignore` já exclui `node_modules/`, `.env` e o banco SQLite.

2. **Hospedar** em uma plataforma que rode Node + tenha PostgreSQL gerenciado —
   ex.: **Render**, **Railway** ou **Fly.io** (todas com plano gratuito):
   - Crie um **PostgreSQL** gerenciado e copie a connection string.
   - Crie um **Web Service** apontando para o repo. Build: `npm install` ·
     Start: `npm start`.
   - Configure as variáveis: `DATABASE_URL` (a do Postgres), `JWT_SECRET`
     (string longa aleatória), `NODE_ENV=production`, `CORS_ORIGIN`
     (URL do front) e, opcionalmente, `DATABASE_SSL=true`.
   - No primeiro deploy, rode `npm run seed` uma vez (console da plataforma) se
     quiser os dados de demonstração. As migrations rodam sozinhas no boot.

**Qual banco é o melhor?** Para um sistema web em produção com vários usuários,
**PostgreSQL** — persistência confiável e oferta gerenciada em todo lugar. Para
desenvolver no seu PC, **SQLite** (já é o padrão, zero-config). Este backend
suporta os dois sem mudar código: é só definir (ou não) `DATABASE_URL`.

---

## 8. Conectando as telas (front-end)

Os arquivos `.jsx` do handoff são **protótipos de design** que hoje leem dados mock
de `window.P4_*`. Para ligá-los a esta API, substitua essas leituras por chamadas
`fetch` com o token JWT. Os formatos de resposta já espelham o que as telas
esperam (`status`, `roasW`, `fatLatest`, `contas`, `reports` com `ok`, etc.).
Esta etapa é de front-end e pode ser feita em seguida — o backend já entrega tudo
que as telas consomem.

---

## 9. Estrutura

```
backend/
├── knexfile.js              # Config Knex (escolhe SQLite ou Postgres)
├── src/
│   ├── server.js            # Entry (migrate no boot + listen)
│   ├── app.js               # Express: middleware + rotas + erros
│   ├── config.js            # Variáveis de ambiente
│   ├── db/
│   │   ├── knex.js          # Instância Knex compartilhada
│   │   ├── migrations/      # Schema (portável SQLite/Postgres)
│   │   └── seeds/           # Dados mock (p4-data.jsx)
│   ├── lib/
│   │   ├── p4.js            # Regras de negócio (agenda, overdue, métricas)
│   │   ├── clientAggregate.js  # ROAS ponderado + status do cliente
│   │   ├── auth.js          # bcrypt + JWT
│   │   └── errors.js        # AppError + asyncHandler
│   ├── middleware/          # auth, validate (zod), error
│   ├── validators/          # schemas zod
│   ├── services/            # client / report / user
│   └── routes/              # auth / clients / reports / users
└── README.md
```
