import { ModelSet } from "model-algebra-common";
export interface DdlParseOptions {
    /** Schema of unqualified names; tables in it get no schema in their model (default: public). */
    defaultSchema?: string;
    /**
     * Tables and columns whose names start with this are left out, with the constraints, indexes and comments that
     * use them: the backups careful-mode migrations make.
     */
    skipPrefix?: string;
}
/** Names of the constraints behind field constraints, needed to drop or replace them. */
export interface ColumnCatalog {
    checks: string[];
    unique?: string;
    foreignKey?: string;
}
export interface TableCatalog {
    /** Table name as SQL, schema-qualified when not in the default schema. */
    table: string;
    /** Name of the constraint behind a field primaryKey. */
    primaryKey?: string;
    /** By field name. */
    columns: Record<string, ColumnCatalog>;
}
export interface SchemaCatalog {
    /** By model name. */
    tables: Record<string, TableCatalog>;
    /** Native enum types by name (schema-qualified when not in the default schema) with their values. */
    enumTypes: Record<string, string[]>;
}
export interface ParsedSchema {
    models: ModelSet;
    catalog: SchemaCatalog;
    /** Statements that were skipped because they do not define tables, e.g. CreateFunctionStmt. */
    warnings: string[];
}
/** Loads the PostgreSQL parser (WebAssembly). Must be awaited once before DDL is read synchronously. */
export declare function loadDdlParser(): Promise<void>;
/**
 * Reads tables, their constraints, indexes, comments and the enum types they use. The parser must be loaded first,
 * see loadDdlParser().
 */
export declare function parseDdl(ddl: string, options?: DdlParseOptions): ParsedSchema;
//# sourceMappingURL=DdlParser.d.ts.map