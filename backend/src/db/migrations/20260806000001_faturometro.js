// Faturômetro — faturamento da carteira ao vivo.
//
// faturometro_orders é o LIVRO: uma linha por pedido do Mercado Livre, chaveada
// pelo id do pedido. É essa chave que torna webhook, reconciliação e backfill
// idempotentes — gravar o mesmo pedido de novo atualiza, nunca soma em dobro.
//
// faturometro_daily é o CONSOLIDADO que a tela lê. Sobrevive ao expurgo do livro
// (70 dias), então o histórico não se perde, só a granularidade por hora.
//
// Ids vão como t.string, NUNCA t.uuid: no Postgres a coluna nativa quebraria a FK
// contra o varchar de accounts.id e derrubaria o boot.

exports.up = async function up(knex) {
  await knex.schema.createTable('faturometro_orders', (t) => {
    t.string('order_id').primary(); // id do pedido no ML
    t.string('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('dia', 10).notNullable(); // 'YYYY-MM-DD' no fuso de São Paulo
    t.string('criado_em_ml').notNullable(); // ISO do pedido — dá a curva por hora
    t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
    t.integer('unidades').notNullable().defaultTo(0);
    t.string('comprador_id'); // alimenta "Total de compradores"
    t.string('atualizado_em').notNullable();
    t.index(['account_id', 'dia']);
    t.index(['dia']);
  });

  await knex.schema.createTable('faturometro_daily', (t) => {
    t.string('id').primary();
    t.string('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('dia', 10).notNullable();
    t.decimal('faturamento', 14, 2).notNullable().defaultTo(0);
    t.integer('unidades').notNullable().defaultTo(0);
    t.integer('pedidos').notNullable().defaultTo(0);
    t.string('atualizado_em').notNullable();
    t.unique(['account_id', 'dia']);
  });

  await knex.schema.createTable('faturometro_sync', (t) => {
    t.string('account_id').primary().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('backfill_dia', 10); // dia mais antigo já preenchido; null = nunca rodou
    t.string('backfill_status').notNullable().defaultTo('pendente'); // pendente|rodando|pronto
    t.string('reconciliado_em'); // ISO da última conferência de hoje
    t.text('erro'); // último erro (ex.: token expirado); null quando deu certo
    t.string('atualizado_em').notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('faturometro_sync');
  await knex.schema.dropTableIfExists('faturometro_daily');
  await knex.schema.dropTableIfExists('faturometro_orders');
};
