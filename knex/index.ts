import camelcaseKeys from "camelcase-keys";
import decamelize from "decamelize";
import Knex from "knex";
import path from "path";
import { format as formatUrl } from "url";
import redactor from "url-auth-redactor";

type Connection =
  | string
  | {
      database?: string;
      user?: string;
      password?: string;
      host?: string;
      port?: number;
    };

interface Options {
  connection: Connection;
  migrationsDirectory?: string;
  client?: string;
}

interface Logger {
  info(...msg: string[]): void;
  error(...msg: string[]): void;
}

type StringTransform = (str: string) => string;

export function createConfig(opts: Options) {
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
    postProcessResponse: (result: any /*, queryContext*/) => {
      if (typeof result !== "object") {
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

export async function setup(dbClient: Knex, logger: Logger = console) {
  for (;;) {
    try {
      const [batchNo, log] = await dbClient.migrate.latest();
      if (log.length) {
        logger.info(`Migration batch ${batchNo} run: ${log.length} migrations`);
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
