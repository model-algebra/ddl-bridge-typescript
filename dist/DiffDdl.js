import { toModelData } from "model-algebra-typescript";
import { DdlBridge, foreignKeyOf } from "./DdlBridge.js";
import { defaultConstraintName, ident, quoteIdent, quoteLiteral, toSnakeCase, truncateIdentifier } from "./sql.js";
export const DEFAULT_BACKUP_PREFIX = '_deleted_';
const CHECK_CONSTRAINTS = ['constraints.min', 'constraints.max', 'constraints.enum', 'constraints.regex'];
const TYPE_CHANGES = ['type', 'parameters', 'targets'];
function timestamp(date) {
    return date.toISOString().replace(/\D/g, '').slice(0, 14);
}
class DiffDdlWriter {
    catalog;
    bridge;
    careful;
    backupPrefix;
    comments;
    defaultSchema;
    before;
    after;
    // Statements in the order they must run
    dropDependents = [];
    removals = [];
    moves = [];
    types = [];
    creations = [];
    alterations = [];
    additions = [];
    foreignKeys = [];
    backups = [];
    constructor(catalog, actual, desired, options) {
        this.catalog = catalog;
        this.careful = options.careful ?? false;
        this.backupPrefix = `${options.backupPrefix ?? DEFAULT_BACKUP_PREFIX}${timestamp(options.now ?? new Date())}_`;
        this.comments = options.comments ?? true;
        this.defaultSchema = options.defaultSchema ?? 'public';
        this.bridge = new DdlBridge({ comments: this.comments });
        this.before = new Map(actual.models.map(model => [model.metadata.name, toModelData(model)]));
        this.after = new Map(desired.models.map(model => [model.metadata.name, toModelData(model)]));
    }
    write(diff) {
        const createdTypes = this.enumTypes();
        for (const model of diff.changed)
            this.changeModel(model);
        this.removeModels(diff.removed);
        for (const model of diff.added)
            this.addModel(this.after.get(model.metadata.name), createdTypes);
        return {
            statements: [
                ...this.dropDependents, ...this.removals, ...this.moves, ...this.types, ...this.creations,
                ...this.alterations, ...this.additions, ...this.foreignKeys,
            ],
            backups: this.backups,
        };
    }
    oldTable(model) {
        return this.bridge.tableName(model, this.before.get(model).metadata.schema);
    }
    newTable(model) {
        return this.bridge.tableName(model, this.after.get(model).metadata.schema);
    }
    resolve = ref => {
        const model = this.after.get(ref);
        if (model === undefined)
            throw new Error(`Foreign key references model ${ref}, which the new models do not have`);
        return this.bridge.tableName(ref, model.metadata.schema);
    };
    backupName(name) {
        return truncateIdentifier(`${this.backupPrefix}${name}`);
    }
    /** Name of a field constraint in the database: from the catalog, or the one PostgreSQL would have given it. */
    columnConstraint(model, field, kind) {
        const known = this.catalog.tables[model]?.columns[field]?.[kind];
        return known ?? defaultConstraintName(toSnakeCase(model), [toSnakeCase(field)], kind === 'unique' ? 'key' : 'fkey');
    }
    primaryKeyName(model) {
        return this.catalog.tables[model]?.primaryKey ?? defaultConstraintName(toSnakeCase(model), [], 'pkey');
    }
    dropConstraint(table, name) {
        return `ALTER TABLE ${table} DROP CONSTRAINT ${quoteIdent(name)};`;
    }
    /**
     * Native enum types the new models need: new ones are created, new values are added to existing ones.
     * Values cannot be removed from an enum type, nor reordered.
     */
    enumTypes() {
        const existing = new Map(Object.entries(this.catalog.enumTypes).map(([name, values]) => {
            const [schema, type] = name.includes('.') ? name.split('.') : [undefined, name];
            return [this.bridge.tableName(type, schema), values];
        }));
        const created = new Map([...existing].map(([name, values]) => [name, values.map(quoteLiteral).join(', ')]));
        for (const model of this.after.values()) {
            for (const field of model.fields) {
                const enumType = field.targets?.postgresql?.enumType;
                if (enumType === undefined)
                    continue;
                const name = this.bridge.tableName(enumType, model.metadata.schema);
                const values = field.parameters?.values;
                const old = existing.get(name);
                if (old === undefined) {
                    existing.set(name, values);
                    created.set(name, values.map(quoteLiteral).join(', '));
                    if (model.metadata.schema !== undefined)
                        this.types.push(`CREATE SCHEMA IF NOT EXISTS ${ident(model.metadata.schema)};`);
                    this.types.push(`CREATE TYPE ${name} AS ENUM (${values.map(quoteLiteral).join(', ')});`);
                    continue;
                }
                if (old.join('\u0000') === values.join('\u0000'))
                    continue;
                const kept = values.filter(value => old.includes(value));
                if (kept.length !== old.length || kept.some((value, i) => value !== old[i]))
                    throw new Error(`Enum type ${name} cannot change from (${old.join(', ')}) to (${values.join(', ')}): values can only be added`);
                values.forEach((value, i) => {
                    if (old.includes(value))
                        return;
                    const position = i === 0 ? ` BEFORE ${quoteLiteral(values[1])}` : ` AFTER ${quoteLiteral(values[i - 1])}`;
                    this.types.push(`ALTER TYPE ${name} ADD VALUE ${quoteLiteral(value)}${position};`);
                });
                existing.set(name, values);
                created.set(name, values.map(quoteLiteral).join(', '));
            }
        }
        return created;
    }
    addModel(model, createdTypes) {
        const withForeignKeys = model.fields.filter(field => foreignKeyOf(field) !== undefined);
        this.creations.push(...this.bridge.createTableStatements(model, this.resolve, new Set(withForeignKeys.map(f => f.name)), createdTypes));
        for (const field of withForeignKeys)
            this.foreignKeys.push(this.bridge.addForeignKey(model, field, this.resolve));
    }
    removeModels(models) {
        if (models.length === 0)
            return;
        if (!this.careful) {
            this.removals.push(`DROP TABLE ${models.map(model => this.oldTable(model.metadata.name)).join(', ')};`);
            return;
        }
        for (const model of models) {
            const name = model.metadata.name;
            const schema = model.metadata.schema;
            const table = toSnakeCase(name);
            const backup = this.backupName(table);
            this.removals.push(`ALTER TABLE ${this.oldTable(name)} RENAME TO ${quoteIdent(backup)};`);
            const backupTable = schema !== undefined ? `${ident(schema)}.${quoteIdent(backup)}` : quoteIdent(backup);
            this.backups.push({ kind: 'table', model: name, table: backupTable, name: table, backup });
            // Index names are unique within the schema: free the names a new table of the same name may need
            const tableCatalog = this.catalog.tables[name];
            const indexNames = [
                ...(model.indexes ?? []).map(index => index.name),
                ...(model.constraints ?? []).filter(c => c.type !== 'check').map(c => c.name),
                ...(tableCatalog?.primaryKey !== undefined ? [tableCatalog.primaryKey] : []),
                ...Object.values(tableCatalog?.columns ?? {}).flatMap(column => column.unique !== undefined ? [column.unique] : []),
            ];
            for (const index of indexNames)
                this.removals.push(`ALTER INDEX ${schema !== undefined ? `${ident(schema)}.` : ''}${quoteIdent(index)} RENAME TO ${quoteIdent(this.backupName(index))};`);
        }
    }
    changeModel(change) {
        const name = change.name;
        const before = this.before.get(name);
        const after = this.after.get(name);
        const oldTable = this.oldTable(name);
        const table = this.newTable(name);
        const fieldNames = new Set(after.fields.map(field => field.name));
        if (change.metadata.schema !== undefined) {
            if (after.fields.some(field => field.targets?.postgresql?.enumType !== undefined))
                throw new Error(`Model ${name} uses native enum types and cannot move to another schema`);
            const schema = after.metadata.schema ?? this.defaultSchema;
            if (after.metadata.schema !== undefined)
                this.moves.push(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)};`);
            this.moves.push(`ALTER TABLE ${oldTable} SET SCHEMA ${ident(schema)};`);
        }
        if (change.metadata.description !== undefined && this.comments) {
            const description = change.metadata.description.to;
            this.additions.push(`COMMENT ON TABLE ${table} IS ${description !== undefined ? quoteLiteral(description) : 'NULL'};`);
        }
        for (const constraint of [...change.constraints.removed, ...change.constraints.changed.map(c => c.from)])
            this.dropDependents.push(this.dropConstraint(oldTable, constraint.name));
        for (const constraint of [...change.constraints.added, ...change.constraints.changed.map(c => c.to)])
            this.additions.push(`ALTER TABLE ${table} ADD ${this.bridge.tableConstraint(constraint, fieldNames, name)};`);
        const indexSchema = before.metadata.schema !== undefined ? `${ident(before.metadata.schema)}.` : '';
        for (const index of [...change.indexes.removed, ...change.indexes.changed.map(c => c.from)])
            this.dropDependents.push(`DROP INDEX ${indexSchema}${quoteIdent(index.name)};`);
        for (const index of [...change.indexes.added, ...change.indexes.changed.map(c => c.to)])
            this.additions.push(this.bridge.createIndex(index, table, fieldNames, name));
        for (const field of change.fields.removed)
            this.removeField(name, oldTable, field);
        for (const field of change.fields.added)
            this.addField(after, table, field);
        for (const fieldChange of change.fields.changed)
            this.changeField(after, oldTable, table, fieldChange);
    }
    removeField(model, table, field) {
        const column = ident(field.name);
        const c = field.constraints ?? {};
        if (!this.careful) {
            this.removals.push(`ALTER TABLE ${table} DROP COLUMN ${column};`);
            return;
        }
        // The column stays as a backup; what would stop rows without it from being written goes
        if (c.foreignKey !== undefined)
            this.dropDependents.push(this.dropConstraint(table, this.columnConstraint(model, field.name, 'foreignKey')));
        if (c.primaryKey === true)
            this.dropDependents.push(this.dropConstraint(table, this.primaryKeyName(model)));
        if (c.identity !== undefined)
            this.removals.push(`ALTER TABLE ${table} ALTER COLUMN ${column} DROP IDENTITY;`);
        if (c.nullable === false)
            this.removals.push(`ALTER TABLE ${table} ALTER COLUMN ${column} DROP NOT NULL;`);
        const backup = this.backupName(toSnakeCase(field.name));
        this.removals.push(`ALTER TABLE ${table} RENAME COLUMN ${column} TO ${quoteIdent(backup)};`);
        this.backups.push({ kind: 'column', model, field: field.name, table, name: toSnakeCase(field.name), backup });
    }
    addField(model, table, field) {
        this.alterations.push(`ALTER TABLE ${table} ADD COLUMN ${this.bridge.columnDefinition(field, this.resolve, true, model.metadata.schema)};`);
        if (foreignKeyOf(field) !== undefined)
            this.foreignKeys.push(this.bridge.addForeignKey(model, field, this.resolve));
        if (field.description !== undefined && this.comments)
            this.additions.push(`COMMENT ON COLUMN ${table}.${ident(field.name)} IS ${quoteLiteral(field.description)};`);
    }
    changeField(model, oldTable, table, { from, to, changes }) {
        const modelName = model.metadata.name;
        const column = ident(to.name);
        const alter = (action) => this.alterations.push(`ALTER TABLE ${table} ALTER COLUMN ${column} ${action};`);
        const has = (...names) => names.some(name => changes.includes(name));
        const before = from.constraints ?? {};
        const after = to.constraints ?? {};
        const sqlType = this.bridge.sqlType(to, model.metadata.schema);
        // New values of a native enum type change the type, not the column
        const oldSchema = this.before.get(modelName).metadata.schema;
        const typeChanged = has(...TYPE_CHANGES) && this.bridge.sqlType(from, oldSchema) !== sqlType;
        // Constraints that go or are replaced, dropped before the column changes
        if (before.foreignKey !== undefined && (has('constraints.foreignKey') || typeChanged))
            this.dropDependents.push(this.dropConstraint(oldTable, this.columnConstraint(modelName, from.name, 'foreignKey')));
        if (before.primaryKey === true && has('constraints.primaryKey'))
            this.dropDependents.push(this.dropConstraint(oldTable, this.primaryKeyName(modelName)));
        if (before.unique === true && has('constraints.unique'))
            this.dropDependents.push(this.dropConstraint(oldTable, this.columnConstraint(modelName, from.name, 'unique')));
        const checksChanged = has(...CHECK_CONSTRAINTS) || (typeChanged && CHECK_CONSTRAINTS.some(c => before[c.slice(12)] !== undefined));
        if (checksChanged)
            for (const check of this.catalog.tables[modelName]?.columns[from.name]?.checks ?? [])
                this.dropDependents.push(this.dropConstraint(oldTable, check));
        const defaultChanged = has('constraints.default');
        let defaultDropped = false;
        if (typeChanged) {
            // The old default may not convert to the new type
            if (before.default !== undefined) {
                alter('DROP DEFAULT');
                defaultDropped = true;
            }
            const isEnumType = to.targets?.postgresql?.enumType !== undefined;
            alter(`TYPE ${sqlType} USING ${column}::${isEnumType ? 'text::' : ''}${sqlType}`);
        }
        if (before.identity !== undefined && after.identity === undefined)
            alter('DROP IDENTITY');
        if (defaultChanged || (defaultDropped && after.default !== undefined)) {
            const expression = this.bridge.defaultExpression(to, sqlType);
            if (expression !== undefined)
                alter(`SET DEFAULT ${expression}`);
            else if (!defaultDropped)
                alter('DROP DEFAULT');
        }
        if (has('constraints.nullable'))
            alter(after.nullable === false ? 'SET NOT NULL' : 'DROP NOT NULL');
        if (after.identity !== undefined && before.identity === undefined)
            alter(`ADD ${this.bridge.identityClause(to)}`);
        else if (after.identity !== undefined && has('constraints.identity'))
            alter(`SET GENERATED ${after.identity === 'always' ? 'ALWAYS' : 'BY DEFAULT'}`);
        if (after.primaryKey === true && has('constraints.primaryKey'))
            this.alterations.push(`ALTER TABLE ${table} ADD PRIMARY KEY (${column});`);
        if (after.unique === true && has('constraints.unique'))
            this.alterations.push(`ALTER TABLE ${table} ADD UNIQUE (${column});`);
        if (checksChanged)
            for (const check of this.bridge.checkClauses(to, sqlType))
                this.alterations.push(`ALTER TABLE ${table} ADD ${check};`);
        if (after.foreignKey !== undefined && (has('constraints.foreignKey') || typeChanged))
            this.foreignKeys.push(this.bridge.addForeignKey(model, to, this.resolve));
        if (has('description') && this.comments)
            this.additions.push(`COMMENT ON COLUMN ${table}.${column} IS ${to.description !== undefined ? quoteLiteral(to.description) : 'NULL'};`);
    }
}
/**
 * DDL changing a database from the actual models (read from its DDL, with their catalog) to the desired ones.
 * Both model sets must be canonical: read by DdlSetBridge, the desired ones after converting them to DDL.
 */
export function diffToDdl(diff, actual, desired, options = {}) {
    return new DiffDdlWriter(actual.catalog, actual.models, desired, options).write(diff);
}
//# sourceMappingURL=DiffDdl.js.map