import camelcaseKeys from "camelcase-keys";
import decamelize from "decamelize";
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
  databaseName: string;
  migrationsDirectory?: string;
  client?: string;
}

type StringTransform = (str: string) => string;

export function createConfig(opts: Options) {
  const {
    databaseName,
    client = "pg",
    migrationsDirectory = "./lib/postgres/migrations"
  } = opts;

  if (!databaseName) {
    throw new Error("databaseName is required");
  }

  return {
    client,
    connection: process.env.DATABASE_URL || { database: databaseName },
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

export function formatConnection(connection: Connection) {
  if (typeof connection === "string") {
    return redactor(connection);
  } else {
    let auth = undefined;

    if (connection.user || connection.password) {
      const u = connection.user || "";
      const p = connection.password ? "****" : "";
      auth = `${u}:${p}`;
    }

    return formatUrl({
      protocol: "postgres",
      slashes: true,
      auth,
      host: connection.host || "127.0.0.1",
      port: connection.port,
      pathname: connection.database
    });
  }
}
