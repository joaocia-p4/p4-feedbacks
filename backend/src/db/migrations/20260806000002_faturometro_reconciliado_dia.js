// Faturômetro — varredura de ONTEM, uma vez por conta por dia.
//
// O rodízio só mirava `hoje`, e o backfill carimbava o dia corrente como
// preenchido no meio da tarde: depois disso ninguém mais voltava a um dia já
// fechado. No Render free (que hiberna), a última conferência de um dia é a
// última vez que alguém abriu a tela — todo pedido criado depois disso só entra
// se o webhook pegou a instância acordada. O consolidado escorria para baixo um
// pouco a cada dia, e com ele todo total mensal e toda comparação mês a mês.
//
// `reconciliado_dia` guarda o dia em que a conta já teve ONTEM reconferido.
// Anterior a hoje = ainda falta a varredura do dia de hoje.
//
// Migration NOVA de propósito: a 20260806000001 já rodou em bancos de
// desenvolvimento e não pode ser editada.

exports.up = async function up(knex) {
  await knex.schema.alterTable('faturometro_sync', (t) => {
    t.string('reconciliado_dia', 10); // 'YYYY-MM-DD' da última varredura de ontem
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('faturometro_sync', (t) => {
    t.dropColumn('reconciliado_dia');
  });
};
