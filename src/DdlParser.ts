import { loadModule, parseSync } from "libpg-query";
import { Model, ModelSet, type Index, type Rule, type TableConstraint } from "model-algebra-common";
import type { FieldData, ModelData } from "model-algebra-typescript";
import { defaultConstraintName, fromSqlName, toSnakeCase } from "./sql.js";

/*
 * Reads PostgreSQL DDL, such as the output of pg_dump --schema-only or of DdlBridge, into models.
 *
 * The result is canonical: DDL that creates the same tables gives the same models, however it is written.
 * Constraints of one column that fields can express (primary key, unique, foreign key, and checks of min and max,
 * allowed values or a regex) become field constraints, whatever their names; the names are kept in the catalog,
 * so the constraints can be dropped. Constraints of several columns, and other checks, stay table constraints.
 */

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

type Node = any;

// Statements that hold nothing the models describe
const IGNORED_STATEMENTS = new Set([
    'VariableSetStmt', 'SelectStmt', 'CreateSchemaStmt', 'CreateSeqStmt', 'AlterSeqStmt', 'AlterOwnerStmt',
    'CreateExtensionStmt', 'GrantStmt', 'AlterDefaultPrivilegesStmt', 'TransactionStmt',
]);

const IGNORED_ALTER_COMMANDS = new Set(['AT_ChangeOwner', 'AT_ReplicaIdentity', 'AT_ClusterOn', 'AT_EnableRowSecurity']);

const RULE_OPERATORS: Record<string, Rule['op']> = { '=': '=', '<>': '!=', '!=': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' };

const FK_ACTIONS: Record<string, string | undefined> = {
    a: undefined, // NO ACTION is the default
    r: 'restrict',
    c: 'cascade',
    n: 'setNull',
    d: 'setDefault',
};

const NUMERIC_TYPES = new Set(['INT16', 'INT32', 'INT64', 'FLOAT32', 'FLOAT64', 'DECIMAL']);

/** Interval typmod meaning "all fields", as plain INTERVAL or INTERVAL(p) */
const INTERVAL_FULL_RANGE = 32767;

let loaded: Promise<void> | undefined;

/** Loads the PostgreSQL parser (WebAssembly). Must be awaited once before DDL is read synchronously. */
export function loadDdlParser(): Promise<void> {
    loaded ??= loadModule();
    return loaded;
}

function parseStatements(ddl: string): Node[] {
    // psql meta-commands, such as the \restrict lines pg_dump writes, are not SQL
    const sql = ddl.replace(/^\\.*$/gm, '');
    try {
        return parseSync(sql).stmts?.map((statement: Node) => statement.stmt) ?? [];
    } catch (error) {
        // DDL of a database without tables
        if (error instanceof Error && /Query cannot be empty/.test(error.message)) return [];
        if (error instanceof Error && /not initialized/.test(error.message))
            throw new Error('The DDL parser is not loaded; await loadDdlParser() first');
        throw new Error(`Cannot parse DDL: ${error instanceof Error ? error.message : String(error)}`);
    }
}

const kindOf = (node: Node): string => Object.keys(node)[0];
const strings = (list: Node[] | undefined): string[] => (list ?? []).map(item => item.String.sval);

/** Value of a constant, unwrapping casts and unary minus; undefined if the node is not a constant. */
function constant(node: Node): unknown {
    if (node === undefined) return undefined;
    if (node.TypeCast) return constant(node.TypeCast.arg);
    if (node.A_Const) {
        const c = node.A_Const;
        if (c.isnull) return null;
        if (c.ival !== undefined) return c.ival.ival ?? 0;
        if (c.fval !== undefined) return Number(c.fval.fval);
        if (c.sval !== undefined) return c.sval.sval ?? '';
        if (c.boolval !== undefined) return c.boolval.boolval ?? false;
        return undefined;
    }
    if (node.A_Expr?.kind === 'AEXPR_OP' && node.A_Expr.lexpr === undefined && strings(node.A_Expr.name)[0] === '-') {
        const value = constant(node.A_Expr.rexpr);
        return typeof value === 'number' ? -value : typeof value === 'string' ? `-${value}` : undefined;
    }
    return undefined;
}

function columnName(node: Node): string | undefined {
    if (node?.TypeCast) return columnName(node.TypeCast.arg);
    const fields = node?.ColumnRef?.fields;
    return fields ? strings(fields).at(-1) : undefined;
}

/** Elements of ARRAY[...], possibly cast; undefined if the node is not an array constructor. */
function arrayElements(node: Node): Node[] | undefined {
    if (node?.TypeCast) return arrayElements(node.TypeCast.arg);
    return node?.A_ArrayExpr ? (node.A_ArrayExpr.elements ?? []) : undefined;
}

/** Elements of a one-dimensional array literal such as {a,"b c",3}. */
function arrayLiteral(text: string): string[] | undefined {
    const match = /^\{(.*)\}$/s.exec(text.trim());
    if (match === null) return undefined;
    const items: string[] = [];
    const pattern = /\s*(?:"((?:[^"\\]|\\.)*)"|([^,"{}]*?))\s*(?:,|$)/gy;
    let m: RegExpExecArray | null;
    while (pattern.lastIndex < match[1].length && (m = pattern.exec(match[1])) !== null)
        items.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]);
    return items;
}

