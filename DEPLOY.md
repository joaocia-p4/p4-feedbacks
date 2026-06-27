# 🚀 Guia de publicação — Sistema de Feedbacks · Método P4

Este guia coloca o sistema **online de graça** com:

- **Frontend** (as telas) → **Vercel**
- **Backend** (API) → **Render**
- **Banco de dados** → **Neon** (PostgreSQL)

> Arquitetura: o site (Vercel) conversa com a API (Render), que guarda tudo no
> banco (Neon). São 3 serviços gratuitos. Tempo estimado: ~30 minutos.

---

## Visão geral (a ordem importa)

1. Subir o código no **GitHub**
2. Criar o banco no **Neon** (pegar a connection string)
3. Publicar o **backend no Render** (pegar a URL da API)
4. Apontar o frontend para a API (`config.js`) e publicar no **Vercel**
5. Liberar o **CORS** no Render para a URL do Vercel
6. Testar e usar

---

## 0. Pré-requisitos

- Conta no [GitHub](https://github.com), [Neon](https://neon.tech), [Render](https://render.com) e [Vercel](https://vercel.com) (dá para entrar com a conta do GitHub em todos).
- **Git** instalado (já usamos aqui localmente).

---

## 1. Subir no GitHub

O repositório **já está iniciado e com um commit local** (feito aqui). Seus dados
reais (`backend/data/p4.sqlite`) e segredos (`.env`) **estão protegidos** pelo
`.gitignore` — não vão para o GitHub.

1. No GitHub, crie um repositório **vazio** (sem README, sem .gitignore), ex.: `p4-feedbacks`.
2. No terminal, dentro da pasta **`Sistema de Feedbacks`**, rode (troque a URL pela do seu repo):

   ```bash
   git remote add origin https://github.com/SEU-USUARIO/p4-feedbacks.git
   git branch -M main
   git push -u origin main
   ```

3. Confirme no GitHub que **não** apareceu a pasta `backend/data` nem nenhum `.env`. ✅

---

## 2. Criar o banco no Neon (PostgreSQL)

1. Entre no [Neon](https://neon.tech) → **New Project**.
2. Dê um nome (ex.: `p4-feedbacks`) e escolha a região mais próxima (ex.: AWS São Paulo).
3. Ao criar, o Neon mostra a **Connection string**. Copie a versão **"Pooled connection"**, algo como:

   ```
   postgresql://usuario:senha@ep-xxxx-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Guarde essa string — você vai colá-la no Render no próximo passo.

> As tabelas são criadas **automaticamente** pelo backend no primeiro boot (migrations). Você não precisa rodar nada no banco.

---

## 3. Publicar o backend no Render

1. No [Render](https://render.com) → **New** → **Web Service** → conecte sua conta do GitHub e selecione o repositório `p4-feedbacks`.
2. Configure:
   - **Root Directory:** `backend`
   - **Runtime/Language:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
   - **Health Check Path:** `/health`
3. Em **Environment Variables**, adicione:

   | Chave | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | *(a connection string do Neon, do passo 2)* |
   | `DATABASE_SSL` | `true` |
   | `JWT_SECRET` | *(uma string longa e aleatória — veja abaixo)* |
   | `BUSINESS_TZ` | `America/Sao_Paulo` |
   | `CORS_ORIGIN` | `*` *(temporário; apertamos no passo 5)* |
   | `ADMIN_NAME` | `João Pedro` *(seu nome de admin)* |
   | `ADMIN_EMAIL` | `voce@suaempresa.com` *(e-mail de login do admin)* |
   | `ADMIN_PASSWORD` | *(uma senha forte — é a sua senha de login)* |

   **Gerar um `JWT_SECRET` aleatório** (rode no terminal):
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   (Ou use o botão **"Generate"** do próprio Render.)

4. Clique em **Create Web Service**. O Render vai instalar, rodar as migrations e
   **criar o admin inicial** (a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD`).
5. Quando terminar, copie a **URL pública** da API (ex.: `https://p4-feedbacks-api.onrender.com`).
6. **Teste:** abra `https://SUA-API.onrender.com/health` no navegador → deve responder `{"status":"ok"}`.

> ⏱️ **Cold start:** no plano Free, o backend "dorme" após ~15 min sem uso. O
> primeiro acesso depois disso leva ~30–50s para acordar. Os seguintes são rápidos.
> (Para eliminar isso, há planos pagos a partir de ~US$7/mês.)

---

## 4. Apontar o frontend para a API e publicar no Vercel

### 4.1 Apontar para a API
1. Edite o arquivo **`design_handoff_sistema_feedbacks/config.js`** e troque a URL de produção pela do Render (passo 3.5), **sem barra no final**:

   ```js
   window.P4_API_BASE = local
     ? 'http://localhost:4000'
     : 'https://p4-feedbacks-api.onrender.com'; // ← sua URL do Render
   ```

2. Salve, faça commit e push:
   ```bash
   git add design_handoff_sistema_feedbacks/config.js
   git commit -m "config: aponta o frontend para a API em produção"
   git push
   ```

### 4.2 Publicar no Vercel
1. No [Vercel](https://vercel.com) → **Add New… → Project** → importe o repositório `p4-feedbacks`.
2. Configure:
   - **Root Directory:** `design_handoff_sistema_feedbacks`
   - **Framework Preset:** **Other** (não tem build — são arquivos estáticos)
   - Deixe Build/Output em branco.
3. Clique em **Deploy**.
4. Copie a **URL do site** (ex.: `https://p4-feedbacks.vercel.app`).

---

## 5. Liberar o CORS para o site (segurança)

Agora que você tem a URL do Vercel, restrinja a API para aceitar **só** o seu site:

1. No **Render** → seu serviço → **Environment** → edite `CORS_ORIGIN`:
   ```
   https://p4-feedbacks.vercel.app
   ```
   (a URL do Vercel, sem barra no final; use vírgula para mais de uma origem)
2. Salve — o Render faz **redeploy** automático.

---

## 6. Testar e usar

1. Abra a URL do **Vercel**.
2. Faça login com o **`ADMIN_EMAIL` / `ADMIN_PASSWORD`** que você definiu no Render.
3. Crie os usuários (Gustavo, CS, etc.) e os clientes pela própria interface. 🎉

---

## 🔄 Atualizações futuras

Sempre que você editar o código e fizer `git push`:
- O **Render** reimplanta o backend automaticamente.
- O **Vercel** reimplanta o frontend automaticamente.

Sem passos manuais.

---

## 🆘 Solução de problemas

- **"Failed to fetch" / erro de CORS no site:** confira que (a) o `config.js`
  aponta para a URL **https** correta do Render (sem barra final) e (b) o
  `CORS_ORIGIN` no Render é exatamente a URL do Vercel. Os dois precisam bater.
- **O site demora ~40s no primeiro acesso:** é o *cold start* do Render Free
  (o backend estava dormindo). Normal.
- **Login não funciona / "usuário não encontrado":** confirme que `ADMIN_EMAIL`
  e `ADMIN_PASSWORD` estão definidos no Render e veja nos **Logs** do Render a
  linha `[bootstrap] administrador inicial criado: ...`. Esse admin só é criado
  quando o banco está **vazio** (primeiro deploy).
- **Build do backend falhou em `better-sqlite3`:** ele só é usado localmente
  (em produção usamos Postgres). Se acontecer, adicione no Render a variável
  `NODE_VERSION=20` e reimplante.
- **Quero zerar o banco online:** no Neon, é possível resetar o banco; no
  próximo boot o backend recria as tabelas e o admin inicial.

---

## ℹ️ Notas técnicas

- **Banco:** o backend escolhe PostgreSQL automaticamente quando `DATABASE_URL`
  está definida; sem ela, cai para SQLite local (desenvolvimento).
- **Migrations + admin** rodam sozinhos no boot (`src/server.js`).
- **Imagens das observações** são salvas como base64 no próprio banco — não
  dependem de armazenamento de arquivos.
- **Frontend** usa React + Babel via CDN (compila no navegador). Funciona em
  produção; uma otimização futura é pré-compilar o JSX para carregar mais rápido.
- **Variáveis de ambiente** completas e comentadas: veja `backend/.env.example`.
