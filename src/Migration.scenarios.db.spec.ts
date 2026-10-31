import { Model, ModelSet } from 'model-algebra-common';
import { Migration, type MigrationPlan } from './Migration';
import { adminUrl, createDatabase, type TestDatabase } from './test/database';

/*
 * Migrations of single kinds of change, run on a real PostgreSQL (see src/test/database.ts). Each scenario creates
 * the old models in a new database, writes rows, migrates to the new models, and checks that the database then has
 * exactly the new models: planning again finds nothing to do.
 */

interface Scenario {
    from: any[];
    to: any[];
    careful?: boolean;
    /** SQL run after the old models are created. */
    seed?: string[];
    /** Checks run after the migration. */
    check?: (test: TestDatabase, plan: MigrationPlan) => Promise<void>;
}

const model = (name: string, fields: any[], extra: Record<string, unknown> = {}) =>
    ({ metadata: { name, ...(extra.metadata as object ?? {}) }, fields, ...extra, ...(extra.metadata ? { metadata: { name, ...(extra.metadata as object) } } : {}) });
const id = { name: 'id', type: 'INT32', constraints: { primaryKey: true } };
const models = (json: any[]) => new ModelSet(json.map(m => new Model(structuredClone(m))));

const scenarios: Record<string, Scenario> = {
    'changes a type that has a default and checks': {
        from: [model('Item', [id, { name: 'qty', type: 'INT16', constraints: { default: { value: 1 }, min: 0 } }])],
        to: [model('Item', [id, { name: 'qty', type: 'INT32', constraints: { default: { value: 2 }, min: 1, max: 9 } }])],
        seed: ['INSERT INTO item VALUES (1, 5)'],
        check: async ({ db, rows }) => {
            await db.query('INSERT INTO item (id) VALUES (2)');
            expect(await rows('SELECT id, qty FROM item ORDER BY id')).toEqual([{ id: 1, qty: 5 }, { id: 2, qty: 2 }]);
            await expect(db.query('INSERT INTO item VALUES (3, 10)')).rejects.toThrow(/check/);
        },
    },
    'changes a type keeping its default': {
        from: [model('Item', [id, { name: 'name', type: 'STRING', parameters: { length: 5 }, constraints: { default: { value: 'x' } } }])],
        to: [model('Item', [id, { name: 'name', type: 'STRING', parameters: { length: 20 }, constraints: { default: { value: 'x' } } }])],
        seed: ["INSERT INTO item VALUES (1, 'abc')"],
        check: async ({ db, rows }) => {
            await db.query(`INSERT INTO item VALUES (2, '${'y'.repeat(20)}')`);
            await db.query('INSERT INTO item (id) VALUES (3)');
            expect(await rows('SELECT name FROM item ORDER BY id')).toEqual([{ name: 'abc' }, { name: 'y'.repeat(20) }, { name: 'x' }]);
        },
    },
    'changes a type and drops its default': {
        from: [model('Item', [id, { name: 'n', type: 'INT32', constraints: { default: { value: 5 } } }])],
        to: [model('Item', [id, { name: 'n', type: 'INT64' }])],
        seed: ['INSERT INTO item VALUES (1, 7)'],
        check: async ({ db, rows }) => {
            await db.query('INSERT INTO item (id) VALUES (2)');
            expect(await rows('SELECT n FROM item ORDER BY id')).toEqual([{ n: '7' }, { n: null }]);
        },
    },
    'turns text into a native enum type': {
        from: [model('Item', [id, { name: 'mood', type: 'TEXT' }])],
        to: [model('Item', [id, { name: 'mood', type: 'ENUM', parameters: { values: ['ok', 'sad'] }, targets: { postgresql: { enumType: 'mood' } } }])],
        seed: ["INSERT INTO item VALUES (1, 'sad')"],
        check: async ({ db, rows }) => {
            expect(await rows('SELECT mood FROM item')).toEqual([{ mood: 'sad' }]);
            await expect(db.query("INSERT INTO item VALUES (2, 'angry')")).rejects.toThrow(/invalid input value for enum/);
        },
    },
    'turns a native enum type into text with allowed values': {
        from: [model('Item', [id, { name: 'mood', type: 'ENUM', parameters: { values: ['ok', 'sad'] }, targets: { postgresql: { enumType: 'mood' } } }])],
        to: [model('Item', [id, { name: 'mood', type: 'ENUM', parameters: { values: ['ok', 'sad'] } }])],
        seed: ["INSERT INTO item VALUES (1, 'ok')"],
        check: async ({ db }) => {
            await expect(db.query("INSERT INTO item VALUES (2, 'angry')")).rejects.toThrow(/item_mood_check/);
        },
    },
    'adds values to a native enum type': {
        from: [model('Item', [id, { name: 'size', type: 'ENUM', parameters: { values: ['M'] }, targets: { postgresql: { enumType: 'size' } } }])],
        to: [model('Item', [id, { name: 'size', type: 'ENUM', parameters: { values: ['S', 'M', 'L'] }, targets: { postgresql: { enumType: 'size' } } }])],
        seed: ["INSERT INTO item VALUES (1, 'M')"],
        check: async ({ db, rows }) => {
            await db.query("INSERT INTO item VALUES (2, 'L'), (3, 'S')");
            expect(await rows('SELECT size FROM item ORDER BY size')).toEqual([{ size: 'S' }, { size: 'M' }, { size: 'L' }]);
        },
    },
    'creates a native enum type in the schema of a table': {
        from: [model('Item', [id, { name: 'size', type: 'TEXT' }], { metadata: { schema: 'shop' } })],
        to: [model('Item', [id, { name: 'size', type: 'ENUM', parameters: { values: ['S', 'M'] }, targets: { postgresql: { enumType: 'size' } } }], { metadata: { schema: 'shop' } })],
        check: async ({ rows }) => {
            expect(await rows(`SELECT typnamespace::regnamespace::text AS schema FROM pg_type WHERE typname = 'size'`)).toEqual([{ schema: 'shop' }]);
        },
    },
    'adds an identity to a column': {
        from: [model('Item', [{ name: 'n', type: 'INT64' }])],
        to: [model('Item', [{ name: 'n', type: 'INT64', constraints: { identity: 'always' } }])],
        check: async ({ db, rows }) => {
            await db.query('INSERT INTO item DEFAULT VALUES');
            expect(await rows('SELECT n FROM item')).toEqual([{ n: '1' }]);
        },
    },
    'changes how an identity is generated': {
        from: [model('Item', [{ name: 'n', type: 'INT64', constraints: { identity: 'always' } }])],
        to: [model('Item', [{ name: 'n', type: 'INT64', constraints: { identity: 'byDefault' } }])],
        check: async ({ db, rows }) => {
            await db.query('INSERT INTO item VALUES (42)');
            expect(await rows('SELECT n FROM item')).toEqual([{ n: '42' }]);
        },
    },
    'replaces an identity with a default': {
        from: [model('Item', [{ name: 'n', type: 'INT64', constraints: { identity: 'byDefault' } }])],
        to: [model('Item', [{ name: 'n', type: 'INT64', constraints: { default: { value: 0 } } }])],
        seed: ['INSERT INTO item DEFAULT VALUES'],
        check: async ({ db, rows }) => {
            await db.query('INSERT INTO item DEFAULT VALUES');
            expect(await rows('SELECT n FROM item ORDER BY n')).toEqual([{ n: '0' }, { n: '1' }]);
        },
    },
    'moves the primary key and changes unique constraints': {
        from: [model('Item', [
            { name: 'id', type: 'INT32', constraints: { primaryKey: true } },
            { name: 'code', type: 'TEXT', constraints: { unique: true, nullable: false } },
        ])],
        to: [model('Item', [
            { name: 'id', type: 'INT32', constraints: { unique: true } },
            { name: 'code', type: 'TEXT', constraints: { primaryKey: true } },
        ])],
        seed: ["INSERT INTO item VALUES (1, 'a'), (2, 'b')"],
        check: async ({ db }) => {
            await db.query("INSERT INTO item VALUES (NULL, 'c')");
            await expect(db.query("INSERT INTO item VALUES (1, 'd')")).rejects.toThrow(/item_id_key/);
            await expect(db.query("INSERT INTO item VALUES (5, 'a')")).rejects.toThrow(/item_pkey/);
        },
    },
    'adds, removes and changes foreign keys': {
        from: [
            model('Parent', [{ name: 'id', type: 'INT64', constraints: { primaryKey: true } }]),
            model('Child', [
                id,
                { name: 'parentId', type: 'INT32' },
                { name: 'otherId', type: 'INT64', constraints: { foreignKey: { ref: 'Parent', field: 'id', onDelete: 'cascade' } } },
                { name: 'lastId', type: 'INT64', constraints: { foreignKey: { ref: 'Parent', field: 'id' } } },
            ]),
        ],
        to: [
            model('Parent', [{ name: 'id', type: 'INT64', constraints: { primaryKey: true } }]),
            model('Child', [
                id,
                { name: 'parentId', type: 'INT64', constraints: { foreignKey: { ref: 'Parent', field: 'id' } } },
                { name: 'otherId', type: 'INT64', constraints: { foreignKey: { ref: 'Parent', field: 'id', onDelete: 'setNull' } } },
                { name: 'lastId', type: 'INT64' },
            ]),
        ],
        seed: ['INSERT INTO parent VALUES (1), (2)', 'INSERT INTO child VALUES (1, 1, 2, 2)'],
        check: async ({ db, rows }) => {
            await expect(db.query('INSERT INTO child VALUES (2, 9, NULL, NULL)')).rejects.toThrow(/child_parent_id_fkey/);
            await db.query('INSERT INTO child VALUES (3, NULL, NULL, 99)');
            await db.query('DELETE FROM parent WHERE id = 2');
            expect(await rows('SELECT id, other_id FROM child ORDER BY id')).toEqual([{ id: 1, other_id: null }, { id: 3, other_id: null }]);
        },
    },
    'makes columns required and optional': {
        from: [model('Item', [id, { name: 'a', type: 'TEXT' }, { name: 'b', type: 'TEXT', constraints: { nullable: false } }])],
        to: [model('Item', [id, { name: 'a', type: 'TEXT', constraints: { nullable: false } }, { name: 'b', type: 'TEXT' }])],
        seed: ["INSERT INTO item VALUES (1, 'x', 'y')"],
        check: async ({ db }) => {
            await db.query("INSERT INTO item VALUES (2, 'x', NULL)");
            await expect(db.query('INSERT INTO item VALUES (3, NULL, NULL)')).rejects.toThrow(/null value/);
        },
    },
    'changes and removes comments': {
        from: [model('Item', [id, { name: 'a', type: 'TEXT', description: 'Old' }, { name: 'b', type: 'TEXT', description: 'Gone' }], { metadata: { description: 'Things' } })],
        to: [model('Item', [id, { name: 'a', type: 'TEXT', description: "It's new" }, { name: 'b', type: 'TEXT' }])],
        check: async ({ rows }) => {
            expect(await rows(`SELECT obj_description('item'::regclass) AS t, col_description('item'::regclass, 2) AS a, col_description('item'::regclass, 3) AS b`))
                .toEqual([{ t: null, a: "It's new", b: null }]);
        },
    },
    'moves tables between schemas': {
        from: [model('A', [id]), model('B', [id], { metadata: { schema: 'old' } })],
        to: [model('A', [id], { metadata: { schema: 'new' } }), model('B', [id])],
        seed: ['INSERT INTO a VALUES (1)', 'INSERT INTO old.b VALUES (2)'],
        check: async ({ rows }) => {
            expect(await rows('SELECT id FROM new.a')).toEqual([{ id: 1 }]);
            expect(await rows('SELECT id FROM public.b')).toEqual([{ id: 2 }]);
        },
    },
    'changes table constraints and indexes': {
        from: [model('Item', [id, { name: 'a', type: 'INT32' }, { name: 'b', type: 'INT32' }, { name: 'c', type: 'BOOLEAN' }], {
            constraints: [{ name: 'item_order', type: 'check', rule: { field: 'a', op: '<', otherField: 'b' } }],
            indexes: [{ name: 'item_a', fields: ['a'] }, { name: 'item_b', fields: ['b'], targets: { postgresql: { method: 'hash' } } }],
        })],
        to: [model('Item', [id, { name: 'a', type: 'INT32' }, { name: 'b', type: 'INT32' }, { name: 'c', type: 'BOOLEAN' }], {
            constraints: [
                { name: 'item_order', type: 'check', rule: { field: 'a', op: '<=', otherField: 'b' } },
                { name: 'item_pair', type: 'unique', fields: ['a', 'b'] },
            ],
            indexes: [{ name: 'item_b', fields: ['b'], where: { field: 'c', op: '=', value: true } }],
        })],
        seed: ['INSERT INTO item VALUES (1, 1, 2, true)'],
        check: async ({ db }) => {
            await db.query('INSERT INTO item VALUES (2, 3, 3, false)');
            await expect(db.query('INSERT INTO item VALUES (3, 1, 2, false)')).rejects.toThrow(/item_pair/);
        },
    },
    'adds required columns with defaults, and foreign keys, to tables with rows': {
        from: [model('Parent', [id]), model('Item', [id])],
        to: [model('Parent', [id]), model('Item', [
            id,
            { name: 'qty', type: 'INT32', constraints: { nullable: false, default: { value: 0 } } },
            { name: 'parentId', type: 'INT32', description: 'Owner', constraints: { foreignKey: { ref: 'Parent', field: 'id' } } },
        ])],
        seed: ['INSERT INTO parent VALUES (1)', 'INSERT INTO item VALUES (1)'],
        check: async ({ db, rows }) => {
            expect(await rows('SELECT qty, parent_id FROM item')).toEqual([{ qty: 0, parent_id: null }]);
            await expect(db.query('INSERT INTO item VALUES (2, 1, 5)')).rejects.toThrow(/item_parent_id_fkey/);
        },
    },
    'changes defaults to functions and removes them': {
        from: [model('Item', [id, { name: 'at', type: 'TIMESTAMP_TZ' }, { name: 'day', type: 'DATE', constraints: { default: { function: 'currentDate' } } }])],
        to: [model('Item', [id, { name: 'at', type: 'TIMESTAMP_TZ', constraints: { default: { function: 'now' } } }, { name: 'day', type: 'DATE' }])],
        check: async ({ db, rows }) => {
            await db.query('INSERT INTO item (id) VALUES (1)');
            expect(await rows('SELECT at IS NOT NULL AS at, day FROM item')).toEqual([{ at: true, day: null }]);
        },
    },
    'in careful mode backs up a key column with a foreign key and a unique constraint': {
        careful: true,
        from: [
            model('Parent', [id]),
            model('Item', [
                { name: 'n', type: 'INT64', constraints: { primaryKey: true, identity: 'always' } },
                { name: 'parentId', type: 'INT32', constraints: { unique: true, nullable: false, foreignKey: { ref: 'Parent', field: 'id' } } },
                { name: 'name', type: 'TEXT' },
            ]),
        ],
        to: [model('Item', [{ name: 'name', type: 'TEXT' }])],
        seed: ['INSERT INTO parent VALUES (1)', "INSERT INTO item (parent_id, name) VALUES (1, 'a')"],
        check: async ({ db, rows }, plan) => {
            expect(plan.backups.map(b => b.backup)).toEqual(['_bk_20261031120000_n', '_bk_20261031120000_parent_id', '_bk_20261031120000_parent']);
            // Rows without the backed-up columns can be written, and the backed-up table can go
            await db.query("INSERT INTO item (name) VALUES ('b')");
            await db.query('DROP TABLE _bk_20261031120000_parent');
            expect(await rows('SELECT name, _bk_20261031120000_n AS n, _bk_20261031120000_parent_id AS parent_id FROM item ORDER BY name'))
                .toEqual([{ name: 'a', n: '1', parent_id: 1 }, { name: 'b', n: null, parent_id: null }]);
        },
    },
    'in careful mode frees the index names of a backed-up table for a new one': {
        careful: true,
        from: [model('Log', [
            { name: 'id', type: 'INT32', constraints: { primaryKey: true } },
            { name: 'code', type: 'TEXT', constraints: { unique: true } },
            { name: 'at', type: 'DATE' },
        ], { metadata: { schema: 'audit' }, indexes: [{ name: 'shared_at', fields: ['at'] }] })],
        to: [model('Journal', [
            { name: 'id', type: 'INT32', constraints: { primaryKey: true } },
            { name: 'at', type: 'DATE' },
        ], { metadata: { schema: 'audit' }, indexes: [{ name: 'shared_at', fields: ['at'] }] })],
        seed: ["INSERT INTO audit.log VALUES (1, 'x', '2026-01-01')"],
        check: async ({ rows }) => {
            expect(await rows('SELECT code FROM audit._bk_20261031120000_log')).toEqual([{ code: 'x' }]);
            expect(await rows(`SELECT indexname FROM pg_indexes WHERE schemaname = 'audit' ORDER BY indexname`)).toEqual([
                { indexname: '_bk_20261031120000_log_code_key' },
                { indexname: '_bk_20261031120000_log_pkey' },
                { indexname: '_bk_20261031120000_shared_at' },
                { indexname: 'journal_pkey' },
                { indexname: 'shared_at' },
            ]);
        },
    },
    'without careful mode drops tables that reference each other': {
        from: [
            model('A', [id, { name: 'bId', type: 'INT32', constraints: { foreignKey: { ref: 'B', field: 'id' } } }]),
            model('B', [id, { name: 'aId', type: 'INT32', constraints: { foreignKey: { ref: 'A', field: 'id' } } }]),
            model('C', [id]),
        ],
        to: [model('C', [id])],
        seed: ['INSERT INTO a VALUES (1, NULL)', 'INSERT INTO b VALUES (1, 1)', 'UPDATE a SET b_id = 1'],
        check: async ({ rows }) => {
            expect(await rows(`SELECT to_regclass('a') AS a, to_regclass('b') AS b`)).toEqual([{ a: null, b: null }]);
        },
    },
};

describe.skipIf(adminUrl === undefined)('Migration scenarios on PostgreSQL', () => {
    const options = { backupPrefix: '_bk_', now: new Date('2026-10-31T12:00:00Z') };
    let number = 0;

    it.each(Object.entries(scenarios))('%s', async (_, scenario) => {
        const test = await createDatabase(`migration_scenario_${process.pid}_${number++}`);
        try {
            await new Migration(options).migrate(test.dump(), models(scenario.from), test.db);
            for (const sql of scenario.seed ?? []) await test.db.query(sql);

            const migration = new Migration({ ...options, careful: scenario.careful });
            const plan = await migration.migrate(test.dump(), models(scenario.to), test.db);
            expect(plan.statements.length).toBeGreaterThan(0);

            const again = await migration.plan(test.dump(), models(scenario.to));
            expect(again.statements).toEqual([]);
            await scenario.check?.(test, plan);
        } finally {
            await test.drop();
        }
    });
});