interface TableInfo {
    schema?: string;
    name: string;
    sqlName: string;
    columns: ColumnInfo[];
    /** Columns left out, see DdlParseOptions.skipPrefix. */
    skippedColumns: Set<string>;
    constraints: Node[];
    indexes: Node[];
    description?: string;
}

interface ColumnInfo {
    sqlName: string;
    typeName: Node;
    constraints: Node[];
    description?: string;
}

class Parser {
    private readonly defaultSchema: string;
    private readonly tables = new Map<string, TableInfo>();
    private readonly enumTypes = new Map<string, string[]>();
    private readonly warnings: string[] = [];
    private readonly skipPrefix?: string;
    private readonly skippedTables = new Set<string>();

    constructor(options: DdlParseOptions) {
        this.defaultSchema = options.defaultSchema ?? 'public';
        this.skipPrefix = options.skipPrefix;
    }

    private skipped(sqlName: string): boolean {
        return this.skipPrefix !== undefined && this.skipPrefix !== '' && sqlName.startsWith(this.skipPrefix);
    }

    parse(ddl: string): ParsedSchema {
        const statements = parseStatements(ddl);
        // Types first: columns may use enum types created later in the script
        for (const statement of statements)
            if (statement.CreateEnumStmt) this.enumType(statement.CreateEnumStmt);
        for (const statement of statements) this.statement(statement);

        const catalog: SchemaCatalog = { tables: {}, enumTypes: Object.fromEntries(this.enumTypes) };
        const models: Model[] = [];
        const names = new Map<string, string>();
        const tables = [...this.tables.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
        for (const table of tables) {
            const other = names.get(table.name);
            if (other !== undefined)
                throw new Error(`Tables ${other} and ${this.qualified(table)} both become model ${table.name}`);
            names.set(table.name, this.qualified(table));
            const { model, tableCatalog } = this.model(table);
            models.push(new Model(model));
            catalog.tables[table.name] = tableCatalog;
        }
        return { models: new ModelSet(models), catalog, warnings: this.warnings };
    }

    private statement(statement: Node): void {
        const kind = kindOf(statement);
        const node = statement[kind];
        switch (kind) {
            case 'CreateEnumStmt': return;
            case 'CreateStmt': return this.createTable(node);
            case 'AlterTableStmt': return this.alterTable(node);
            case 'IndexStmt': return void this.table(node.relation)?.indexes.push(node);
            case 'CommentStmt': return this.comment(node);
            default:
                if (!IGNORED_STATEMENTS.has(kind)) this.warnings.push(`Skipped ${kind}`);
        }
    }

    private schemaOf(schema: string | undefined): string | undefined {
        return schema === undefined || schema === this.defaultSchema ? undefined : schema;
    }

    private qualified(table: { schema?: string, sqlName: string }): string {
        return table.schema !== undefined ? `${table.schema}.${table.sqlName}` : table.sqlName;
    }

    /** SQL name the DDL bridge can produce again from the model name. */
    private modelName(sqlName: string, pascal: boolean, what: string): string {
        const name = fromSqlName(sqlName, pascal);
        if (toSnakeCase(name) !== sqlName)
            throw new Error(`${what} ${sqlName} cannot be represented: model names become lowercase snake_case in SQL`);
        return name;
    }

    /** Constraint and index names are SQL names in models too; DdlBridge must be able to write them back as they are. */
    private sqlName(name: string, what: string): string {
        if (toSnakeCase(name) !== name)
            throw new Error(`${what} ${name} cannot be represented: model names become lowercase snake_case in SQL`);
        return name;
    }

    /** The table, or undefined if it is left out. */
    private table(relation: Node): TableInfo | undefined {
        const name = this.qualified({ schema: this.schemaOf(relation.schemaname), sqlName: relation.relname });
        if (this.skippedTables.has(name)) return undefined;
        const table = this.tables.get(name);
        if (table === undefined)
            throw new Error(`Table ${relation.relname} is used before it is created`);
        return table;
    }

    private enumType(node: Node): void {
        const names = strings(node.typeName);
        const schema = this.schemaOf(names.length > 1 ? names[0] : undefined);
        this.enumTypes.set(this.qualified({ schema, sqlName: names.at(-1)! }), strings(node.vals));
    }

    private createTable(node: Node): void {
        if (node.inhRelations?.length || node.partspec || node.ofTypename)
            throw new Error(`Inherited, partitioned and typed tables are not supported: ${node.relation.relname}`);
        const schema = this.schemaOf(node.relation.schemaname);
        const sqlName: string = node.relation.relname;
        if (this.skipped(sqlName)) {
            this.skippedTables.add(this.qualified({ schema, sqlName }));
            return;
        }
        const table: TableInfo = {
            schema, sqlName,
            name: this.modelName(sqlName, true, 'Table'),
            columns: [], skippedColumns: new Set(), constraints: [], indexes: [],
        };
        for (const element of node.tableElts ?? []) {
            if (element.ColumnDef) {
                const column = element.ColumnDef;
                if (this.skipped(column.colname)) table.skippedColumns.add(column.colname);
                else table.columns.push({ sqlName: column.colname, typeName: column.typeName, constraints: (column.constraints ?? []).map((c: Node) => c.Constraint) });
            } else if (element.Constraint)
                table.constraints.push(element.Constraint);
            else
                throw new Error(`Unsupported element ${kindOf(element)} in table ${sqlName}`);
        }
        this.tables.set(this.qualified(table), table);
    }

    private alterTable(node: Node): void {
        if (node.objtype !== 'OBJECT_TABLE') return;
        const table = this.table(node.relation);
        if (table === undefined) return;
        for (const item of node.cmds ?? []) {
            const command = item.AlterTableCmd;
            if (IGNORED_ALTER_COMMANDS.has(command.subtype)) continue;
            switch (command.subtype) {
                case 'AT_AddConstraint':
                    table.constraints.push(command.def.Constraint);
                    break;
                case 'AT_AddIdentity':
                case 'AT_ColumnDefault':
                case 'AT_SetNotNull': {
                    if (table.skippedColumns.has(command.name)) break;
                    const column = this.column(table, command.name);
                    if (command.subtype === 'AT_SetNotNull') column.constraints.push({ contype: 'CONSTR_NOTNULL' });
                    else if (command.subtype === 'AT_AddIdentity') column.constraints.push(command.def.Constraint);
                    else if (command.def !== undefined) column.constraints.push({ contype: 'CONSTR_DEFAULT', raw_expr: command.def });
                    break;
                }
                default:
                    throw new Error(`Unsupported ALTER TABLE command ${command.subtype} on table ${table.sqlName}`);
            }
        }
    }

    private column(table: TableInfo, sqlName: string): ColumnInfo {
        const column = table.columns.find(c => c.sqlName === sqlName);
        if (column === undefined)
            throw new Error(`Unknown column ${sqlName} of table ${table.sqlName}`);
        return column;
    }

    /** Whether a table constraint or index uses a column that is left out. */
    private usesSkipped(node: Node, table: TableInfo): boolean {
        if (table.skippedColumns.size === 0) return false;
        const used = new Set<string>([
            ...strings(node.keys), ...strings(node.fk_attrs),
            ...(node.indexParams ?? []).map((param: Node) => param.IndexElem?.name).filter((name: unknown) => name !== undefined),
        ]);
        const visit = (value: Node) => {
            if (value === null || typeof value !== 'object') return;
            if (value.ColumnRef) used.add(columnName(value)!);
            for (const item of Object.values(value)) Array.isArray(item) ? item.forEach(visit) : visit(item);
        };
        visit(node.raw_expr);
        visit(node.whereClause);
        visit(node.indexParams);
        return [...used].some(column => table.skippedColumns.has(column));
    }

    private comment(node: Node): void {
        if (node.objtype !== 'OBJECT_TABLE' && node.objtype !== 'OBJECT_COLUMN') return;
        const names = strings(node.object.List.items);
        const columnName = node.objtype === 'OBJECT_COLUMN' ? names.pop() : undefined;
        const relname = names.pop();
        const table = this.table({ schemaname: names.pop(), relname });
        if (table === undefined || (columnName !== undefined && table.skippedColumns.has(columnName))) return;
        if (columnName !== undefined) this.column(table, columnName).description = node.comment;
        else table.description = node.comment;
    }

    /** Builds the model and the names of its field constraints. */
    private model(table: TableInfo): { model: ModelData, tableCatalog: TableCatalog } {
        const fieldNames = new Map(table.columns.map(c => [c.sqlName, this.modelName(c.sqlName, false, `Column of ${table.sqlName}`)]));
        const fieldName = (sqlName: string) => {
            const name = fieldNames.get(sqlName);
            if (name === undefined) throw new Error(`Unknown column ${sqlName} of table ${table.sqlName}`);
            return name;
        };
        const fields = new Map<string, FieldData>();
        const constraints = new Map<string, Record<string, unknown>>();
        const tableCatalog: TableCatalog = { table: this.qualified(table), columns: {} };
        const columnCatalog = (sqlName: string) => tableCatalog.columns[fieldName(sqlName)] ??= { checks: [] };
        const constraintsOf = (sqlName: string) => {
            const own = constraints.get(sqlName);
            if (own === undefined) throw new Error(`Unknown column ${sqlName} of table ${table.sqlName}`);
            return own;
        };
        const tableConstraints: TableConstraint[] = [];
        const usedNames = new Set<string>();
        // Names PostgreSQL gives constraints created without one; repeated ones get a number appended
        const nameOf = (constraint: Node, columns: string[], suffix: string): string => {
            if (constraint.conname) {
                this.sqlName(constraint.conname, `Constraint of ${table.sqlName}`);
                usedNames.add(constraint.conname);
                return constraint.conname;
            }
            const base = defaultConstraintName(table.sqlName, columns, suffix);
            let name = base;
            for (let i = 1; usedNames.has(name); i++) name = `${base}${i}`;
            usedNames.add(name);
            return name;
        };

        for (const column of table.columns) {
            const field: FieldData = { name: fieldName(column.sqlName), ...this.fieldType(column.typeName, table) };
            if (column.description !== undefined) field.description = column.description;
            fields.set(column.sqlName, field);
            constraints.set(column.sqlName, {});
        }

        // Column constraints first, in order, as PostgreSQL names them; then table constraints
        const all: Array<{ constraint: Node, column?: string }> = [
            ...table.columns.flatMap(column => column.constraints.map(constraint => ({ constraint, column: column.sqlName }))),
            ...table.constraints.filter(constraint => !this.usesSkipped(constraint, table)).map(constraint => ({ constraint })),
        ];
        for (const { constraint, column } of all) {
            const own = column !== undefined ? constraintsOf(column) : undefined;
            switch (constraint.contype) {
                case 'CONSTR_NULL':
                    break;
                case 'CONSTR_NOTNULL':
                    own!.nullable = false;
                    break;
                case 'CONSTR_DEFAULT':
                    own!.default = this.defaultValue(constraint.raw_expr, fields.get(column!)!, table);
                    break;
                case 'CONSTR_IDENTITY':
                    own!.identity = constraint.generated_when === 'a' ? 'always' : 'byDefault';
                    break;
                case 'CONSTR_GENERATED':
                    throw new Error(`Generated column ${column} of table ${table.sqlName} is not supported`);
                case 'CONSTR_PRIMARY':
                case 'CONSTR_UNIQUE': {
                    const primary = constraint.contype === 'CONSTR_PRIMARY';
                    const keys = column !== undefined ? [column] : strings(constraint.keys);
                    const name = nameOf(constraint, primary ? [] : keys, primary ? 'pkey' : 'key');
                    if (keys.length === 1) {
                        constraintsOf(keys[0])[primary ? 'primaryKey' : 'unique'] = true;
                        if (primary) tableCatalog.primaryKey = name;
                        else columnCatalog(keys[0]).unique = name;
                    } else
                        tableConstraints.push({ name, type: primary ? 'primaryKey' : 'unique', fields: keys.map(fieldName) });
                    break;
                }
                case 'CONSTR_FOREIGN': {
                    if (this.skippedTables.has(this.qualified({ schema: this.schemaOf(constraint.pktable.schemaname), sqlName: constraint.pktable.relname }))) {
                        this.warnings.push(`Skipped foreign key ${constraint.conname ?? ''} of table ${table.sqlName}: it references left-out table ${constraint.pktable.relname}`);
                        break;
                    }
                    const keys = column !== undefined ? [column] : strings(constraint.fk_attrs);
                    if (keys.length !== 1)
                        throw new Error(`Foreign key ${constraint.conname ?? ''} of table ${table.sqlName} has ${keys.length} columns; only single-column foreign keys are supported`);
                    constraintsOf(keys[0]).foreignKey = this.foreignKey(constraint, table);
                    columnCatalog(keys[0]).foreignKey = nameOf(constraint, keys, 'fkey');
                    break;
                }
                case 'CONSTR_CHECK': {
                    const referenced = column ?? this.checkColumn(constraint.raw_expr);
                    const name = nameOf(constraint, referenced !== undefined ? [referenced] : [], 'check');
                    const folded = referenced !== undefined ? this.fieldCheck(constraint.raw_expr, referenced) : undefined;
                    if (folded !== undefined) {
                        Object.assign(constraintsOf(referenced!), folded);
                        columnCatalog(referenced!).checks.push(name);
                    } else
                        tableConstraints.push({ name, type: 'check', rule: this.rule(constraint.raw_expr, fieldName, `constraint ${name} of ${table.sqlName}`) });
                    break;
                }
                default:
                    throw new Error(`Unsupported constraint ${constraint.contype} in table ${table.sqlName}`);
            }
        }

        // PostgreSQL makes primary key and identity columns NOT NULL whether the DDL says so or not
        const keyColumns = new Set(tableConstraints.filter(c => c.type === 'primaryKey').flatMap(c => c.fields!));
        for (const [sqlName, own] of constraints) {
            if (own.primaryKey === true || own.identity !== undefined || keyColumns.has(fieldName(sqlName))) own.nullable = false;
            const field = fields.get(sqlName)!;
            if (Object.keys(own).length > 0) field.constraints = own;
        }

        // Order means nothing to the database; by name, DDL written in any order gives the same model
        const byName = (a: { name: string }, b: { name: string }) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        tableConstraints.sort(byName);
        const indexes = table.indexes.filter(index => !this.usesSkipped(index, table))
            .map(index => this.index(index, fieldName, table)).sort(byName);
        const metadata: ModelData['metadata'] = { name: table.name };
        if (table.schema !== undefined) metadata.schema = table.schema;
        if (table.description !== undefined) metadata.description = table.description;
        const model: ModelData = { metadata, fields: [...fields.values()] };
        if (tableConstraints.length > 0) model.constraints = tableConstraints;
        if (indexes.length > 0) model.indexes = indexes;
        return { model, tableCatalog };
    }

    /** Model type of a column type: canonical type and parameters, or a PostgreSQL type override. */
    private fieldType(typeName: Node, table: TableInfo): Pick<FieldData, 'type' | 'parameters' | 'targets'> {
        const names = strings(typeName.names);
        const typeSchema = names.length > 1 ? names[0] : undefined;
        const name = names.at(-1)!;
        const modifiers = (typeName.typmods ?? []).map(constant) as number[];
        const isArray = (typeName.arrayBounds?.length ?? 0) > 0;
        if ((typeName.arrayBounds?.length ?? 0) > 1)
            throw new Error(`Multidimensional array columns are not supported in table ${table.sqlName}`);

        // The modifiers of INTERVAL YEAR TO MONTH and the like are a bit mask of fields, which can't be written back
        if (name === 'interval' && (typeSchema === undefined || typeSchema === 'pg_catalog') && modifiers.length > 0 && modifiers[0] !== INTERVAL_FULL_RANGE)
            throw new Error(`Interval columns limited to some fields are not supported in table ${table.sqlName}`);
        const scalar = this.scalarType(typeSchema, name, modifiers, table);
        if (scalar !== undefined && !(isArray && scalar.targets !== undefined)) {
            if (!isArray) return scalar;
            const items: Record<string, unknown> = { type: scalar.type };
            if (scalar.parameters !== undefined) items.parameters = scalar.parameters;
            return { type: 'ARRAY', parameters: { items } };
        }

        // Not a model type: keep the PostgreSQL type as it is
        const schema = typeSchema === 'pg_catalog' ? undefined : this.schemaOf(typeSchema);
        const text = `${schema !== undefined ? `${schema}.` : ''}${name}${modifiers.length > 0 ? `(${modifiers.join(',')})` : ''}${isArray ? '[]' : ''}`;
        return isArray
            ? { type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, targets: { postgresql: { type: text } } }
            : { type: name === 'json' ? 'JSON' : 'TEXT', targets: { postgresql: { type: text } } };
    }

    private scalarType(typeSchema: string | undefined, name: string, modifiers: number[], table: TableInfo): Pick<FieldData, 'type' | 'parameters' | 'targets'> | undefined {
        const builtin = typeSchema === undefined || typeSchema === 'pg_catalog';
        const precision = (p: number | undefined) => p !== undefined ? { parameters: { precision: p } } : {};
        // A native enum type of the table's own schema
        const enumName = this.qualified({ schema: this.schemaOf(typeSchema ?? this.defaultSchema), sqlName: name });
        const values = typeSchema !== 'pg_catalog' ? this.enumTypes.get(enumName) : undefined;
        if (values !== undefined) {
            if (this.schemaOf(typeSchema ?? this.defaultSchema) !== table.schema) return undefined;
            return { type: 'ENUM', parameters: { values }, targets: { postgresql: { enumType: name } } };
        }
        if (!builtin) return undefined;
        switch (name) {
            case 'int2': return { type: 'INT16' };
            case 'int4': return { type: 'INT32' };
            case 'int8': return { type: 'INT64' };
            case 'float4': return { type: 'FLOAT32' };
            case 'float8': return { type: 'FLOAT64' };
            case 'numeric':
                return modifiers.length > 0
                    ? { type: 'DECIMAL', parameters: { precision: modifiers[0], scale: modifiers[1] ?? 0 } }
                    : { type: 'DECIMAL' };
            case 'varchar':
                return modifiers.length === 1 ? { type: 'STRING', parameters: { length: modifiers[0] } } : undefined;
            case 'text': return { type: 'TEXT' };
            case 'bool': return { type: 'BOOLEAN' };
            case 'bytea': return { type: 'BYTES' };
            case 'uuid': return { type: 'UUID' };
            case 'date': return { type: 'DATE' };
            case 'jsonb': return { type: 'JSON' };
            case 'time': return { type: 'TIME', ...precision(modifiers[0]) };
            case 'timestamp': return { type: 'TIMESTAMP', ...precision(modifiers[0]) };
            case 'timestamptz': return { type: 'TIMESTAMP_TZ', ...precision(modifiers[0]) };
            case 'interval':
                return { type: 'DURATION', ...precision(modifiers[1]) };
            default:
                return undefined;
        }
    }

    private defaultValue(expression: Node, field: FieldData, table: TableInfo): Record<string, unknown> {
        const where = `default of ${field.name} in table ${table.sqlName}`;
        if (expression.SQLValueFunction) {
            const op = expression.SQLValueFunction.op;
            if (op === 'SVFOP_CURRENT_TIMESTAMP') return { function: 'now' };
            if (op === 'SVFOP_CURRENT_DATE') return { function: 'currentDate' };
        }
        if (expression.FuncCall && (expression.FuncCall.args ?? []).length === 0) {
            const name = strings(expression.FuncCall.funcname).at(-1);
            if (name === 'gen_random_uuid') return { function: 'uuid' };
            if (name === 'now') return { function: 'now' };
        }
        const items = field.type === 'ARRAY' ? field.parameters?.items as Record<string, unknown> | undefined : undefined;
        const elements = arrayElements(expression);
        if (elements !== undefined)
            return { value: elements.map(element => this.typedValue(constant(element), String(items?.type), where)) };
        const value = constant(expression);
        if (value === undefined)
            throw new Error(`Unsupported ${where}: only constants, CURRENT_TIMESTAMP, CURRENT_DATE and gen_random_uuid() can be read`);
        if (items !== undefined && typeof value === 'string') {
            const list = arrayLiteral(value);
            if (list === undefined) throw new Error(`Unsupported ${where}: ${value}`);
            return { value: list.map(item => this.typedValue(item, String(items.type), where)) };
        }
        return { value: this.typedValue(value, field.type, where) };
    }

    /** A constant as the model value for the type: quoted numbers become numbers, JSON text becomes JSON. */
    private typedValue(value: unknown, type: string, where: string): unknown {
        if (typeof value !== 'string') return value;
        if (NUMERIC_TYPES.has(type)) {
            const number = Number(value);
            if (Number.isNaN(number)) throw new Error(`Unsupported ${where}: ${value} is not a number`);
            return number;
        }
        if (type === 'BOOLEAN') return value === 't' || value === 'true';
        if (type === 'JSON') {
            try { return JSON.parse(value); } catch { return value; }
        }
        return value;
    }

    private foreignKey(constraint: Node, table: TableInfo): Record<string, unknown> {
        const target = constraint.pktable;
        const referenced = this.tables.get(this.qualified({ schema: this.schemaOf(target.schemaname), sqlName: target.relname }));
        let field = strings(constraint.pk_attrs)[0];
        if (field === undefined) {
            // REFERENCES table without a column: its primary key
            const key = referenced?.columns.find(c => c.constraints.some(k => k.contype === 'CONSTR_PRIMARY'))
                ?? referenced?.columns.find(c => referenced.constraints.some(k => k.contype === 'CONSTR_PRIMARY' && strings(k.keys)[0] === c.sqlName));
            if (key === undefined) throw new Error(`Cannot find the key a foreign key of table ${table.sqlName} references`);
            field = key.sqlName;
        }
        const foreignKey: Record<string, unknown> = {
            ref: this.modelName(target.relname, true, 'Table'),
            field: this.modelName(field, false, `Column of ${target.relname}`),
        };
        const onDelete = FK_ACTIONS[constraint.fk_del_action ?? 'a'];
        const onUpdate = FK_ACTIONS[constraint.fk_upd_action ?? 'a'];
        if (onDelete !== undefined) foreignKey.onDelete = onDelete;
        if (onUpdate !== undefined) foreignKey.onUpdate = onUpdate;
        return foreignKey;
    }

    /** The one column a CHECK expression is about, if it is a check of a single column. */
    private checkColumn(expression: Node): string | undefined {
        const found = new Set<string>();
        const visit = (node: Node) => {
            if (node === null || typeof node !== 'object') return;
            if (node.ColumnRef) found.add(columnName(node)!);
            for (const value of Object.values(node))
                if (Array.isArray(value)) value.forEach(visit);
                else visit(value);
        };
        visit(expression);
        return found.size === 1 ? [...found][0] : undefined;
    }

    /** Field constraints (min and max, enum or regex) a CHECK of one column expresses, if it is one of those. */
    private fieldCheck(expression: Node, column: string): Record<string, unknown> | undefined {
        const bool = expression.BoolExpr;
        if (bool?.boolop === 'AND_EXPR' && bool.args.length === 2) {
            const parts = bool.args.map((arg: Node) => this.fieldCheck(arg, column));
            const min = parts.find((part: Record<string, unknown> | undefined) => part?.min !== undefined);
            const max = parts.find((part: Record<string, unknown> | undefined) => part?.max !== undefined);
            return min !== undefined && max !== undefined && min !== max && Object.keys(min).length === 1 && Object.keys(max).length === 1
                ? { ...min, ...max } : undefined;
        }
        const expr = expression.A_Expr;
        if (expr === undefined || columnName(expr.lexpr) !== column) return undefined;
        const op = strings(expr.name)[0];
        if (expr.kind === 'AEXPR_IN' && op === '=') {
            const values = (expr.rexpr.List?.items ?? []).map(constant);
            return values.every((v: unknown) => typeof v === 'string') ? { enum: values } : undefined;
        }
        const elements = arrayElements(expr.rexpr);
        if ((expr.kind === 'AEXPR_OP_ANY' && op === '=') || (expr.kind === 'AEXPR_OP' && op === '<@')) {
            const values = elements?.map(constant);
            return values?.every((v: unknown) => typeof v === 'string') ? { enum: values } : undefined;
        }
        if (expr.kind !== 'AEXPR_OP') return undefined;
        const value = constant(expr.rexpr);
        if (op === '~' && typeof value === 'string') return { regex: value };
        const number = typeof value === 'string' ? Number(value) : value;
        if (typeof number !== 'number' || Number.isNaN(number)) return undefined;
        if (op === '>=') return { min: number };
        if (op === '<=') return { max: number };
        return undefined;
    }

    private rule(expression: Node, fieldName: (sqlName: string) => string, where: string): Rule {
        const expr = expression.A_Expr;
        const op = expr?.kind === 'AEXPR_OP' ? RULE_OPERATORS[strings(expr.name)[0]] : undefined;
        const field = columnName(expr?.lexpr);
        if (op === undefined || field === undefined)
            throw new Error(`Unsupported ${where}: only comparisons of a column with a value or another column can be read`);
        const other = columnName(expr.rexpr);
        if (other !== undefined) return { field: fieldName(field), op, otherField: fieldName(other) };
        const value = constant(expr.rexpr);
        if (value === undefined || value === null)
            throw new Error(`Unsupported ${where}: the column must be compared with a constant or another column`);
        return { field: fieldName(field), op, value };
    }

    private index(node: Node, fieldName: (sqlName: string) => string, table: TableInfo): Index {
        const where = `index ${node.idxname} of ${table.sqlName}`;
        if (node.idxname === undefined) throw new Error(`Index without a name on ${table.sqlName} is not supported`);
        const fields = (node.indexParams ?? []).map((param: Node) => {
            const element = param.IndexElem;
            if (element.name === undefined || element.opclass?.length || element.collation?.length
                || (element.ordering && element.ordering !== 'SORTBY_DEFAULT') || (element.nulls_ordering && element.nulls_ordering !== 'SORTBY_NULLS_DEFAULT'))
                throw new Error(`Unsupported ${where}: only plain columns can be read`);
            return fieldName(element.name);
        });
        if (node.indexIncludingParams?.length) throw new Error(`Unsupported ${where}: INCLUDE columns`);
        const index: Index = { name: this.sqlName(node.idxname, 'Index'), fields };
        if (node.unique) index.unique = true;
        if (node.whereClause !== undefined) index.where = this.rule(node.whereClause, fieldName, where);
        if (node.accessMethod !== undefined && node.accessMethod !== 'btree')
            index.targets = { postgresql: { method: node.accessMethod } };
        return index;
    }
}

/**
 * Reads tables, their constraints, indexes, comments and the enum types they use. The parser must be loaded first,
 * see loadDdlParser().
 */
export function parseDdl(ddl: string, options: DdlParseOptions = {}): ParsedSchema {
    return new Parser(options).parse(ddl);
}
