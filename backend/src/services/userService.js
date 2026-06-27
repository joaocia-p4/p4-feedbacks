// userService — user lookups and creation (admin-managed accounts).
const { v4: uuid } = require('uuid');
const db = require('../db/knex');
const { hashPassword, initials, publicUser } = require('../lib/auth');
const { conflict, notFound, badRequest } = require('../lib/errors');

async function listUsers() {
  const rows = await db('users').select('*').orderBy('nome', 'asc');
  return rows.map(publicUser);
}

async function findByEmail(email) {
  return db('users').whereRaw('lower(email) = ?', [String(email).toLowerCase()]).first();
}

async function findById(id) {
  return db('users').where({ id }).first();
}

// Resolve the responsible analyst from either an id or a name.
async function resolveAnalyst({ analistaId, analista }) {
  if (analistaId) {
    const byId = await findById(analistaId);
    if (!byId) throw notFound('Analista (analistaId) não encontrado.');
    return byId;
  }
  const byName = await db('users').where({ nome: analista }).first();
  if (!byName) throw notFound(`Analista "${analista}" não encontrado.`);
  return byName;
}

async function createUser({ nome, email, senha, papel }) {
  const existing = await findByEmail(email);
  if (existing) throw conflict('Já existe um usuário com este e-mail.');
  const row = {
    id: uuid(),
    nome,
    email: String(email).toLowerCase(),
    senha_hash: await hashPassword(senha),
    papel,
    iniciais: initials(nome),
  };
  await db('users').insert(row);
  return publicUser(row);
}

// Atualiza nome/e-mail/papel/senha (parcial). Salvaguardas: e-mail único e não
// rebaixar o último administrador.
async function updateUser(id, input) {
  const user = await findById(id);
  if (!user) throw notFound('Usuário não encontrado.');

  const patch = {};
  if (input.nome !== undefined) {
    patch.nome = input.nome;
    patch.iniciais = initials(input.nome);
  }
  if (input.email !== undefined) {
    const email = String(input.email).toLowerCase();
    if (email !== user.email) {
      const other = await findByEmail(email);
      if (other && other.id !== id) throw conflict('Já existe um usuário com este e-mail.');
      patch.email = email;
    }
  }
  if (input.papel !== undefined && input.papel !== user.papel) {
    if (user.papel === 'admin' && input.papel !== 'admin' && (await countAdmins()) <= 1) {
      throw conflict('Não é possível rebaixar o último administrador.');
    }
    patch.papel = input.papel;
  }
  if (input.senha) patch.senha_hash = await hashPassword(input.senha);

  if (Object.keys(patch).length) await db('users').where({ id }).update(patch);
  return publicUser({ ...user, ...patch });
}

async function countClients(userId) {
  const row = await db('clients').where({ analista_id: userId }).count({ n: '*' }).first();
  return Number(row.n);
}

async function countAdmins() {
  const row = await db('users').where({ papel: 'admin' }).count({ n: '*' }).first();
  return Number(row.n);
}

// Exclui um usuário com salvaguardas: não a si mesmo, não o último admin, e não
// se ainda for responsável por clientes (a FK clients.analista_id é RESTRICT).
async function deleteUser(id, actingUserId) {
  if (id === actingUserId) throw badRequest('Você não pode excluir o próprio usuário.');
  const user = await findById(id);
  if (!user) throw notFound('Usuário não encontrado.');

  const clients = await countClients(id);
  if (clients > 0) {
    throw conflict(
      `Este usuário é responsável por ${clients} cliente(s). Reatribua os clientes a outro analista antes de excluir.`
    );
  }
  if (user.papel === 'admin' && (await countAdmins()) <= 1) {
    throw conflict('Não é possível excluir o último administrador.');
  }

  await db('users').where({ id }).del();
  return { id, nome: user.nome };
}

module.exports = {
  listUsers,
  findByEmail,
  findById,
  resolveAnalyst,
  createUser,
  updateUser,
  deleteUser,
};
