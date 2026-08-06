// Teste HTTP das rotas do Faturômetro: confirma, batendo nas rotas DE VERDADE
// (não chamando authenticate/faturometroService direto), que GET /faturometro
// e POST /faturometro/reconciliar exigem token (401) e são exclusivas de
// admin — analista e cs tomam 403, só admin passa (200). Um teste que só
// chama a função de dentro pularia o roteamento/middleware de verdade e não
// pegaria uma regressão tipo "esqueceu o authenticate na rota nova".
//
// Mesmo padrão de faturometro-webhook-http.test.js: http NATIVO do Node
// subindo o app de verdade (sem supertest — o projeto não tem essa
// dependência e não pode ganhar uma nova), SQLite descartável.
process.env.NODE_ENV = 'test'; // ANTES de qualquer require do app: desliga o morgan (ver src/app.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-fat-http-auth-'));
process.env.SQLITE_FILE = path.join(tmpDir, 'test.sqlite');
process.env.BUSINESS_TZ = 'America/Sao_Paulo';
process.env.FATUROMETRO_BACKGROUND = 'off'; // sem motor de segundo plano no teste
delete process.env.DATABASE_URL; // garante SQLite mesmo com .env de produção

const db = require('../src/db/knex');
const app = require('../src/app');
const { signToken } = require('../src/lib/auth');

let server;
let port;

// Um usuário por papel. `authenticate` recarrega o papel do BANCO a cada
// requisição (para revogar/editar não continuar valendo com token velho), então
// o usuário precisa existir de verdade — assinar um token para um id que não
// existe cairia no "Usuário não encontrado" (401), não no 403 que queremos medir.
const USERS = {
  admin: { id: 'u-fat-http-admin', nome: 'Admin Fat', email: 'admin@fat-http.test', papel: 'admin' },
  analista: { id: 'u-fat-http-analista', nome: 'Analista Fat', email: 'analista@fat-http.test', papel: 'analista' },
  cs: { id: 'u-fat-http-cs', nome: 'CS Fat', email: 'cs@fat-http.test', papel: 'cs' },
};

test.before(async () => {
  await db.migrate.latest();
  await db('users').insert(
    Object.values(USERS).map((u) => ({ ...u, senha_hash: 'x' }))
  ).onConflict('id').ignore();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const PRAZO_MS = 2000;

// Requisição crua via node:http — sem dependência nova (nada de supertest).
function req(method, pathname, token) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers, timeout: PRAZO_MS },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    r.on('timeout', () => r.destroy(new Error(`a rota não respondeu em ${PRAZO_MS}ms`)));
    r.on('error', reject);
    r.end();
  });
}

const tokenDe = (papel) => signToken(USERS[papel]);

for (const [metodo, rota] of [['GET', '/faturometro'], ['POST', '/faturometro/reconciliar']]) {
  test(`${metodo} ${rota} sem token → 401`, async () => {
    const r = await req(metodo, rota, null);
    assert.equal(r.status, 401);
  });

  test(`${metodo} ${rota} com token de analista → 403`, async () => {
    const r = await req(metodo, rota, tokenDe('analista'));
    assert.equal(r.status, 403);
  });

  test(`${metodo} ${rota} com token de cs → 403`, async () => {
    const r = await req(metodo, rota, tokenDe('cs'));
    assert.equal(r.status, 403);
  });

  test(`${metodo} ${rota} com token de admin → 200`, async () => {
    const r = await req(metodo, rota, tokenDe('admin'));
    assert.equal(r.status, 200);
  });
}
