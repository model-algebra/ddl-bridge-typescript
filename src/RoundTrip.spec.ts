import * as fs from 'node:fs';
import { Model, ModelSet } from 'model-algebra-common';
import { toModelData, type ModelData } from 'model-algebra-typescript';
import { DdlBridge } from './DdlBridge';
import { DdlSetBridge } from './DdlSetBridge';
import { loadDdlParser } from './DdlParser';
import { eventsJson, shopJson } from './test/models';

/*
 * Model -> DDL -> model. Models in canonical form, the form DdlSetBridge reads DDL into, come back exactly; other
 * models come back in canonical form. DDL may change once, to equivalent DDL, and stays the same after that.
 */

const bridge = new DdlSetBridge();

const modelSet = (json: any[]) => new ModelSet(json.map(model => new Model(structuredClone(model))));
const roundTrip = (json: any[]): ModelData[] => bridge.toModel(bridge.toTarget(modelSet(json))).models.map(m => toModelData(m));

/** The model as the round trip must give it back: no version, models by name. */
const expected = (json: any[]): ModelData[] => json
    .map(model => {
        const data = toModelData(new Model(structuredClone(model)));
        delete data.metadata.version;
        return data;
    })
    .sort((a, b) => a.metadata.name < b.metadata.name ? -1 : 1);

const item = (...fields: any[]) => ({ metadata: { name: 'Item', version: '1.0.0' }, fields });

beforeAll(loadDdlParser);

