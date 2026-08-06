// Teste HTTP do webhook do Faturômetro: garante, batendo na rota de verdade
// (não chamando handleNotification direto), a restrição que define a Task 5—
// responder 200 ANTES de processar, e erro no processamento nunca virar erro
// de resposta. Isso é o que protege contra um `await` acidental na frente do
// `res.sendStatus(200)` no futuro; um teste que só chama a função pulando a
// rota não pegaria essa regressão.
//
// Fica num arquivo à parte (não em faturometro-sync.test.js) porque subir o
// app de verdade puxa o morgan — aqui controlamos o ambiente sem perturbar os
// testes que já vivem lá.
process.env.NODE_ENV = 'test'; // ANTES de qualquer require do app: desliga o morgan (ver src/app.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-fat-http-'));
process.env.SQLITE_FILE = path.join(tmpDir, 'test.sqlite');
process.env.BUSINESS_TZ = 'America/Sao_Paulo';
process.env.FATUROMETRO_BACKGROUND = 'off'; // sem motor de segundo plano no teste
delete process.env.DATABASE_URL; // garante SQLite mesmo com .env de produção

const db = require('../src/db/knex');
const app = require('../src/app');
const faturometroSync = require('../src/lib/faturometroSync');

let server;
let port;

test.before(async () => {
  await db.migrate.latest();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Prazo da requisição de teste — bem folgado em relação ao tempo real medido
// no código correto (~25-30ms), mas curto o bastante para o teste falhar
// rápido, com mensagem, em vez de travar o processo indefinidamente caso a
// rota volte a esperar o processamento antes de responder.
const PRAZO_MS = 2000;

// POST cru via node:http — sem dependência nova (nada de supertest). Se a rota
// não responder dentro de PRAZO_MS, a promise REJEITA com mensagem legível em
// vez de ficar pendurada — sem isso, uma regressão (await antes do sendStatus)
// trava o teste e todo o resto do arquivo, sem dizer o que houve.
function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
        timeout: PRAZO_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error(`a rota não respondeu em ${PRAZO_MS}ms — provavelmente está processando antes de responder`));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

test('processamento que trava não segura a resposta', async () => {
  // A rota chama `faturometroSync.handleNotification(body)` através do objeto
  // do módulo (não desestruturado no require de integrations.js), então trocar
  // a propriedade aqui é visto pela rota — mesmo instância de módulo.
  const original = faturometroSync.handleNotification;
  faturometroSync.handleNotification = () => new Promise(() => {}); // nunca resolve nem rejeita
  try {
    const inicio = Date.now();
    const r = await post('/integrations/mercadolivre/notifications', {
      topic: 'orders_v2',
      user_id: 1,
      resource: '/orders/1',
    });
    const duracao = Date.now() - inicio;
    assert.equal(r.status, 200);
    // Folga generosa: o objetivo é pegar um `await` acidental antes do
    // sendStatus, não medir desempenho.
    assert.ok(duracao < 1000, `resposta demorou ${duracao}ms — parece estar esperando o processamento`);
  } finally {
    faturometroSync.handleNotification = original;
  }
});

test('processamento que rejeita não vira erro de resposta', async () => {
  const original = faturometroSync.handleNotification;
  faturometroSync.handleNotification = () => Promise.reject(new Error('falha simulada'));
  const rejeicoesNaoTratadas = [];
  const onUnhandled = (err) => rejeicoesNaoTratadas.push(err);
  process.on('unhandledRejection', onUnhandled);
  // A rota loga a falha no catch — é o comportamento correto (Task 5), mas é
  // ruído esperado aqui; silencia só neste teste para a saída ficar limpa.
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const r = await post('/integrations/mercadolivre/notifications', {
      topic: 'orders_v2',
      user_id: 1,
      resource: '/orders/1',
    });
    assert.equal(r.status, 200);
    // Dá um tick para o `.catch` da rota rodar antes de conferir.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rejeicoesNaoTratadas.length, 0, 'a rejeição do stub não deveria escapar como unhandledRejection');
  } finally {
    console.error = originalConsoleError;
    process.off('unhandledRejection', onUnhandled);
    faturometroSync.handleNotification = original;
  }
});
