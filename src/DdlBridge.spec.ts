import * as fs from 'node:fs';
import { DdlBridge } from './DdlBridge';
import { Model } from 'model-algebra-common';

describe('DdlBridge', () => {
    let bridge: DdlBridge;

    beforeEach(() => {
        bridge = new DdlBridge({ comments: false });
    });

    it('should convert a simple model to Postgres DDL', () => {
        const modelData = fs.readFileSync('src/examples/user_core_model.json', 'utf-8');
        const model = new Model(JSON.parse(modelData));
        const ddl = bridge.toTarget(model);
        const expected =
            `CREATE TABLE "user" (\n` +
            `    id INTEGER NOT NULL PRIMARY KEY,\n` +
            `    user_name TEXT NOT NULL,\n` +
            `    first_name TEXT NOT NULL,\n` +
            `    second_name TEXT\n` +
            `);`;
        expect(ddl).toBe(expected);
    });

    it('should convert user_core_add_extended model to DDL', () => {
        const modelData = fs.readFileSync('src/examples/user_core_add_extended.json', 'utf-8');
        const model = new Model(JSON.parse(modelData));
        const ddl = bridge.toTarget(model);
        const expected =
            `CREATE TABLE "user" (\n` +
            `    id INTEGER NOT NULL PRIMARY KEY,\n` +
            `    user_name TEXT NOT NULL,\n` +
            `    first_name TEXT NOT NULL,\n` +
            `    second_name TEXT,\n` +
            `    birthdate DATE,\n` +
            `    father_name TEXT,\n` +
            `    address TEXT,\n` +
            `    phone TEXT CHECK (phone ~ '^\\+?[1-9]\\d{1,14}$'),\n` +
            `    hair_color TEXT CHECK (hair_color IN ('black', 'brown', 'blonde', 'red', 'auburn', 'gray', 'white')),\n` +
            `    height NUMERIC CHECK (height >= 50 AND height <= 272)\n` +
            `);`;
        expect(ddl).toBe(expected);
    });
});

