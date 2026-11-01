import { ident } from "./sql.js";
/*
 * The SQL names DDL from models uses, for code that queries the tables: a model User with a field firstName is the
 * table "user" with the column first_name, quoted where PostgreSQL needs it.
 */
/** The quoted table name of a model, schema-qualified when the model has a schema. */
export function tableName(model) {
    const { name, schema } = model.metadata;
    return schema !== undefined ? `${ident(schema)}.${ident(name)}` : ident(name);
}
/** The quoted column name of a field. */
export function columnName(field) {
    return ident(typeof field === 'string' ? field : field.name);
}
//# sourceMappingURL=names.js.map