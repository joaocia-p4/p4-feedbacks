// Adiciona "salvo_em" (quando o relatório foi efetivamente gerado/salvo no
// sistema) — usado para contar relatórios gerados por semana no painel.
// Diferente de "criado_em" (que é o fim do período do relatório).

exports.up = async function up(knex) {
  await knex.schema.alterTable('reports', (t) => {
    t.string('salvo_em');
  });
  // Backfill: nos relatórios já existentes, usa criado_em como referência.
  await knex.raw('update reports set salvo_em = criado_em where salvo_em is null');
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('reports', (t) => {
    t.dropColumn('salvo_em');
  });
};
