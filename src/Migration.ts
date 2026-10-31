import { ModelSet, type Model } from "model-algebra-common";
import { diff, type ModelSetDiff } from "model-algebra-typescript";
import { DdlSetBridge } from "./DdlSetBridge.js";
import { loadDdlParser } from "./DdlParser.js";
import { DEFAULT_BACKUP_PREFIX, diffToDdl, type Backup, type DiffDdlOptions } from "./DiffDdl.js";

export interface MigrationOptions extends DiffDdlOptions {}

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
export class Migration {
    private readonly bridge: DdlSetBridge;

    constructor(private readonly options: MigrationOptions = {}) {
        // Backups of earlier careful migrations are not part of the models
        this.bridge = new DdlSetBridge({
            comments: options.comments,
            defaultSchema: options.defaultSchema,
            skipPrefix: options.backupPrefix ?? DEFAULT_BACKUP_PREFIX,
        });
    }

    /** Works out what to change, without touching the database. */
    async plan(currentDdl: string, models: ModelSet | Model[]): Promise<MigrationPlan> {
        await loadDdlParser();
        const actual = this.bridge.parse(currentDdl);
        const target = models instanceof ModelSet ? models : new ModelSet(models);
        const desired = this.bridge.toModel(this.bridge.toTarget(target));
        const difference = diff(actual.models, desired);
        const { statements, backups } = diffToDdl(difference, actual, desired, this.options);
        return { actual: actual.models, desired, diff: difference, statements, backups, warnings: actual.warnings };
    }

    /** Runs the statements of the plan in one transaction; if one fails, nothing is changed. */
    async apply(plan: MigrationPlan, db: SqlExecutor): Promise<void> {
        if (plan.statements.length === 0) return;
        await db.query('BEGIN');
        let current = 0;
        try {
            for (; current < plan.statements.length; current++)
                await db.query(plan.statements[current]);
            await db.query('COMMIT');
        } catch (error) {
            await db.query('ROLLBACK');
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Migration failed at statement ${current + 1}, nothing was changed: ${plan.statements[current] ?? 'COMMIT'}\n${message}`, { cause: error });
        }
    }

    /** Plans and applies in one go; returns the plan that was applied. */
    async migrate(currentDdl: string, models: ModelSet | Model[], db: SqlExecutor): Promise<MigrationPlan> {
        const plan = await this.plan(currentDdl, models);
        await this.apply(plan, db);
        return plan;
    }
}
