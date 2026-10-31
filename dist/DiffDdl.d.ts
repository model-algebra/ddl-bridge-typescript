import type { ModelSet } from "model-algebra-common";
import { type ModelSetDiff } from "model-algebra-typescript";
import type { SchemaCatalog } from "./DdlParser.js";
export interface DiffDdlOptions {
    /**
     * Rename tables and columns that are removed instead of dropping them, so their data stays in the database
     * and the change can be undone (default: false).
     */
    careful?: boolean;
    /**
     * Start of the names of renamed tables and columns, followed by a UTC time stamp and the old name, e.g.
     * _deleted_20261031120000_email (default: _deleted_). Migrations leave out tables and columns with names
     * starting with it, so backups stay as they are.
     */
    backupPrefix?: string;
    /** Time of the time stamp in backup names (default: now). */
    now?: Date;
    /** Emit COMMENT ON statements for descriptions (default: true). */
    comments?: boolean;
    /** Schema of models without one (default: public). */
    defaultSchema?: string;
}
/** A table or column careful mode renamed instead of dropping. */
export interface Backup {
    kind: 'table' | 'column';
    model: string;
    field?: string;
    /** The table, after the rename for tables; schema-qualified SQL. */
    table: string;
    /** Name of the column or table before the rename. */
    name: string;
    /** Name after the rename. */
    backup: string;
}
export interface DiffDdl {
    statements: string[];
    backups: Backup[];
}
export declare const DEFAULT_BACKUP_PREFIX = "_deleted_";
/**
 * DDL changing a database from the actual models (read from its DDL, with their catalog) to the desired ones.
 * Both model sets must be canonical: read by DdlSetBridge, the desired ones after converting them to DDL.
 */
export declare function diffToDdl(diff: ModelSetDiff, actual: {
    models: ModelSet;
    catalog: SchemaCatalog;
}, desired: ModelSet, options?: DiffDdlOptions): DiffDdl;
//# sourceMappingURL=DiffDdl.d.ts.map