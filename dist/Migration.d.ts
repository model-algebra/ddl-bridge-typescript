import { ModelSet, type Model } from "model-algebra-common";
import { type ModelSetDiff } from "model-algebra-typescript";
import { type Backup, type DiffDdlOptions } from "./DiffDdl.js";
export interface MigrationOptions extends DiffDdlOptions {
}
export interface MigrationPlan {
    /** Models the database has now, read from its DDL. */
    actual: ModelSet;
    /** Models the database should have, in the same canonical form as `actual`. */
    desired: ModelSet;
    diff: ModelSetDiff;
    /** DDL statements that change the database, in order. Empty when it already matches the models. */
    statements: string[];
    /** Tables and columns careful mode renames instead of dropping. */
    backups: Backup[];
    /** Statements of the database DDL that were skipped because they do not define tables. */
    warnings: string[];
}
/** Runs SQL on one database connection, e.g. a pg Client (not a Pool: the statements must share a transaction). */
export interface SqlExecutor {
    query(sql: string): Promise<unknown>;
}
/**
 * Brings a PostgreSQL database to a set of models:
 * 1. reads the models the database has from its DDL (pg_dump --schema-only),
 * 2. compares them with the models it should have,
 * 3. converts the differences to DDL,
 * 4. runs that DDL in one transaction.
 *
 * Both sides are compared in the same canonical form: the desired models are converted to DDL and read back, so
 * only differences the database can see count. Tables, columns, constraints and indexes are matched by name; a
 * renamed one is removed and added. In careful mode removed tables and columns are renamed instead of dropped,
 * so their data stays and the migration can be undone.
 */
export declare class Migration {
    private readonly options;
    private readonly bridge;
    constructor(options?: MigrationOptions);
    /** Works out what to change, without touching the database. */
    plan(currentDdl: string, models: ModelSet | Model[]): Promise<MigrationPlan>;
    /** Runs the statements of the plan in one transaction; if one fails, nothing is changed. */
    apply(plan: MigrationPlan, db: SqlExecutor): Promise<void>;
    /** Plans and applies in one go; returns the plan that was applied. */
    migrate(currentDdl: string, models: ModelSet | Model[], db: SqlExecutor): Promise<MigrationPlan>;
}
//# sourceMappingURL=Migration.d.ts.map