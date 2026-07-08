// Adiciona os campos de situação do cliente (ativo/onboarding/pausado) + motivo da
// pausa, e a pausa por conta (marketplace). Roda no boot (server.js -> migrate.latest()).

exports.up = async function up(knex) {
  await knex.schema.alterTable('clients', (t) => {
    t.string('situacao').notNullable().defaultTo('ativo'); // 'ativo' | 'onboarding' | 'pausado'
    t.text('motivo_pausa');
  });
  await knex.schema.alterTable('accounts', (t) => {
    t.boolean('pausado').notNullable().defaultTo(false);
    t.text('motivo_pausa');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('situacao');
    t.dropColumn('motivo_pausa');
  });
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('pausado');
    t.dropColumn('motivo_pausa');
  });
};