describe('canonical models come back unchanged', () => {
    it.each<[string, any]>([
        ['INT16', { type: 'INT16' }],
        ['INT32', { type: 'INT32' }],
        ['INT64', { type: 'INT64' }],
        ['FLOAT32', { type: 'FLOAT32' }],
        ['FLOAT64', { type: 'FLOAT64' }],
        ['DECIMAL', { type: 'DECIMAL' }],
        ['DECIMAL with precision and scale', { type: 'DECIMAL', parameters: { precision: 10, scale: 2 } }],
        ['DECIMAL with scale 0', { type: 'DECIMAL', parameters: { precision: 5, scale: 0 } }],
        ['STRING with length', { type: 'STRING', parameters: { length: 20 } }],
        ['TEXT', { type: 'TEXT' }],
        ['BOOLEAN', { type: 'BOOLEAN' }],
        ['BYTES', { type: 'BYTES' }],
        ['UUID', { type: 'UUID' }],
        ['DATE', { type: 'DATE' }],
        ['TIME', { type: 'TIME' }],
        ['TIME with precision', { type: 'TIME', parameters: { precision: 3 } }],
        ['TIMESTAMP', { type: 'TIMESTAMP' }],
        ['TIMESTAMP with precision 0', { type: 'TIMESTAMP', parameters: { precision: 0 } }],
        ['TIMESTAMP_TZ', { type: 'TIMESTAMP_TZ' }],
        ['TIMESTAMP_TZ with precision', { type: 'TIMESTAMP_TZ', parameters: { precision: 6 } }],
        ['DURATION', { type: 'DURATION' }],
        ['DURATION with precision', { type: 'DURATION', parameters: { precision: 2 } }],
        ['JSON', { type: 'JSON' }],
        ['ARRAY of INT32', { type: 'ARRAY', parameters: { items: { type: 'INT32' } } }],
        ['ARRAY of STRING with length', { type: 'ARRAY', parameters: { items: { type: 'STRING', parameters: { length: 5 } } } }],
        ['ARRAY of DECIMAL', { type: 'ARRAY', parameters: { items: { type: 'DECIMAL', parameters: { precision: 10, scale: 2 } } } }],
        ['ARRAY of TIMESTAMP_TZ', { type: 'ARRAY', parameters: { items: { type: 'TIMESTAMP_TZ', parameters: { precision: 3 } } } }],
        ['native enum type', { type: 'ENUM', parameters: { values: ['A', "B'C"] }, targets: { postgresql: { enumType: 'item_kind' } } }],
        ['type override', { type: 'TEXT', targets: { postgresql: { type: 'inet' } } }],
        ['type override with modifiers', { type: 'TEXT', targets: { postgresql: { type: 'bpchar(2)' } } }],
        ['json override', { type: 'JSON', targets: { postgresql: { type: 'json' } } }],
        ['array type override', { type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, targets: { postgresql: { type: 'inet[]' } } }],
        ['not null', { type: 'TEXT', constraints: { nullable: false } }],
        ['primary key', { type: 'INT64', constraints: { primaryKey: true, nullable: false } }],
        ['unique', { type: 'UUID', constraints: { unique: true } }],
        ['identity always', { type: 'INT64', constraints: { identity: 'always', nullable: false } }],
        ['identity by default', { type: 'INT16', constraints: { identity: 'byDefault', nullable: false } }],
        ['integer default', { type: 'INT32', constraints: { default: { value: 42 } } }],
        ['negative default', { type: 'INT32', constraints: { default: { value: -7 } } }],
        ['decimal default', { type: 'DECIMAL', parameters: { precision: 6, scale: 2 }, constraints: { default: { value: 1.25 } } }],
        ['text default with a quote', { type: 'TEXT', constraints: { default: { value: "it's" } } }],
        ['empty text default', { type: 'STRING', parameters: { length: 3 }, constraints: { default: { value: '' } } }],
        ['boolean defaults', { type: 'BOOLEAN', constraints: { default: { value: true } } }],
        ['false default', { type: 'BOOLEAN', constraints: { default: { value: false } } }],
        ['null default', { type: 'TEXT', constraints: { default: { value: null } } }],
        ['JSON object default', { type: 'JSON', constraints: { default: { value: { a: [1, 'x'], b: null } } } }],
        ['JSON array default', { type: 'JSON', constraints: { default: { value: [1, 2] } } }],
        ['JSON text default', { type: 'JSON', constraints: { default: { value: 'not json' } } }],
        ['array of text default', { type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, constraints: { default: { value: ['a', 'b c'] } } }],
        ['array of numbers default', { type: 'ARRAY', parameters: { items: { type: 'INT32' } }, constraints: { default: { value: [1, 2] } } }],
        ['empty array default', { type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, constraints: { default: { value: [] } } }],
        ['current timestamp default', { type: 'TIMESTAMP_TZ', constraints: { default: { function: 'now' } } }],
        ['current date default', { type: 'DATE', constraints: { default: { function: 'currentDate' } } }],
        ['UUID default', { type: 'UUID', constraints: { default: { function: 'uuid' } } }],
        ['native enum default', { type: 'ENUM', parameters: { values: ['A', 'B'] }, targets: { postgresql: { enumType: 'item_kind' } }, constraints: { default: { value: 'B' } } }],
        ['min', { type: 'INT32', constraints: { min: 0 } }],
        ['max', { type: 'INT32', constraints: { max: 10 } }],
        ['min and max', { type: 'INT16', constraints: { min: -5, max: 5 } }],
        ['fractional min of a float', { type: 'FLOAT64', constraints: { min: -1.5 } }],
        ['min and max of a decimal', { type: 'DECIMAL', parameters: { precision: 8, scale: 2 }, constraints: { min: 0.01, max: 999.99 } }],
        ['allowed values', { type: 'TEXT', constraints: { enum: ['red', 'green', "o'range"] } }],
        ['allowed values of a varchar', { type: 'STRING', parameters: { length: 10 }, constraints: { enum: ['a', 'b'] } }],
        ['allowed values of an array', { type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, constraints: { enum: ['x', 'y'] } }],
        ['regex', { type: 'TEXT', constraints: { regex: "^[a-z]+\\d*'?$" } }],
        ['description', { type: 'TEXT', description: "Shown as it's typed" }],
        ['everything at once', {
            type: 'STRING', parameters: { length: 30 }, description: 'Code',
            constraints: { nullable: false, unique: true, default: { value: 'AB' }, regex: '^[A-Z]+$', enum: ['AB', 'CD'] },
        }],
    ])('%s', (_, field) => {
        const json = [item({ name: 'value', ...field })];
        expect(roundTrip(json)).toEqual(expected(json));
    });

    it('names that need quotes or have digits', () => {
        const json = [{
            metadata: { name: 'Order' },
            fields: [{ name: 'user', type: 'TEXT' }, { name: 'line2Text', type: 'TEXT' }, { name: 'select', type: 'INT32' }],
        }];
        expect(bridge.toTarget(modelSet(json))).toContain('CREATE TABLE "order" (\n    "user" TEXT,\n    line2_text TEXT,\n    "select" INTEGER\n);');
        expect(roundTrip(json)).toEqual(expected(json));
    });

    it('schemas and descriptions of tables', () => {
        const json = [{ metadata: { name: 'Item', schema: 'store', description: "Things to sell, 'all'" }, fields: [{ name: 'id', type: 'INT32' }] }];
        expect(roundTrip(json)).toEqual(expected(json));
    });

    it('table constraints', () => {
        const json = [{
            metadata: { name: 'Range' },
            fields: [
                { name: 'low', type: 'INT32', constraints: { nullable: false } },
                { name: 'high', type: 'INT32', constraints: { nullable: false } },
                { name: 'label', type: 'TEXT' },
                { name: 'active', type: 'BOOLEAN' },
            ],
            constraints: [
                { name: 'range_active', type: 'check', rule: { field: 'active', op: '=', value: true } },
                { name: 'range_key', type: 'primaryKey', fields: ['low', 'high'] },
                { name: 'range_label', type: 'unique', fields: ['label', 'low'] },
                { name: 'range_label_not', type: 'check', rule: { field: 'label', op: '!=', value: "n'a" } },
                { name: 'range_order', type: 'check', rule: { field: 'low', op: '<', otherField: 'high' } },
                { name: 'range_positive', type: 'check', rule: { field: 'high', op: '>', value: 0 } },
                // Strict comparisons: a field's min or max can't express them
                { name: 'range_small', type: 'check', rule: { field: 'low', op: '<', value: -1.5 } },
            ],
        }];
        expect(roundTrip(json)).toEqual(expected(json));
    });

    it('indexes', () => {
        const json = [{
            metadata: { name: 'Doc', schema: 'docs' },
            fields: [
                { name: 'title', type: 'TEXT' },
                { name: 'tags', type: 'ARRAY', parameters: { items: { type: 'TEXT' } } },
                { name: 'created', type: 'TIMESTAMP' },
                { name: 'archived', type: 'BOOLEAN' },
            ],
            indexes: [
                { name: 'doc_created', fields: ['created'], targets: { postgresql: { method: 'brin' } } },
                { name: 'doc_open', fields: ['title', 'created'], where: { field: 'archived', op: '=', value: false } },
                { name: 'doc_tags', fields: ['tags'], targets: { postgresql: { method: 'gin' } } },
                { name: 'doc_title', fields: ['title'], unique: true },
                { name: 'doc_title_hash', fields: ['title'], targets: { postgresql: { method: 'hash' } } },
            ],
        }];
        expect(roundTrip(json)).toEqual(expected(json));
    });

    it('foreign keys with every referential action, to itself and across schemas', () => {
        const json = [
            { metadata: { name: 'Account', schema: 'auth' }, fields: [{ name: 'id', type: 'INT64', constraints: { primaryKey: true, nullable: false } }] },
            {
                metadata: { name: 'Post' },
                fields: [
                    { name: 'id', type: 'INT64', constraints: { primaryKey: true, nullable: false } },
                    { name: 'authorId', type: 'INT64', constraints: { nullable: false, foreignKey: { ref: 'Account', field: 'id', onDelete: 'cascade', onUpdate: 'restrict' } } },
                    { name: 'editorId', type: 'INT64', constraints: { foreignKey: { ref: 'Account', field: 'id', onDelete: 'setNull' } } },
                    { name: 'reviewerId', type: 'INT64', constraints: { default: { value: 0 }, foreignKey: { ref: 'Account', field: 'id', onDelete: 'setDefault', onUpdate: 'cascade' } } },
                    { name: 'parentId', type: 'INT64', constraints: { foreignKey: { ref: 'Post', field: 'id' } } },
                ],
            },
        ];
        expect(roundTrip(json)).toEqual(expected(json));
    });

    it('foreign keys in a reference cycle', () => {
        const json = [
            { metadata: { name: 'A' }, fields: [{ name: 'id', type: 'INT32', constraints: { primaryKey: true, nullable: false } }, { name: 'bId', type: 'INT32', constraints: { foreignKey: { ref: 'B', field: 'id' } } }] },
            { metadata: { name: 'B' }, fields: [{ name: 'id', type: 'INT32', constraints: { primaryKey: true, nullable: false } }, { name: 'aId', type: 'INT32', constraints: { foreignKey: { ref: 'A', field: 'id' } } }] },
        ];
        expect(roundTrip(json)).toEqual(expected(json));
    });

    it('a native enum type shared by two models', () => {
        const status = { type: 'ENUM', parameters: { values: ['ON', 'OFF'] }, targets: { postgresql: { enumType: 'status' } } };
        const json = [
            { metadata: { name: 'Lamp' }, fields: [{ name: 'status', ...status }] },
            { metadata: { name: 'Switch' }, fields: [{ name: 'status', ...status, constraints: { nullable: false } }] },
        ];
        expect(roundTrip(json)).toEqual(expected(json));
    });

    it('a model read from DDL', async () => {
        const read = bridge.toModel(fs.readFileSync('src/test/fixtures/events.pg_dump.sql', 'utf-8')).models.map(m => toModelData(m));
        expect(roundTrip(read)).toEqual(read);
    });
});

