// Permite que um cliente tenha mais de uma conta no mesmo marketplace
// (ex.: 2 contas Mercado Livre) — remove a restrição única (client_id, marketplace).
// As contas passam a ser identificadas pelo seu id; o apelido as diferencia.

exports.up = async function up(knex) {
  await knex.schema.alterTable('accounts', (t) => {
    t.dropUnique(['client_id', 'marketplace']);
  });
};

exports.down = async function down(knex) {
  // Só consegue voltar se não existirem marketplaces duplicados por cliente.
  await knex.schema.alterTable('accounts', (t) => {
    t.unique(['client_id', 'marketplace']);
  });
};
