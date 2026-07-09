// Registra QUANDO a agenda do cliente foi trocada pela última vez
// (agenda_alterada_em, ISO YYYY-MM-DD, nullable). Usado pela regra de atraso:
// os "envios anteriores" de uma agenda recém-trocada são fictícios, então o
// cliente só volta a ser cobrado depois que o primeiro envio REAL da agenda
// nova passar — trocar a agenda não pode marcar atrasado retroativamente.
exports.up = async function up(knex) {
  await knex.schema.alterTable('clients', (t) => {
    t.string('agenda_alterada_em');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('agenda_alterada_em');
  });
};
