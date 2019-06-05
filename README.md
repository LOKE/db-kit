# LOKE DB Kit

A lib for use with database libraries

```js
const dbKit = require("@loke/db-kit");
```

## Knex

### `createConfig(options)`

```js
const knex = require("knex");
const dbUri = "postgres://localhost/test-db";

const dbClient = knex(dbKit.knex.createConfig({ connection: dbUri }));
```

or if you're using a knexfile.js

```js
module.exports = knex.createConfig({
  connection: process.env.DATABASE_URL || { database: "test-link" }
});
```

The options are as follows

#### `connection`

Gets passed directly to knex

#### `client`

The sql client to use, defaults to `"pg"`.

#### `migrationsDirectory`

Where to place the db migrations, defaults to `"./lib/postgres/migrations"`.

### `async setup(dbClient, logger, options)`

```js
const knex = require("knex");

const dbClient = knex(/* ... */);

dbKit.knex.setup(dbClient, console);
```

Options are:

#### `slowQueryThreshold`

Threshold for logging slow queries in ms, defaults to `200`

#### `migrateUp`

weather or not `setup` should migrate the db to the latest schema. Defaults to `true`.

### `registerMetrics(registry)`

Regester metrics with `prom-client`

```js
const { register } = require("prom-client");

dbKit.knex.registerMetrics(register);
```

### `formatConnection(connection)`

Formats a connection object/string that is valid in `knex()`, redacts the password.

```js
console.log("Using database", dbKit.knex.formatConnection(uri));
```