describe('shop_database', () => {
    let bridge: DdlBridge;

    beforeEach(() => {
        bridge = new DdlBridge({ comments: false });
    });

    it('should convert user model', () => {
        const model = new Model(JSON.parse(fs.readFileSync('src/examples/shop_database/user.json', 'utf-8')));
        const expected =
            `CREATE TABLE "user" (\n` +
            `    id INTEGER NOT NULL PRIMARY KEY,\n` +
            `    user_name VARCHAR(100) NOT NULL,\n` +
            `    email VARCHAR(255) NOT NULL,\n` +
            `    password_hash VARCHAR(255) NOT NULL,\n` +
            `    created_at TIMESTAMP NOT NULL\n` +
            `);`;
        expect(bridge.toTarget(model)).toBe(expected);
    });

    it('should convert product model', () => {
        const model = new Model(JSON.parse(fs.readFileSync('src/examples/shop_database/product.json', 'utf-8')));
        const expected =
            `CREATE TABLE product (\n` +
            `    id INTEGER NOT NULL PRIMARY KEY,\n` +
            `    name VARCHAR(255) NOT NULL,\n` +
            `    description TEXT,\n` +
            `    price NUMERIC(10, 2) NOT NULL,\n` +
            `    stock_quantity INTEGER NOT NULL\n` +
            `);`;
        expect(bridge.toTarget(model)).toBe(expected);
    });

    it('should convert delivery_type model', () => {
        const model = new Model(JSON.parse(fs.readFileSync('src/examples/shop_database/delivery_type.json', 'utf-8')));
        const expected =
            `CREATE TABLE delivery_type (\n` +
            `    id INTEGER NOT NULL PRIMARY KEY,\n` +
            `    name VARCHAR(100) NOT NULL,\n` +
            `    description TEXT,\n` +
            `    price NUMERIC(10, 2) NOT NULL\n` +
            `);`;
        expect(bridge.toTarget(model)).toBe(expected);
    });

    it('should convert discount model', () => {
        const model = new Model(JSON.parse(fs.readFileSync('src/examples/shop_database/discount.json', 'utf-8')));
        const expected =
            `CREATE TABLE discount (\n` +
            `    id INTEGER NOT NULL PRIMARY KEY,\n` +
            `    code VARCHAR(50) NOT NULL,\n` +
            `    percentage NUMERIC(5, 2) NOT NULL,\n` +
            `    valid_from DATE NOT NULL,\n` +
            `    valid_to DATE NOT NULL\n` +
            `);`;
        expect(bridge.toTarget(model)).toBe(expected);
    });

    it('should convert order model with foreign keys and enum', () => {
        const model = new Model(JSON.parse(fs.readFileSync('src/examples/shop_database/order.json', 'utf-8')));
        const expected =
            `CREATE TABLE "order" (\n` +
            `    id INTEGER NOT NULL PRIMARY KEY,\n` +
            `    user_id INTEGER NOT NULL REFERENCES "user"(id),\n` +
            `    delivery_type_id INTEGER NOT NULL REFERENCES delivery_type(id),\n` +
            `    discount_id INTEGER REFERENCES discount(id),\n` +
            `    status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED')),\n` +
            `    total_price NUMERIC(10, 2) NOT NULL,\n` +
            `    created_at TIMESTAMP NOT NULL\n` +
            `);`;
        expect(bridge.toTarget(model)).toBe(expected);
    });

    it('should convert all shop_database models via toDdlArray', () => {
        const files = ['user', 'product', 'delivery_type', 'discount', 'order'];
        const models = files.map(f =>
            new Model(JSON.parse(fs.readFileSync(`src/examples/shop_database/${f}.json`, 'utf-8')))
        );
        const ddls = bridge.toDdlArray(models);
        expect(ddls).toHaveLength(5);
        expect(ddls[0]).toContain('CREATE TABLE "user"');
        expect(ddls[1]).toContain('CREATE TABLE product');
        expect(ddls[2]).toContain('CREATE TABLE delivery_type');
        expect(ddls[3]).toContain('CREATE TABLE discount');
        expect(ddls[4]).toContain('CREATE TABLE "order"');
    });
});

function makeModel(name: string, fields: any[], extra: Record<string, any> = {}): Model {
    const { metadata, ...rest } = extra;
    return new Model({ metadata: { name, version: '1.0.0', ...metadata }, fields, ...rest });
}

const idField = { name: 'id', type: 'INT32', constraints: { primaryKey: true, nullable: false } };

describe('SQL safety', () => {
    const bridge = new DdlBridge({ comments: false });

    it('should quote reserved and non-lowercase identifiers', () => {
        const ddl = bridge.toTarget(makeModel('Group', [{ name: 'select', type: 'TEXT' }, { name: '1st', type: 'TEXT' }]));
        expect(ddl).toBe(`CREATE TABLE "group" (\n    "select" TEXT,\n    "1st" TEXT\n);`);
    });

    it('should escape quotes in enum values and regex', () => {
        const ddl = bridge.toTarget(makeModel('Name', [
            { name: 'title', type: 'TEXT', constraints: { enum: ["O'Brien", 'plain'], regex: "^[^']+$" } },
        ]));
        expect(ddl).toContain(`CHECK (title IN ('O''Brien', 'plain'))`);
        expect(ddl).toContain(`CHECK (title ~ '^[^'']+$')`);
    });

    it('should reject non-numeric min/max and type parameters', () => {
        expect(() => bridge.toTarget(makeModel('T', [{ name: 'n', type: 'INT32', constraints: { min: '0; DROP TABLE x' } }])))
            .toThrow('Min of n must be a finite number');
        expect(() => bridge.toTarget(makeModel('T', [{ name: 's', type: 'STRING', parameters: { length: '10)' } }])))
            .toThrow('Length of s must be a finite number');
    });
});