describe('other models come back in canonical form', () => {
    it.each<[string, any, any]>([
        ['legacy integer', { type: 'integer' }, { type: 'INT32' }],
        ['legacy number', { type: 'number' }, { type: 'DECIMAL' }],
        ['legacy string', { type: 'string' }, { type: 'TEXT' }],
        ['STRING without length', { type: 'STRING' }, { type: 'TEXT' }],
        ['legacy boolean', { type: 'boolean' }, { type: 'BOOLEAN' }],
        ['legacy date', { type: 'date' }, { type: 'DATE' }],
        ['DATETIME', { type: 'DATETIME', parameters: { precision: 2 } }, { type: 'TIMESTAMP', parameters: { precision: 2 } }],
        ['OBJECT', { type: 'OBJECT', parameters: { ref: 'Address' } }, { type: 'JSON' }],
        ['UNION', { type: 'UNION', parameters: { oneOf: [{ type: 'STRING' }, { type: 'INT32' }] } }, { type: 'JSON' }],
        ['ENUM without a native type', { type: 'ENUM', parameters: { values: ['A', 'B'] } }, { type: 'TEXT', constraints: { enum: ['A', 'B'] } }],
        ['ARRAY of ENUM', { type: 'ARRAY', parameters: { items: { type: 'ENUM', parameters: { values: ['x'] } } } }, { type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, constraints: { enum: ['x'] } }],
        ['explicitly nullable', { type: 'TEXT', constraints: { nullable: true } }, { type: 'TEXT' }],
        ['primary key without not null', { type: 'INT32', constraints: { primaryKey: true } }, { type: 'INT32', constraints: { primaryKey: true, nullable: false } }],
        ['identity without not null', { type: 'INT64', constraints: { identity: 'always' } }, { type: 'INT64', constraints: { identity: 'always', nullable: false } }],
        ['NO ACTION', { type: 'INT32', constraints: { foreignKey: { ref: 'Item', field: 'id', onDelete: 'noAction' } } }, { type: 'INT32', constraints: { foreignKey: { ref: 'Item', field: 'id' } } }],
        ['legacy foreign_key', { type: 'INT32', constraints: { foreign_key: { ref: 'Item', field: 'id' } } }, { type: 'INT32', constraints: { foreignKey: { ref: 'Item', field: 'id' } } }],
        ['constraints ignored by DDL', { type: 'TEXT', constraints: { required: true } }, { type: 'TEXT' }],
        ['explicit btree index method', null, null],
    ])('%s', (name, field, canonical) => {
        if (field === null) {
            const json = [{ metadata: { name: 'Item' }, fields: [{ name: 'a', type: 'TEXT' }], indexes: [{ name: 'item_a', fields: ['a'], targets: { postgresql: { method: 'btree' } } }] }];
            expect(roundTrip(json)[0].indexes).toEqual([{ name: 'item_a', fields: ['a'] }]);
            return;
        }
        const id = { name: 'id', type: 'INT32', constraints: { primaryKey: true, nullable: false } };
        const [model] = roundTrip([{ metadata: { name: 'Item' }, fields: [id, { name: 'value', ...field }] }]);
        expect(model.fields[1]).toEqual({ name: 'value', ...canonical });
    });

    it('model names', () => {
        const [model] = roundTrip([{ metadata: { name: 'userProfile', version: '2' }, fields: [{ name: 'FirstName', type: 'TEXT' }] }]);
        expect(model.metadata).toEqual({ name: 'UserProfile' });
        expect(model.fields[0].name).toBe('firstName');
    });

    it('a single-column table constraint becomes a field constraint', () => {
        const [model] = roundTrip([{
            metadata: { name: 'Item' },
            fields: [{ name: 'code', type: 'TEXT' }, { name: 'qty', type: 'INT32' }],
            constraints: [
                { name: 'item_code', type: 'unique', fields: ['code'] },
                { name: 'item_qty', type: 'check', rule: { field: 'qty', op: '>=', value: 1 } },
            ],
        }]);
        expect(model.constraints).toBeUndefined();
        expect(model.fields).toEqual([
            { name: 'code', type: 'TEXT', constraints: { unique: true } },
            { name: 'qty', type: 'INT32', constraints: { min: 1 } },
        ]);
    });
});

