// Amplia colunas de meli_connections para TEXT. No Postgres, t.string() vira
// varchar(255) e valores do OAuth (scope, etc.) podem passar disso. No SQLite
// não há limite de varchar, então a alteração só é necessária no Postgres.
exports.up = async function up(knex) {
  const dialect = knex.client.dialect || (knex.client.config && knex.client.config.client) || '';
  if (!/pg|postg/i.test(dialect)) return; // só Postgres impõe o limite

  await knex.schema.alterTable('meli_connections', (t) => {
    t.text('ml_user_id').alter();
    t.text('nickname').alter();
    t.text('scope').alter();
    t.text('expires_at').alter();
    t.text('atualizado_em').alter();
  });
};

exports.down = async function down(_knex) {
  // Sem reversão: ampliar para TEXT é seguro e não há perda de dados.
};
