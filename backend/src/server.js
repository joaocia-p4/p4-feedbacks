// Server entry. Runs pending migrations on boot (idempotent — convenient for
// PaaS deploys) then starts listening.
const app = require('./app');
const config = require('./config');
const db = require('./db/knex');
const { bootstrapAdmin } = require('./lib/bootstrap');
const { notifyError } = require('./lib/notify');

// Promessas rejeitadas sem tratamento → loga e alerta (não derruba o processo).
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledRejection]', reason);
  notifyError('unhandledRejection', reason);
});

async function start() {
  try {
    await db.migrate.latest();
    // eslint-disable-next-line no-console
    console.log(`[db] migrations up-to-date (${db.isPg ? 'postgres' : 'sqlite'})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[db] migration failed:', err.message);
    process.exit(1);
  }

  // Cria o admin inicial no primeiro deploy (se ADMIN_EMAIL/ADMIN_PASSWORD
  // estiverem definidos e o banco estiver vazio). Não derruba o boot se falhar.
  try {
    await bootstrapAdmin();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[bootstrap] falha ao criar admin inicial:', err.message);
  }

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[api] Método P4 ouvindo em http://localhost:${config.port} (${config.env})`);
  });

  const shutdown = (signal) => {
    // eslint-disable-next-line no-console
    console.log(`\n[api] ${signal} recebido, encerrando…`);
    server.close(() => db.destroy().then(() => process.exit(0)));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
