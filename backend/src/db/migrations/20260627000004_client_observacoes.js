// Observações por cliente (anotações livres da equipe sobre o cliente).
exports.up = async function up(knex) {
  await knex.schema.alterTable('clients', (t) => {
    t.text('observacoes');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('observacoes');
  });
};