describe('DDL read and written again', () => {
    const examples = ['user_core_model', 'user_core_add_extended', 'user_extended_model', 'all_types_model']
        .map((name): [string, any[]] => [name, [JSON.parse(fs.readFileSync(`src/examples/${name}.json`, 'utf-8'))]]);
    // Tables come back ordered by name, so the statements are compared regardless of order
    const statements = (text: string) => text.split('\n\n').sort();

    it.each<[string, any[]]>([
        ...examples,
        ['shop database', shopJson],
        ['events', eventsJson],
    ])('%s: means the same, and is the same from then on', (_, json) => {
        const first = bridge.toTarget(modelSet(json));
        const second = bridge.toTarget(bridge.toModel(first));
        const third = bridge.toTarget(bridge.toModel(second));
        // Both create the same database...
        expect(bridge.toModel(second).models.map(m => toModelData(m))).toEqual(bridge.toModel(first).models.map(m => toModelData(m)));
        // ...and canonical models give the same DDL every time
        expect(statements(third)).toEqual(statements(second));
    });

    it('of a canonical model is the same the first time', () => {
        const json = bridge.toModel(fs.readFileSync('src/test/fixtures/shop.pg_dump.sql', 'utf-8')).models.map(m => toModelData(m));
        const ddl = bridge.toTarget(modelSet(json));
        expect(statements(bridge.toTarget(bridge.toModel(ddl)))).toEqual(statements(ddl));
    });

    it('of a single model with DdlBridge', () => {
        const single = new DdlBridge();
        const first = single.toTarget(new Model(structuredClone(eventsJson[0])));
        const second = single.toTarget(single.toModel(first));
        expect(single.toTarget(single.toModel(second))).toBe(second);
    });
});