describe('foreign keys', () => {
    const bridge = new DdlBridge({ comments: false });
    const user = makeModel('User', [idField]);

    it('should accept foreignKey and the legacy foreign_key alias', () => {
        const order = makeModel('Order', [
            idField,
            { name: 'userId', type: 'INT32', constraints: { foreignKey: { ref: 'User', field: 'id' } } },
            { name: 'creatorId', type: 'INT32', constraints: { foreign_key: { ref: 'User', field: 'id' } } },
        ]);
        const ddl = bridge.toTarget(order);
        expect(ddl).toContain(`    user_id INTEGER REFERENCES "user"(id),`);
        expect(ddl).toContain(`    creator_id INTEGER REFERENCES "user"(id)\n`);
    });

    it('should render referential actions', () => {
        const order = makeModel('Order', [
            { name: 'userId', type: 'INT32', constraints: { foreignKey: { ref: 'User', field: 'id', onDelete: 'cascade', onUpdate: 'noAction' } } },
            { name: 'couponId', type: 'INT32', constraints: { foreignKey: { ref: 'Coupon', field: 'id', onDelete: 'setNull' } } },
        ]);
        const ddl = bridge.toTarget(order);
        expect(ddl).toContain(`REFERENCES "user"(id) ON DELETE CASCADE ON UPDATE NO ACTION`);
        expect(ddl).toContain(`REFERENCES coupon(id) ON DELETE SET NULL`);
    });

    it('should reject unknown referential actions', () => {
        const order = makeModel('Order', [
            { name: 'userId', type: 'INT32', constraints: { foreignKey: { ref: 'User', field: 'id', onDelete: 'explode' } } },
        ]);
        expect(() => bridge.toTarget(order)).toThrow('Unsupported onDelete action: explode');
    });

    it('should create referenced tables first in toDdlArray', () => {
        const order = makeModel('Order', [idField, { name: 'userId', type: 'INT32', constraints: { foreignKey: { ref: 'User', field: 'id' } } }]);
        const ddls = bridge.toDdlArray([order, user]);
        expect(ddls).toHaveLength(2);
        expect(ddls[0]).toContain('CREATE TABLE "user"');
        expect(ddls[1]).toContain('CREATE TABLE "order"');
    });

    it('should move foreign keys of reference cycles to ALTER TABLE', () => {
        const a = makeModel('Author', [idField, { name: 'bestBookId', type: 'INT32', constraints: { foreignKey: { ref: 'Book', field: 'id' } } }]);
        const b = makeModel('Book', [idField, { name: 'authorId', type: 'INT32', constraints: { foreignKey: { ref: 'Author', field: 'id', onDelete: 'cascade' } } }]);
        expect(bridge.toDdlArray([a, b])).toEqual([
            `CREATE TABLE book (\n    id INTEGER NOT NULL PRIMARY KEY,\n    author_id INTEGER\n);`,
            `CREATE TABLE author (\n    id INTEGER NOT NULL PRIMARY KEY,\n    best_book_id INTEGER REFERENCES book(id)\n);`,
            `ALTER TABLE book ADD FOREIGN KEY (author_id) REFERENCES author(id) ON DELETE CASCADE;`,
        ]);
    });

    it('should keep self-references inline', () => {
        const category = makeModel('Category', [idField, { name: 'parentId', type: 'INT32', constraints: { foreignKey: { ref: 'Category', field: 'id' } } }]);
        expect(bridge.toDdlArray([category])).toEqual([
            `CREATE TABLE category (\n    id INTEGER NOT NULL PRIMARY KEY,\n    parent_id INTEGER REFERENCES category(id)\n);`,
        ]);
    });
});

