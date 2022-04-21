"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatConnection = exports.registerMetrics = exports.setup = exports.createConfig = void 0;
const camelcase_keys_1 = __importDefault(require("camelcase-keys"));
const decamelize_1 = __importDefault(require("decamelize"));
const path_1 = __importDefault(require("path"));
const prom_client_1 = require("prom-client");
const url_1 = require("url");
const url_auth_redactor_1 = __importDefault(require("url-auth-redactor"));
const poolUsedGauge = new prom_client_1.Gauge({
    name: "knex_pool_used",
    help: "Number of non-free resources.",
    registers: []
});
const poolFreeGauge = new prom_client_1.Gauge({
    name: "knex_pool_free",
    help: "Number of free resources.",
    registers: []
});
const poolPendingAcquiresGauge = new prom_client_1.Gauge({
    name: "knex_pool_pending_acquires",
    help: "How many acquires are waiting for a resource to be released.",
    registers: []
});
const poolPendingCreatesGauge = new prom_client_1.Gauge({
    name: "knex_pool_pending_creates",
    help: "How many asynchronous create calls are running.",
    registers: []
});
const queryDuration = new prom_client_1.Histogram({
    name: "knex_query_duration_seconds",
    help: "Knex sql query durations in seconds",
    labelNames: ["method"],
    registers: []
});
function createConfig(opts) {
    const { connection, client = "pg", migrationsDirectory = "./lib/postgres/migrations" } = opts;
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
            stub: path_1.default.join(__dirname, "./_migration-template.js")
        },
        postProcessResponse: (result /*, queryContext*/) => {
            if (typeof result !== "object" || result === null || Object.keys(result).length === 0) {
                return result;
            }
            return (0, camelcase_keys_1.default)(result);
        },
        wrapIdentifier: (value, origImpl /*, queryContext*/) => origImpl((0, decamelize_1.default)(value))
    };
}
exports.createConfig = createConfig;
const queryStartTimes = new WeakMap();
/**
 * Setup the database with, migrate up, setup metrics, setup logging
 * Metrics also require to be registered with `registerMetrics`
 * Currently only safe to call once, don't use in tests.
 * @param dbClient created with knex
 * @param logger defaults to `console`, as such supports **loke-logger** v3
 * @param opts use the defaults unless you have a good reason not to
 */
async function setup(dbClient, logger = console, opts = {}) {
    const { slowQueryThreshold = 200, migrateUp = true } = opts;
    // Request time logging
    dbClient
        .on("query", (query) => {
        if (query.bindings) {
            queryStartTimes.set(query.bindings, process.hrtime());
        }
    })
        .on("query-response", (result, query) => {
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
                    logger.info(`Migration batch ${batchNo} run: ${log.length} migrations`);
                    logger.info(log.join("\n"));
                }
                break;
            }
            catch (err) {
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
exports.setup = setup;
function registerMetrics(registry) {
    registry.registerMetric(poolUsedGauge);
    registry.registerMetric(poolFreeGauge);
    registry.registerMetric(poolPendingAcquiresGauge);
    registry.registerMetric(poolPendingCreatesGauge);
    registry.registerMetric(queryDuration);
}
exports.registerMetrics = registerMetrics;
const delay = (timeout) => new Promise(resolve => setTimeout(resolve, timeout));
function formatConnection(connection) {
    if (typeof connection === "string") {
        return (0, url_auth_redactor_1.default)(connection);
    }
    else {
        let auth;
        if (connection.user || connection.password) {
            const u = connection.user || "";
            const p = connection.password ? "****" : "";
            auth = `${u}:${p}`;
        }
        return (0, url_1.format)({
            slashes: true,
            auth,
            host: connection.host || "127.0.0.1",
            port: connection.port,
            pathname: connection.database
        });
    }
}
exports.formatConnection = formatConnection;
function toMilliseconds(duration) {
    const [s, n] = duration;
    return s * 1e3 + n / 1e6;
}
function toSeconds(duration) {
    const [s, n] = duration;
    return s + n / 1e9;
}
function formatMilliseconds(duration) {
    return duration.toFixed(2) + "ms";
}
//# sourceMappingURL=index.js.map