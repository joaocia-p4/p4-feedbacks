// Conexões OAuth com o Mercado Livre — uma por conta (account). Guarda os
// tokens para o sistema buscar os dados (vendas/anúncios) automaticamente.
exports.up = async function up(knex) {
  await knex.schema.createTable('meli_connections', (t) => {
    t.string('id').primary();
    t.string('account_id')
      .notNullable()
      .references('id')
      .inTable('accounts')
      .onDelete('CASCADE');
    t.string('ml_user_id'); // id do vendedor no Mercado Livre
    t.string('nickname'); // apelido do vendedor (exibição)
    t.text('access_token').notNullable();
    t.text('refresh_token');
    t.string('scope');
    t.string('expires_at'); // ISO datetime de expiração do access_token
    t.timestamp('criado_em').defaultTo(knex.fn.now());
    t.string('atualizado_em'); // ISO datetime da última atualização de token
    t.unique('account_id'); // uma conexão por conta
    t.index('account_id');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('meli_connections');
};
