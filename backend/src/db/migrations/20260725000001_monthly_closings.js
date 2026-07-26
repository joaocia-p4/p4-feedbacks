// Fechamento mensal por cliente: observação do mês + marca de fechado.
// fechado_em NULL = mês aberto (a linha pode existir só com a observação).
// Roda no boot (server.js -> migrate.latest()).

exports.up = async function up(knex) {
  await knex.schema.createTable('monthly_closings', (t) => {
    t.string('id').primary();
    t.string('client_id').notNullable().references('id').inTable('clients').onDelete('CASCADE');
    t.string('ym', 7).notNullable(); // '2026-07'
    t.text('observacoes');
    t.timestamp('fechado_em');
    t.string('fechado_por').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('criado_em').notNullable().defaultTo(knex.fn.now());
    t.timestamp('atualizado_em').notNullable().defaultTo(knex.fn.now());
    t.unique(['client_id', 'ym']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('monthly_closings');
};
