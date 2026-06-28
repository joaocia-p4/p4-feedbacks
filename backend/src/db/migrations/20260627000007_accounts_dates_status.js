// Adiciona ciclo de vida por marketplace na tabela accounts:
//   - data_entrada       (ISO YYYY-MM-DD, opcional)
//   - data_encerramento  (ISO YYYY-MM-DD, opcional)
//   - ativo              (boolean, default true — no SQLite vira 0/1)
// Datas como string seguem o padrão do projeto (periodo_ini/periodo_fim) e são
// portáveis entre SQLite (dev) e Postgres (prod). Colunas novas têm default/null,
// então linhas existentes continuam válidas (todas as contas começam ativas).
exports.up = async function up(knex) {
  await knex.schema.alterTable('accounts', (t) => {
    t.string('data_entrada'); // ISO YYYY-MM-DD, nullable
    t.string('data_encerramento'); // ISO YYYY-MM-DD, nullable
    t.boolean('ativo').notNullable().defaultTo(true);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('ativo');
    t.dropColumn('data_encerramento');
    t.dropColumn('data_entrada');
  });
};
