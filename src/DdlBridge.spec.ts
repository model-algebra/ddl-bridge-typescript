import * as fs from 'node:fs';
import { DdlBridge } from './DdlBridge';
import { Model } from './Model';

describe('DdlBridge', () => {
    let bridge: DdlBridge;

    beforeEach(() => {
        bridge = new DdlBridge();
    });

    it('should convert a simple model to Postgres DDL', () => {
        const modelData = fs.readFileSync('src/examples/user_core_model.json', 'utf-8');
        const model = new Model(JSON.parse(modelData));
        const ddl = bridge.toDdl(model);
        const expected =
            `CREATE TABLE user (\n` +
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
        const ddl = bridge.toDdl(model);
        const expected =
            `CREATE TABLE user (\n` +
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
        bridge = new DdlBridge();
    });

    it('should convert user model', () => {
        const model = new Model(JSON.parse(fs.readFileSync('src/examples/shop_database/user.json', 'utf-8')));
        const expected =
            `CREATE TABLE user (\n` +
            `    id INTEGER NOT NULL PRIMARY KEY,\n` +
            `    user_name VARCHAR(100) NOT NULL,\n` +
            `    email VARCHAR(255) NOT NULL,\n` +
            `    password_hash VARCHAR(255) NOT NULL,\n` +
            `    created_at TIMESTAMP NOT NULL\n` +
            `);`;
        expect(bridge.toDdl(model)).toBe(expected);
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
        expect(bridge.toDdl(model)).toBe(expected);
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
        expect(bridge.toDdl(model)).toBe(expected);
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
        expect(bridge.toDdl(model)).toBe(expected);
    });

    it('should convert order model with foreign keys and enum', () => {
        const model = new Model(JSON.parse(fs.readFileSync('src/examples/shop_database/order.json', 'utf-8')));
        const expected =
            `CREATE TABLE order (\n` +
            `    id INTEGER NOT NULL PRIMARY KEY,\n` +
            `    user_id INTEGER NOT NULL REFERENCES user(id),\n` +
            `    delivery_type_id INTEGER NOT NULL REFERENCES delivery_type(id),\n` +
            `    discount_id INTEGER REFERENCES discount(id),\n` +
            `    status TEXT NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED')),\n` +
            `    total_price NUMERIC(10, 2) NOT NULL,\n` +
            `    created_at TIMESTAMP NOT NULL\n` +
            `);`;
        expect(bridge.toDdl(model)).toBe(expected);
    });

    it('should convert all shop_database models via toDdlArray', () => {
        const files = ['user', 'product', 'delivery_type', 'discount', 'order'];
        const models = files.map(f =>
            new Model(JSON.parse(fs.readFileSync(`src/examples/shop_database/${f}.json`, 'utf-8')))
        );
        const ddls = bridge.toDdlArray(models);
        expect(ddls).toHaveLength(5);
        expect(ddls[0]).toContain('CREATE TABLE user');
        expect(ddls[1]).toContain('CREATE TABLE product');
        expect(ddls[2]).toContain('CREATE TABLE delivery_type');
        expect(ddls[3]).toContain('CREATE TABLE discount');
        expect(ddls[4]).toContain('CREATE TABLE order');
    });
});