describe('identity and defaults', () => {
    const bridge = new DdlBridge({ comments: false });

    it('should render identity columns and defaults', () => {
        const ddl = bridge.toTarget(makeModel('Item', [
            { name: 'id', type: 'INT64', constraints: { identity: 'always', primaryKey: true } },
            { name: 'seq', type: 'INT32', constraints: { identity: 'byDefault' } },
            { name: 'publicId', type: 'UUID', constraints: { default: { function: 'uuid' }, nullable: false } },
            { name: 'createdAt', type: 'TIMESTAMP', constraints: { default: { function: 'now' } } },
            { name: 'day', type: 'DATE', constraints: { default: { function: 'currentDate' } } },
            { name: 'qty', type: 'INT32', constraints: { default: { value: 0 } } },
            { name: 'active', type: 'BOOLEAN', constraints: { default: { value: true } } },
            { name: 'note', type: 'TEXT', constraints: { default: { value: "it's" } } },
            { name: 'attrs', type: 'JSON', constraints: { default: { value: { a: 1 } } } },
        ]));
        expect(ddl).toBe(
            `CREATE TABLE item (\n` +
            `    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n` +
            `    seq INTEGER GENERATED BY DEFAULT AS IDENTITY,\n` +
            `    public_id UUID DEFAULT gen_random_uuid() NOT NULL,\n` +
            `    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,\n` +
            `    day DATE DEFAULT CURRENT_DATE,\n` +
            `    qty INTEGER DEFAULT 0,\n` +
            `    active BOOLEAN DEFAULT TRUE,\n` +
            `    note TEXT DEFAULT 'it''s',\n` +
            `    attrs JSONB DEFAULT '{"a":1}'\n` +
            `);`);
    });

    it('should reject invalid identity and default definitions', () => {
        const t = (field: any) => () => bridge.toTarget(makeModel('T', [field]));
        expect(t({ name: 'id', type: 'TEXT', constraints: { identity: 'always' } })).toThrow('Identity requires an integer type');
        expect(t({ name: 'id', type: 'INT32', constraints: { identity: 'sometimes' } })).toThrow('Unsupported identity mode');
        expect(t({ name: 'id', type: 'INT32', constraints: { identity: 'always', default: { value: 1 } } })).toThrow('both identity and default');
        expect(t({ name: 'x', type: 'INT32', constraints: { default: 5 } })).toThrow('must be {"value": ...} or {"function": ...}');
        expect(t({ name: 'x', type: 'TEXT', constraints: { default: { function: 'random' } } })).toThrow('Unsupported default function');
    });
});

describe('comments', () => {
    it('should emit table and column comments by default', () => {
        const ddl = new DdlBridge().toTarget(makeModel('User', [
            { name: 'id', type: 'INT32', description: 'Main index' },
            { name: 'nick', type: 'TEXT' },
            { name: 'bio', type: 'TEXT', description: "User's bio" },
        ], { metadata: { description: 'Registered users' } }));
        expect(ddl).toBe(
            `CREATE TABLE "user" (\n    id INTEGER,\n    nick TEXT,\n    bio TEXT\n);\n\n` +
            `COMMENT ON TABLE "user" IS 'Registered users';\n\n` +
            `COMMENT ON COLUMN "user".id IS 'Main index';\n\n` +
            `COMMENT ON COLUMN "user".bio IS 'User''s bio';`);
    });
});

