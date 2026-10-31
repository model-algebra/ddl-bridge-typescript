import type { ModelBridge, Model, TableConstraint, Index } from "model-algebra-common";
import { type FieldData, type ModelData } from "model-algebra-typescript";
export interface DdlBridgeOptions {
    /** Emit COMMENT ON statements from model and field descriptions (default: true). */
    comments?: boolean;
}
/** Resolves a referenced model name to a (possibly schema-qualified) table name. */
export type TableResolver = (modelName: string) => string;
/** Foreign key of the field; `foreign_key` is accepted as a legacy alias of `foreignKey`. */
export declare function foreignKeyOf(field: Record<string, any>): Record<string, any> | undefined;
export declare class DdlBridge implements ModelBridge<Model, string> {
    private readonly comments;
    constructor(options?: DdlBridgeOptions);
    toTarget(model: Model): string;
    /**
     * Reads the model of the one table the DDL creates. The DDL parser must be loaded first, see loadDdlParser().
     * Names are converted back to model names: user_profile becomes UserProfile, first_name becomes firstName.
     */
    toModel(ddl: string): Model;
    /**
     * Converts a set of related models. Scripts are ordered so that referenced tables are created first;
     * foreign keys that cannot be created inline because of reference cycles are appended as ALTER TABLE statements.
     */
    toDdlArray(models: Model[]): string[];
    toDdlFromProcessorResult(fields: Array<{
        name: string;
        value: any;
    }>, tableName: string): string;
    convertField(field: Record<string, any>, resolve?: TableResolver, deferForeignKey?: boolean, schema?: string): string;
    /** Column name, type and constraints, as in CREATE TABLE or ALTER TABLE ... ADD COLUMN. */
    columnDefinition(field: Record<string, any>, resolve: TableResolver, withoutForeignKey?: boolean, schema?: string): string;
    /**
     * @param createdTypes enum types already created by previous scripts: qualified name to its values,
     *                     so a type shared by several models is created once
     */
    createTableStatements(model: ModelData, resolve: TableResolver, deferredForeignKeys: Set<string>, createdTypes: Map<string, string>): string[];
    /** CREATE TYPE statements for the native enum types of the model that are not in createdTypes yet. */
    createEnumTypes(model: ModelData, createdTypes: Map<string, string>): string[];
    /** ALTER TABLE statement adding the foreign key of the field. */
    addForeignKey(model: ModelData, field: FieldData, resolve: TableResolver): string;
    tableName(modelName: string, schema?: string): string;
    sqlType(field: Record<string, any>, schema?: string): string;
    identityClause(field: Record<string, any>): string | undefined;
    /** Default value expression of the field, if it has one. */
    defaultExpression(field: Record<string, any>, sqlType: string): string | undefined;
    /** CHECK clauses enforcing min, max, enum and regex of the field, in the order CREATE TABLE has them. */
    checkClauses(field: Record<string, any>, sqlType: string): string[];
    referencesClause(foreignKey: Record<string, any>, resolve: TableResolver): string;
    tableConstraint(constraint: TableConstraint, fieldNames: Set<string>, modelName: string): string;
    createIndex(index: Index, table: string, fieldNames: Set<string>, modelName: string): string;
    private enumTypeValues;
    /** Topological order by foreign keys, keeping the input order where possible; cycles are broken arbitrarily. */
    private sortByDependencies;
    private columnList;
    private column;
    private ruleExpression;
    private commentStatements;
    private canonicalSqlType;
    private inferSqlType;
    private getConstraintParts;
    /**
     * Values allowed by the `enum` constraint or the ENUM type (of the field, or of the items of an ARRAY field).
     * Null when nothing restricts the values, or when a native enum type enforces them.
     */
    private allowedValues;
}
//# sourceMappingURL=DdlBridge.d.ts.map