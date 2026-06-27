// bootstrap.js — cria um administrador inicial no PRIMEIRO boot, quando o banco
// ainda está vazio. Usa ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD do ambiente.
// É idempotente: se já existir qualquer usuário, não faz nada — então rodar de
// novo (a cada deploy) é seguro.
const db = require('../db/knex');
const userService = require('../services/userService');

async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const senha = process.env.ADMIN_PASSWORD;
  const nome = process.env.ADMIN_NAME || 'Administrador';

  if (!email || !senha) return; // sem credenciais definidas → não faz nada

  const row = await db('users').count({ n: '*' }).first();
  if (Number(row.n) > 0) return; // já há usuários → não recria

  await userService.createUser({ nome, email, senha, papel: 'admin' });
  // eslint-disable-next-line no-console
  console.log(`[bootstrap] administrador inicial criado: ${email}`);
}

module.exports = { bootstrapAdmin };