describe('table constraints and indexes', () => {
    const bridge = new DdlBridge({ comments: false });
    const fields = [
        { name: 'orderId', type: 'INT32', constraints: { nullable: false } },
        { name: 'lineNo', type: 'INT32', constraints: { nullable: false } },
        { name: 'sku', type: 'TEXT' },
        { name: 'status', type: 'TEXT' },
        { name: 'startDate', type: 'DATE' },
        { name: 'endDate', type: 'DATE' },
        { name: 'qty', type: 'INT32' },
    ];

    it('should render multi-field constraints and indexes', () => {
        const ddl = bridge.toTarget(makeModel('OrderLine', fields, {
            constraints: [
                { name: 'pkOrderLine', type: 'primaryKey', fields: ['orderId', 'lineNo'] },
                { name: 'uq_order_sku', type: 'unique', fields: ['orderId', 'sku'] },
                { name: 'ck_dates', type: 'check', rule: { field: 'endDate', op: '>=', otherField: 'startDate' } },
                { name: 'ck_qty', type: 'check', rule: { field: 'qty', op: '>', value: 0 } },
            ],
            indexes: [
                { name: 'idx_sku', fields: ['sku'] },
                { name: 'idx_open', fields: ['orderId', 'status'], unique: true, where: { field: 'status', op: '!=', value: 'DONE' } },
            ],
        }));
        expect(ddl).toBe(
            `CREATE TABLE order_line (\n` +
            `    order_id INTEGER NOT NULL,\n` +
            `    line_no INTEGER NOT NULL,\n` +
            `    sku TEXT,\n` +
            `    status TEXT,\n` +
            `    start_date DATE,\n` +
            `    end_date DATE,\n` +
            `    qty INTEGER,\n` +
            `    CONSTRAINT pk_order_line PRIMARY KEY (order_id, line_no),\n` +
            `    CONSTRAINT uq_order_sku UNIQUE (order_id, sku),\n` +
            `    CONSTRAINT ck_dates CHECK (end_date >= start_date),\n` +
            `    CONSTRAINT ck_qty CHECK (qty > 0)\n` +
            `);\n\n` +
            `CREATE INDEX idx_sku ON order_line (sku);\n\n` +
            `CREATE UNIQUE INDEX idx_open ON order_line (order_id, status) WHERE status <> 'DONE';`);
    });

    it('should reject invalid constraints and indexes', () => {
        const t = (extra: any, f: any[] = fields) => () => bridge.toTarget(makeModel('OrderLine', f, extra));
        expect(t({ constraints: [{ name: 'u', type: 'unique', fields: ['nope'] }] })).toThrow('Unknown field nope in constraint u of OrderLine');
        expect(t({ constraints: [{ name: 'u', type: 'unique', fields: [] }] })).toThrow('No fields listed');
        expect(t({ constraints: [{ name: 'x', type: 'exclude', fields: ['sku'] }] })).toThrow('Unsupported table constraint type: exclude');
        expect(t({ constraints: [{ name: 'c', type: 'check' }] })).toThrow('has no rule');
        expect(t({ constraints: [{ name: 'c', type: 'check', rule: { field: 'qty', op: '~', value: 1 } }] })).toThrow('Unsupported operator ~');
        expect(t({ constraints: [{ name: 'c', type: 'check', rule: { field: 'qty', op: '>', value: 1, otherField: 'lineNo' } }] })).toThrow('exactly one of value or otherField');
        expect(t({ indexes: [{ name: 'i', fields: ['qty'], where: { field: 'qty', op: '=', value: null } }] })).toThrow('cannot compare with null');
        expect(t({ constraints: [{ name: 'pk', type: 'primaryKey', fields: ['orderId'] }] }, [idField, ...fields]))
            .toThrow('primary key both on a field and in table constraints');
    });
});

describe('schemas', () => {
    const bridge = new DdlBridge({ comments: false });

    it('should qualify table names with the model schema', () => {
        const order = makeModel('Order', [{ name: 'userId', type: 'INT32', constraints: { foreignKey: { ref: 'User', field: 'id' } } }],
            { metadata: { schema: 'shop' }, indexes: [{ name: 'idx_user', fields: ['userId'] }] });
        expect(bridge.toTarget(order)).toBe(
            `CREATE SCHEMA IF NOT EXISTS shop;\n\n` +
            `CREATE TABLE shop."order" (\n    user_id INTEGER REFERENCES shop."user"(id)\n);\n\n` +
            `CREATE INDEX idx_user ON shop."order" (user_id);`);
    });

    it('should resolve referenced tables in other schemas in toDdlArray', () => {
        const user = makeModel('User', [idField], { metadata: { schema: 'auth' } });
        const order = makeModel('Order', [{ name: 'userId', type: 'INT32', constraints: { foreignKey: { ref: 'User', field: 'id' } } }],
            { metadata: { schema: 'shop' } });
        const ddls = bridge.toDdlArray([order, user]);
        expect(ddls[0]).toContain('CREATE TABLE auth."user"');
        expect(ddls[1]).toContain('REFERENCES auth."user"(id)');
    });
});

