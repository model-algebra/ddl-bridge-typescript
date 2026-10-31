// SQL naming and literals shared by the DDL generator, the DDL parser and migrations

// PostgreSQL reserved key words (Appendix C, "reserved" and "reserved (can be function or type)")
const RESERVED_WORDS = new Set([
    'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'asymmetric', 'authorization',
    'binary', 'both', 'case', 'cast', 'check', 'collate', 'collation', 'column', 'concurrently',
    'constraint', 'create', 'cross', 'current_catalog', 'current_date', 'current_role',
    'current_schema', 'current_time', 'current_timestamp', 'current_user', 'default', 'deferrable',
    'desc', 'distinct', 'do', 'else', 'end', 'except', 'false', 'fetch', 'for', 'foreign', 'freeze',
    'from', 'full', 'grant', 'group', 'having', 'ilike', 'in', 'initially', 'inner', 'intersect',
    'into', 'is', 'isnull', 'join', 'lateral', 'leading', 'left', 'like', 'limit', 'localtime',
    'localtimestamp', 'natural', 'not', 'notnull', 'null', 'offset', 'on', 'only', 'or', 'order',
    'outer', 'overlaps', 'placing', 'primary', 'references', 'returning', 'right', 'select',
    'session_user', 'similar', 'some', 'symmetric', 'system_user', 'table', 'tablesample', 'then',
    'to', 'trailing', 'true', 'union', 'unique', 'user', 'using', 'variadic', 'verbose', 'when',
    'where', 'window', 'with'
]);

/** PostgreSQL truncates identifiers to this many bytes. */
export const MAX_IDENTIFIER_LENGTH = 63;

export function toSnakeCase(name: string): string {
    return name
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '')
        .replace(/[^a-z0-9_]/g, '');
}

/** SQL name to a model name: camelCase for fields, PascalCase for models, when toSnakeCase() gives the SQL name back. */
export function fromSqlName(name: string, pascal: boolean): string {
    const camel = name.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
    const converted = pascal ? camel.charAt(0).toUpperCase() + camel.slice(1) : camel;
    return toSnakeCase(converted) === name ? converted : name;
}

export function quoteIdent(name: string): string {
    return /^[a-z_][a-z0-9_]*$/.test(name) && !RESERVED_WORDS.has(name)
        ? name
        : `"${name.replace(/"/g, '""')}"`;
}

/** Model name (camelCase or PascalCase) to a quoted SQL identifier. */
export function ident(name: string): string {
    return quoteIdent(toSnakeCase(name));
}

export function quoteLiteral(value: unknown): string {
    return `'${String(value).replace(/'/g, "''")}'`;
}

export function numberLiteral(value: unknown, what: string): string {
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error(`${what} must be a finite number, got ${JSON.stringify(value)}`);
    return String(value);
}

export function valueLiteral(value: unknown, what: string): string {
    if (value === null) return 'NULL';
    if (typeof value === 'number') return numberLiteral(value, what);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'string') return quoteLiteral(value);
    return quoteLiteral(JSON.stringify(value));
}

/** Truncates a name the way PostgreSQL does, to MAX_IDENTIFIER_LENGTH bytes. */
export function truncateIdentifier(name: string): string {
    const bytes = new TextEncoder().encode(name);
    if (bytes.length <= MAX_IDENTIFIER_LENGTH) return name;
    let end = MAX_IDENTIFIER_LENGTH;
    // Don't cut a multi-byte character in half
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    return new TextDecoder().decode(bytes.slice(0, end));
}

/**
 * Name PostgreSQL gives a constraint created without one: table, columns and a suffix
 * (pkey, key, fkey, check), e.g. user_email_key. Repeated names get 1, 2, ... appended.
 */
export function defaultConstraintName(table: string, columns: string[], suffix: string): string {
    const base = [table, ...columns].join('_');
    // PostgreSQL shortens the table and column part so that the suffix always fits
    return `${truncateIdentifier(base).slice(0, MAX_IDENTIFIER_LENGTH - suffix.length - 1)}_${suffix}`;
}
