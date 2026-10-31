/** PostgreSQL truncates identifiers to this many bytes. */
export declare const MAX_IDENTIFIER_LENGTH = 63;
export declare function toSnakeCase(name: string): string;
/** SQL name to a model name: camelCase for fields, PascalCase for models, when toSnakeCase() gives the SQL name back. */
export declare function fromSqlName(name: string, pascal: boolean): string;
export declare function quoteIdent(name: string): string;
/** Model name (camelCase or PascalCase) to a quoted SQL identifier. */
export declare function ident(name: string): string;
export declare function quoteLiteral(value: unknown): string;
export declare function numberLiteral(value: unknown, what: string): string;
export declare function valueLiteral(value: unknown, what: string): string;
/** Truncates a name the way PostgreSQL does, to MAX_IDENTIFIER_LENGTH bytes. */
export declare function truncateIdentifier(name: string): string;
/**
 * Name PostgreSQL gives a constraint created without one: table, columns and a suffix
 * (pkey, key, fkey, check), e.g. user_email_key. Repeated names get 1, 2, ... appended.
 */
export declare function defaultConstraintName(table: string, columns: string[], suffix: string): string;
//# sourceMappingURL=sql.d.ts.map