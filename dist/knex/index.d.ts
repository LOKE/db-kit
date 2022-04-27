/// <reference types="node" />
import { EventEmitter } from "events";
import { Knex } from "knex";
import { Registry } from "prom-client";
export interface KnexClient extends EventEmitter {
    client: {
        pool: any;
    };
    migrate: Knex.Migrator;
}
export declare type Connection = string | {
    database?: string;
    user?: string;
    password?: string;
    host?: string;
    port?: number;
};
export interface ConfigOptions {
    connection: Connection;
    migrationsDirectory?: string;
    client?: string;
}
export interface SetupOptions {
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
export interface KnexConfig {
    connection: Connection;
    client: string;
    pool: {
        min: number;
        max: number;
    };
    migrations: {
        directory: string;
        stub: string;
    };
    postProcessResponse?: Knex.Config["postProcessResponse"];
    wrapIdentifier?: Knex.Config["wrapIdentifier"];
}
interface Logger {
    info(...msg: string[]): void;
    warn(...msg: string[]): void;
    error(...msg: string[]): void;
}
export declare function createConfig(opts: ConfigOptions): KnexConfig;
/**
 * Setup the database with, migrate up, setup metrics, setup logging
 * Metrics also require to be registered with `registerMetrics`
 * Currently only safe to call once, don't use in tests.
 * @param dbClient created with knex
 * @param logger defaults to `console`, as such supports **loke-logger** v3
 * @param opts use the defaults unless you have a good reason not to
 */
export declare function setup(dbClient: KnexClient, logger?: Logger, opts?: SetupOptions): Promise<void>;
export declare function registerMetrics(registry: Registry): void;
export declare function formatConnection(connection: Connection): string;
export {};
