import {
    defaultConstraintName, fromSqlName, ident, MAX_IDENTIFIER_LENGTH, numberLiteral, quoteIdent, quoteLiteral,
    toSnakeCase, truncateIdentifier, valueLiteral,
} from './sql';

describe('names', () => {
    it.each([
        ['firstName', 'first_name'],
        ['UserProfile', 'user_profile'],
        ['line2Text', 'line2_text'],
        ['User db model', 'userdbmodel'],
    ])('%s is %s in SQL', (name, sql) => {
        expect(toSnakeCase(name)).toBe(sql);
    });

    it.each([
        ['first_name', false, 'firstName'],
        ['user_profile', true, 'UserProfile'],
        ['line2_text', false, 'line2Text'],
        ['id', true, 'Id'],
        // No model name gives these back, so they stay as they are
        ['address_2', false, 'address_2'],
        ['_hidden', false, '_hidden'],
        ['MixedCase', false, 'MixedCase'],
    ])('%s is %s in models', (sql, pascal, name) => {
        expect(fromSqlName(sql, pascal)).toBe(name);
    });

    it('quotes identifiers when SQL needs it', () => {
        expect(quoteIdent('user_name')).toBe('user_name');
        expect(quoteIdent('user')).toBe('"user"');
        expect(quoteIdent('Name')).toBe('"Name"');
        expect(quoteIdent('a"b')).toBe('"a""b"');
        expect(ident('selectAll')).toBe('select_all');
        expect(ident('select')).toBe('"select"');
    });
});

describe('literals', () => {
    it('escape quotes', () => {
        expect(quoteLiteral("it's")).toBe("'it''s'");
    });

    it.each([
        [null, 'NULL'],
        [1.5, '1.5'],
        [true, 'TRUE'],
        [false, 'FALSE'],
        ["o'k", "'o''k'"],
        [{ a: "o'k" }, `'{"a":"o''k"}'`],
        [[1, 2], "'[1,2]'"],
    ])('%j is %s', (value, sql) => {
        expect(valueLiteral(value, 'Value')).toBe(sql);
    });

    it('reject numbers that are not finite', () => {
        expect(() => numberLiteral(Infinity, 'Min')).toThrow('Min must be a finite number, got null');
        expect(() => numberLiteral('1', 'Min')).toThrow('Min must be a finite number, got "1"');
    });
});

describe('identifier length', () => {
    it('keeps names up to 63 bytes', () => {
        const name = 'a'.repeat(MAX_IDENTIFIER_LENGTH);
        expect(truncateIdentifier(name)).toBe(name);
    });

    it('cuts longer names to 63 bytes', () => {
        expect(truncateIdentifier('a'.repeat(70))).toBe('a'.repeat(63));
    });

    it('does not cut a multi-byte character in half', () => {
        // 62 bytes, then a 2-byte character across the limit
        const name = 'a'.repeat(62) + 'é' + 'b';
        expect(truncateIdentifier(name)).toBe('a'.repeat(62));
    });

    it('keeps the suffix of default constraint names', () => {
        expect(defaultConstraintName('user', ['email'], 'key')).toBe('user_email_key');
        expect(defaultConstraintName('event', [], 'pkey')).toBe('event_pkey');
        const long = defaultConstraintName('t'.repeat(40), ['c'.repeat(40)], 'check');
        expect(long).toHaveLength(MAX_IDENTIFIER_LENGTH);
        expect(long.endsWith('_check')).toBe(true);
    });
});
