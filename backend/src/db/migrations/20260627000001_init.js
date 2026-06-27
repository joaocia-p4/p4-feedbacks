// Initial schema — portable across SQLite (dev) and PostgreSQL (prod).
//
// Mirrors the README's "Modelo de Dados sugerido":
//   User    → users
//   Client  → clients      (agenda stored as freq + dia_semana / dia_mes)
//   Account → accounts     ("conta": a client's marketplace with its metas)
//   Report  → reports      (full generator payload + extracted numeric columns)
//
// Enum-like fields (papel, tipo, marketplace, agenda_freq) are plain strings;
// they are validated at the API layer (zod), which keeps the schema portable
// and easy to evolve.

const DOUBLE = 'double precision'; // returns JS numbers on both pg and sqlite

exports.up = async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.string('id').primary();
    t.string('nome').notNullable();
    t.string('email').notNullable().unique();
    t.string('senha_hash').notNullable();
    t.string('papel').notNullable(); // 'admin' | 'analista'
    t.string('iniciais');
    t.timestamp('criado_em').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('clients', (t) => {
    t.string('id').primary();
    t.string('loja').notNullable();
    t.string('tipo').notNullable(); // 'Loja' | 'Marca'
    t.string('analista_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('RESTRICT');
    t.string('agenda_freq').notNullable(); // 'Semanal' | 'Quinzenal' | 'Mensal'
    t.string('agenda_dia_semana'); // 'Segunda'..'Domingo' (null on Mensal)
    t.integer('agenda_dia_mes'); // 1..28 (null on weekly/biweekly)
    t.timestamp('criado_em').defaultTo(knex.fn.now());
    t.index('analista_id');
  });

  await knex.schema.createTable('accounts', (t) => {
    t.string('id').primary();
    t.string('client_id')
      .notNullable()
      .references('id')
      .inTable('clients')
      .onDelete('CASCADE');
    t.string('marketplace').notNullable(); // one of the five supported
    t.string('apelido').notNullable().defaultTo(''); // seller nickname/ID
    t.string('meta_investimento').notNullable().defaultTo('20,00');
    t.string('meta_roas').notNullable().defaultTo('4,00');
    t.string('meta_acos').notNullable().defaultTo('20,00');
    t.string('meta_tacos').notNullable().defaultTo('15,00');
    t.timestamp('criado_em').defaultTo(knex.fn.now());
    t.unique(['client_id', 'marketplace']); // one account per marketplace/client
    t.index('client_id');
  });

  await knex.schema.createTable('reports', (t) => {
    t.string('id').primary();
    t.string('account_id')
      .notNullable()
      .references('id')
      .inTable('accounts')
      .onDelete('CASCADE');
    t.string('periodo_ini'); // ISO date 'YYYY-MM-DD'
    t.string('periodo_fim');
    t.string('criado_em').notNullable(); // ISO datetime (report sent/created)
    // Extracted numeric metrics (auto-calc applied) — for KPIs/sorting/aggregates.
    t.specificType('faturamento', DOUBLE).notNullable().defaultTo(0);
    t.specificType('vendas', DOUBLE).notNullable().defaultTo(0);
    t.specificType('receita_ads', DOUBLE);
    t.specificType('vendas_ads', DOUBLE);
    t.specificType('investimento', DOUBLE);
    t.specificType('roas', DOUBLE);
    t.specificType('acos', DOUBLE);
    t.specificType('tacos', DOUBLE);
    // Full generator payload (the exact shape exported by the gerador), as JSON.
    t.text('payload').notNullable();
    t.index('account_id');
    t.index(['account_id', 'periodo_fim']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('reports');
  await knex.schema.dropTableIfExists('accounts');
  await knex.schema.dropTableIfExists('clients');
  await knex.schema.dropTableIfExists('users');
};