describe('additional types', () => {
    const bridge = new DdlBridge({ comments: false });

    it('should map INT16, BYTES and time precision', () => {
        const ddl = bridge.toTarget(makeModel('T', [
            { name: 'small', type: 'INT16', constraints: { identity: 'byDefault' } },
            { name: 'blob', type: 'BYTES' },
            { name: 't', type: 'TIME', parameters: { precision: 0 } },
            { name: 'ts', type: 'TIMESTAMP', parameters: { precision: 3 } },
            { name: 'dt', type: 'DATETIME', parameters: { precision: 6 } },
            { name: 'tz', type: 'TIMESTAMP_TZ', parameters: { precision: 3 } },
            { name: 'd', type: 'DURATION', parameters: { precision: 2 } },
            { name: 'plain', type: 'TIMESTAMP_TZ' },
        ]));
        expect(ddl).toBe(
            `CREATE TABLE t (\n` +
            `    small SMALLINT GENERATED BY DEFAULT AS IDENTITY,\n` +
            `    blob BYTEA,\n` +
            `    t TIME(0),\n` +
            `    ts TIMESTAMP(3),\n` +
            `    dt TIMESTAMP(6),\n` +
            `    tz TIMESTAMP(3) WITH TIME ZONE,\n` +
            `    d INTERVAL(2),\n` +
            `    plain TIMESTAMP WITH TIME ZONE\n` +
            `);`);
    });

    it('should reject time precision outside 0..6', () => {
        for (const precision of [7, -1, 2.5, '3'])
            expect(() => bridge.toTarget(makeModel('T', [{ name: 'ts', type: 'TIMESTAMP', parameters: { precision } }])))
                .toThrow('Precision of ts must be an integer from 0 to 6');
    });

    it('should map arrays with element parameters, allowed values and defaults', () => {
        const ddl = bridge.toTarget(makeModel('T', [
            { name: 'scores', type: 'ARRAY', parameters: { items: { type: 'INT32' } }, constraints: { default: { value: [] } } },
            { name: 'tags', type: 'ARRAY', parameters: { items: { type: 'STRING', parameters: { length: 20 } } },
              constraints: { nullable: false, default: { value: ['new', "it's"] } } },
            { name: 'prices', type: 'ARRAY', parameters: { items: { type: 'DECIMAL', parameters: { precision: 8, scale: 2 } } } },
            { name: 'days', type: 'ARRAY', parameters: { items: { type: 'ENUM', parameters: { values: ['MON', 'TUE'] } } } },
            { name: 'colors', type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, constraints: { enum: ['red', 'green'] } },
        ]));
        expect(ddl).toBe(
            `CREATE TABLE t (\n` +
            `    scores INTEGER[] DEFAULT ARRAY[]::INTEGER[],\n` +
            `    tags VARCHAR(20)[] DEFAULT ARRAY['new', 'it''s']::VARCHAR(20)[] NOT NULL,\n` +
            `    prices NUMERIC(8, 2)[],\n` +
            `    days TEXT[] CHECK (days <@ ARRAY['MON', 'TUE']::TEXT[]),\n` +
            `    colors TEXT[] CHECK (colors <@ ARRAY['red', 'green']::TEXT[])\n` +
            `);`);
    });

    it('should reject invalid arrays', () => {
        const t = (field: any) => () => bridge.toTarget(makeModel('T', [field]));
        expect(t({ name: 'a', type: 'ARRAY' })).toThrow('ARRAY field a requires parameters.items with a type');
        expect(t({ name: 'a', type: 'ARRAY', parameters: { items: { type: 'ARRAY', parameters: { items: { type: 'INT32' } } } } }))
            .toThrow('cannot contain arrays');
        expect(t({ name: 'a', type: 'ARRAY', parameters: { items: { type: 'INT32' } }, constraints: { min: 1 } }))
            .toThrow('not supported for ARRAY field a');
    });

    it('should enforce ENUM values even without constraints', () => {
        expect(bridge.toTarget(makeModel('T', [{ name: 'size', type: 'ENUM', parameters: { values: ['S', 'M'] } }])))
            .toBe(`CREATE TABLE t (\n    size TEXT CHECK (size IN ('S', 'M'))\n);`);
    });
});

