/** The quoted table name of a model, schema-qualified when the model has a schema. */
export declare function tableName(model: {
    metadata: {
        name: string;
        schema?: string;
    };
}): string;
/** The quoted column name of a field. */
export declare function columnName(field: {
    name: string;
} | string): string;
//# sourceMappingURL=names.d.ts.map