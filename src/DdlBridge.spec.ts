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
