// Lançamento manual dos números do mês, por conta. Substitui a soma dos
// relatórios semanais no fechamento: semana não respeita virada de mês, então
// quem lança é quem sabe separar o que foi de cada mês.
// LINHA AUSENTE != LINHA ZERADA: sem linha = "não lançado"; com 0 = não faturou.

exports.up = async function up(knex) {
  await knex.schema.createTable('monthly_figures', (t) => {
    // uuid vai como string, NUNCA t.uuid: as demais tabelas usam string e no
    // Postgres t.uuid viraria coluna nativa, com FK incompatível contra o
    // varchar de accounts.id — o que derruba o boot.
    t.string('id').primary();
    t.string('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('ym', 7).notNullable(); // '2026-07'
    t.decimal('faturamento', 14, 2).notNullable().defaultTo(0);
    t.decimal('investimento', 14, 2).notNullable().defaultTo(0);
    t.decimal('receita_ads', 14, 2).notNullable().defaultTo(0);
    t.timestamp('criado_em').notNullable().defaultTo(knex.fn.now());
    t.timestamp('atualizado_em').notNullable().defaultTo(knex.fn.now());
    t.string('atualizado_por').references('id').inTable('users').onDelete('SET NULL');
    t.unique(['account_id', 'ym']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('monthly_figures');
};
