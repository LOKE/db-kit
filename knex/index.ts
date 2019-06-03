import camelcaseKeys from "camelcase-keys";
import decamelize from "decamelize";
import { EventEmitter } from "events";
import { Migrator, Sql } from "knex";
import path from "path";
import { Gauge, Histogram, Registry } from "prom-client";
import { format as formatUrl } from "url";
import redactor from "url-auth-redactor";

interface KnexClient extends EventEmitter {
  // tslint:disable-next-line: no-any
  client: { pool: any };
  migrate: Migrator;
}

type Connection =
  | string
  | {
      database?: string;
      user?: string;
      password?: string;
      host?: string;
      port?: number;
    };

interface ConfigOptions {
  connection: Connection;
  migrationsDirectory?: string;
  client?: string;
}

interface SetupOptions {
  /**
   * Slow query time in milliseconds,
   * when a query exceeds this time it will be logged as slow
   * @default 200
   */
  slowQueryThreshold?: number;
  /**
   * migrateUp, if true migrates the database up to the latest state before returning
   * @default true
   */
  migrateUp?: boolean;
}

interface Logger {
  info(...msg: string[]): void;
  warn(...msg: string[]): void;
  error(...msg: string[]): void;
}

type StringTransform = (str: string) => string;

const poolUsedGauge = new Gauge({
  name: "knex_pool_used",
  help: "Number of non-free resources.",
  registers: []
});
const poolFreeGauge = new Gauge({
  name: "knex_pool_free",
  help: "Number of free resources.",
  registers: []
});
const poolPendingAcquiresGauge = new Gauge({
  name: "knex_pool_pending_acquires",
  help: "How many acquires are waiting for a resource to be released.",
  registers: []
});
const poolPendingCreatesGauge = new Gauge({
  name: "knex_pool_pending_creates",
  help: "How many asynchronous create calls are running.",
  registers: []
});
const queryDuration = new Histogram({
  name: "knex_query_duration_seconds",
  help: "Knex sql query durations in seconds",
  labelNames: ["method"],
  registers: []
});

export function createConfig(opts: ConfigOptions) {
  const {
    connection,
    client = "pg",
    migrationsDirectory = "./lib/postgres/migrations"
  } = opts;

  if (!connection) {
    throw new Error("connection is required");
  }

  return {
    client,
    connection,
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      directory: migrationsDirectory,
      stub: path.join(__dirname, "./_migration-template.js")
    },
    postProcessResponse: (result: unknown /*, queryContext*/) => {
      if (typeof result !== "object" || result === null) {
        return result;
      }
      return camelcaseKeys(result);
    },
    wrapIdentifier: (
      value: string,
      origImpl: StringTransform /*, queryContext*/
    ) => origImpl(decamelize(value))
  };
}

const queryStartTimes = new WeakMap();

/**
 * Setup the database with, migrate up, setup metrics, setup logging
 * Metrics also require to be registered with `registerMetrics`
 * Currently only safe to call once, don't use in tests.
 * @param dbClient created with knex
 * @param logger defaults to `console`, as such supports **loke-logger** v3
 * @param opts use the defaults unless you have a good reason not to
 */
export async function setup(
  dbClient: KnexClient,
  logger: Logger = console,
  opts: SetupOptions = {}
) {
  const { slowQueryThreshold = 200, migrateUp = true } = opts;

  // Request time logging
  dbClient
    .on("query", (query: Sql) => {
      if (query.bindings) {
        queryStartTimes.set(query.bindings, process.hrtime());
      }
    })
    .on("query-response", (result: unknown, query: Sql) => {
      const responseTime = process.hrtime(queryStartTimes.get(query.bindings));

      const ms = toMilliseconds(responseTime);
      if (ms >= slowQueryThreshold) {
        logger.warn(`SLOW KNEX QUERY [${formatMilliseconds(ms)}] ${query.sql}`);
      }

      queryDuration.observe({ method: query.method }, toSeconds(responseTime));
    });

  // Connection pool metrics
  setInterval(() => {
    const { pool } = dbClient.client;
    if (pool && pool.numUsed) {
      // tarn
      poolUsedGauge.set(pool.numUsed());
      poolFreeGauge.set(pool.numFree());
      poolPendingAcquiresGauge.set(pool.numPendingAcquires());
      poolPendingCreatesGauge.set(pool.numPendingCreates());
    }

    if (pool && pool.size) {
      // generic-pool 3.x
      poolUsedGauge.set(pool.borrowed);
      poolFreeGauge.set(pool.available);
      poolPendingAcquiresGauge.set(pool.pending);
    }

    if (pool && pool.getPoolSize) {
      // generic-pool 2.x
      poolUsedGauge.set(pool.getPoolSize() - pool.availableObjectsCount());
      poolFreeGauge.set(pool.availableObjectsCount());
      poolPendingAcquiresGauge.set(pool.waitingClientsCount());
    }
  }, 5000).unref(); // TODO: Add some way to clean this up;

  // Migrate up loop
  if (migrateUp) {
    for (;;) {
      try {
        const [batchNo, log] = await dbClient.migrate.latest();
        if (log.length) {
          logger.info(
            `Migration batch ${batchNo} run: ${log.length} migrations`
          );
          logger.info(log.join("\n"));
        }
        break;
      } catch (err) {
        switch (err.code) {
          case "ENOTFOUND":
          case "ECONNREFUSED":
            logger.error("Could not connect to db:", err.code);
            break;
          default:
            throw err;
        }

        await delay(3000);

        logger.info("Retrying db setup...");
      }
    }
  }
}

export function registerMetrics(registry: Registry) {
  registry.registerMetric(poolUsedGauge);
  registry.registerMetric(poolFreeGauge);
  registry.registerMetric(poolPendingAcquiresGauge);
  registry.registerMetric(poolPendingCreatesGauge);

  registry.registerMetric(queryDuration);
}

const delay = (timeout: number) =>
  new Promise(resolve => setTimeout(resolve, timeout));

export function formatConnection(connection: Connection) {
  if (typeof connection === "string") {
    return redactor(connection);
  } else {
    let auth;

    if (connection.user || connection.password) {
      const u = connection.user || "";
      const p = connection.password ? "****" : "";
      auth = `${u}:${p}`;
    }

    return formatUrl({
      slashes: true,
      auth,
      host: connection.host || "127.0.0.1",
      port: connection.port,
      pathname: connection.database
    });
  }
}

function toMilliseconds(duration: [number, number]): number {
  const [s, n] = duration;
  return s * 1e3 + n / 1e6;
}
function toSeconds(duration: [number, number]): number {
  const [s, n] = duration;
  return s + n / 1e9;
}

function formatMilliseconds(duration: number): string {
  return duration.toFixed(2) + "ms";
}
