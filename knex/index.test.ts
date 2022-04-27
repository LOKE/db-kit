import test from 'ava';
import { setup } from './index';
import _knex from "knex";

async function setupKnex() {
  const knex = _knex({
    client: "pg",
    connection: process.env.DATABASE_URL,
  });

  return knex;
}

test('test pg connection', async t => {
  const knexClient = await setupKnex();
  await setup(knexClient);

	t.pass();
});

// test('test migrations', async t => {
//   const konnection = ;
//   await setup(konnection);

// 	t.pass();
// });