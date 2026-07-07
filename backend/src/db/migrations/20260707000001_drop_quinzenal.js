// Descontinua a frequência "Quinzenal": migra qualquer cliente Quinzenal para
// "Semanal", preservando o dia da semana (ambas usam agenda_dia_semana). Roda no
// boot do backend (server.js -> db.migrate.latest()).

exports.up = async function up(knex) {
  await knex('clients')
    .where({ agenda_freq: 'Quinzenal' })
    .update({ agenda_freq: 'Semanal' });
};

exports.down = async function down() {
  // Sem rollback: não há como saber quais eram Quinzenal após a migração.
};