describe('PostgreSQL target options', () => {
    const bridge = new DdlBridge({ comments: false });
    const status = (targets?: any) => ({ name: 'status', type: 'ENUM', parameters: { values: ['NEW', "CAN'T"] }, targets });

    it('should create native enum types', () => {
        expect(bridge.toTarget(makeModel('Order', [status({ postgresql: { enumType: 'orderStatus' } })], { metadata: { schema: 'shop' } }))).toBe(
            `CREATE SCHEMA IF NOT EXISTS shop;\n\n` +
            `CREATE TYPE shop.order_status AS ENUM ('NEW', 'CAN''T');\n\n` +
            `CREATE TABLE shop."order" (\n    status shop.order_status\n);`);
    });

    it('should create an enum type shared by several models once in toDdlArray', () => {
        const targets = { postgresql: { enumType: 'Status' } };
        const ddls = bridge.toDdlArray([makeModel('A', [status(targets)]), makeModel('B', [status(targets)])]);
        expect(ddls[0]).toBe(`CREATE TYPE status AS ENUM ('NEW', 'CAN''T');\n\nCREATE TABLE a (\n    status status\n);`);
        expect(ddls[1]).toBe(`CREATE TABLE b (\n    status status\n);`);
    });

    it('should reject conflicting or invalid enum types', () => {
        const other = { name: 'status', type: 'ENUM', parameters: { values: ['X'] }, targets: { postgresql: { enumType: 'Status' } } };
        expect(() => bridge.toDdlArray([makeModel('A', [status({ postgresql: { enumType: 'Status' } })]), makeModel('B', [other])]))
            .toThrow('Enum type status is defined with different values by field status of B');
        expect(() => bridge.toTarget(makeModel('A', [{ name: 'x', type: 'TEXT', targets: { postgresql: { enumType: 'X' } } }])))
            .toThrow('requires type ENUM with non-empty parameters.values');
    });

    it('should override the column type', () => {
        const ddl = bridge.toTarget(makeModel('T', [
            { name: 'email', type: 'TEXT', targets: { postgresql: { type: 'CITEXT' }, mysql: { ignored: true } }, constraints: { nullable: false } },
            { name: 'ips', type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, targets: { postgresql: { type: 'INET[]' } } },
        ]));
        expect(ddl).toBe(`CREATE TABLE t (\n    email CITEXT NOT NULL,\n    ips INET[]\n);`);
    });

    it('should reject unsafe type overrides and unknown options', () => {
        const t = (targets: any) => () => bridge.toTarget(makeModel('T', [{ name: 'x', type: 'TEXT', targets }]));
        expect(t({ postgresql: { type: 'TEXT; DROP TABLE t' } })).toThrow('Invalid PostgreSQL type override for field x');
        expect(t({ postgresql: { type: 'TEXT -- x' } })).toThrow('Invalid PostgreSQL type override');
        expect(t({ postgresql: { type: 'TEXT', enumType: 'X' } })).toThrow('cannot have both PostgreSQL type and enumType');
        expect(t({ postgresql: { collation: 'C' } })).toThrow('Unsupported PostgreSQL option collation in field x');
    });

    it('should use the index method', () => {
        const model = (method: string) => makeModel('T', [{ name: 'attrs', type: 'JSON' }],
            { indexes: [{ name: 'idx_attrs', fields: ['attrs'], targets: { postgresql: { method } } }] });
        expect(bridge.toTarget(model('gin'))).toContain(`CREATE INDEX idx_attrs ON t USING gin (attrs);`);
        expect(() => bridge.toTarget(model('fulltext'))).toThrow('Unsupported index method fulltext in index idx_attrs of T');
    });
});
