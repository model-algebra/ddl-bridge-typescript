import { Model, ModelSet } from 'model-algebra-common';
import { Migration } from './Migration';
import { eventsJson, eventModels, readFixture, shopModels } from './test/models';

const models = (...json: any[]) => new ModelSet(json.map(model => new Model(structuredClone(model))));
const migration = (careful = false) => new Migration({ careful, backupPrefix: '_old_', now: new Date('2026-10-31T12:00:00Z') });

const user = {
    metadata: { name: 'User', version: '1' },
    fields: [
        { name: 'id', type: 'INT64', constraints: { primaryKey: true, identity: 'always' } },
        { name: 'email', type: 'STRING', parameters: { length: 100 }, constraints: { nullable: false, unique: true } },
        { name: 'age', type: 'INT16', constraints: { min: 0 } },
        { name: 'role', type: 'ENUM', parameters: { values: ['USER', 'ADMIN'] }, targets: { postgresql: { enumType: 'user_role' } } },
    ],
};

const userDdl = `
CREATE TYPE public.user_role AS ENUM ('USER', 'ADMIN');
CREATE TABLE public."user" (
    id bigint NOT NULL,
    email character varying(100) NOT NULL,
    age smallint,
    role public.user_role,
    CONSTRAINT user_age_check CHECK ((age >= 0))
);
ALTER TABLE public."user" ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME public.user_id_seq);
ALTER TABLE ONLY public."user" ADD CONSTRAINT user_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public."user" ADD CONSTRAINT user_email_uk UNIQUE (email);
`;

const changed = (change: (model: any) => void) => {
    const model = structuredClone(user);
    change(model);
    return models(model);
};

describe('Migration.plan', () => {
    it.each([
        ['shop', shopModels],
        ['events', eventModels],
    ])('has nothing to do when the %s database matches its models', async (name, desired) => {
        const plan = await migration().plan(readFixture(`${name}.pg_dump.sql`), desired());
        expect(plan.statements).toEqual([]);
        expect(plan.warnings).toEqual([]);
    });

    it('creates every table of an empty database, foreign keys last', async () => {
        const plan = await migration().plan('', eventModels());
        expect(plan.diff.added.map(m => m.metadata.name)).toEqual(['Event', 'Person', 'Ticket', 'Venue']);
        const creates = plan.statements.filter(s => s.startsWith('CREATE TABLE'));
        expect(creates).toHaveLength(4);
        expect(plan.statements.filter(s => s.includes('REFERENCES'))).toHaveLength(5);
        expect(plan.statements.findIndex(s => s.includes('REFERENCES')))
            .toBeGreaterThan(plan.statements.map(s => s.startsWith('CREATE TABLE')).lastIndexOf(true));
        expect(plan.statements).toContain(`CREATE TYPE events.event_status AS ENUM ('DRAFT', 'PUBLISHED');`);
    });

    it('drops removed tables and columns', async () => {
        const plan = await migration().plan(userDdl + 'CREATE TABLE public.log (id integer);', changed(m => m.fields.splice(2, 1)));
        expect(plan.statements).toEqual([
            `ALTER TABLE "user" DROP COLUMN age;`,
            `DROP TABLE log;`,
        ]);
    });

    it('in careful mode renames removed tables and columns, freeing their names', async () => {
        const ddl = userDdl + `CREATE TABLE public.log (id integer, CONSTRAINT log_id UNIQUE (id)); CREATE INDEX log_idx ON public.log (id);`;
        const plan = await migration(true).plan(ddl, changed(m => m.fields.splice(1, 1)));
        expect(plan.statements).toEqual([
            `ALTER TABLE "user" ALTER COLUMN email DROP NOT NULL;`,
            `ALTER TABLE "user" RENAME COLUMN email TO _old_20261031120000_email;`,
            `ALTER TABLE log RENAME TO _old_20261031120000_log;`,
            `ALTER INDEX log_idx RENAME TO _old_20261031120000_log_idx;`,
            `ALTER INDEX log_id RENAME TO _old_20261031120000_log_id;`,
        ]);
        expect(plan.backups).toEqual([
            { kind: 'column', model: 'User', field: 'email', table: '"user"', name: 'email', backup: '_old_20261031120000_email' },
            { kind: 'table', model: 'Log', table: '_old_20261031120000_log', name: 'log', backup: '_old_20261031120000_log' },
        ]);
    });

    it('in careful mode drops what would stop rows without a removed column from being written', async () => {
        const plan = await migration(true).plan(userDdl, changed(m => {
            m.fields.splice(0, 1);
            m.fields[0].constraints.primaryKey = true;
        }));
        expect(plan.statements).toEqual([
            `ALTER TABLE "user" DROP CONSTRAINT user_pkey;`,
            `ALTER TABLE "user" ALTER COLUMN id DROP IDENTITY;`,
            `ALTER TABLE "user" ALTER COLUMN id DROP NOT NULL;`,
            `ALTER TABLE "user" RENAME COLUMN id TO _old_20261031120000_id;`,
            `ALTER TABLE "user" ADD PRIMARY KEY (email);`,
        ]);
    });

    it('changes column types, defaults, nullability and checks', async () => {
        const plan = await migration().plan(userDdl, changed(m => {
            m.fields[1].parameters.length = 200;
            m.fields[1].constraints.nullable = true;
            m.fields[2].type = 'INT32';
            m.fields[2].constraints = { min: 1, max: 150, default: { value: 18 } };
        }));
        expect(plan.statements).toEqual([
            `ALTER TABLE "user" DROP CONSTRAINT user_age_check;`,
            `ALTER TABLE "user" ALTER COLUMN email TYPE VARCHAR(200) USING email::VARCHAR(200);`,
            `ALTER TABLE "user" ALTER COLUMN email DROP NOT NULL;`,
            `ALTER TABLE "user" ALTER COLUMN age TYPE INTEGER USING age::INTEGER;`,
            `ALTER TABLE "user" ALTER COLUMN age SET DEFAULT 18;`,
            `ALTER TABLE "user" ADD CHECK (age >= 1 AND age <= 150);`,
        ]);
    });

    it('drops and adds unique, primary key and foreign key constraints by their names in the database', async () => {
        const ddl = userDdl + `CREATE TABLE public.post (id integer, user_id bigint, CONSTRAINT post_author FOREIGN KEY (user_id) REFERENCES public."user"(id));`;
        const post = {
            metadata: { name: 'Post' },
            fields: [
                { name: 'id', type: 'INT32', constraints: { primaryKey: true } },
                { name: 'userId', type: 'INT64', constraints: { foreignKey: { ref: 'User', field: 'id', onDelete: 'cascade' } } },
            ],
        };
        const target = structuredClone(user);
        delete (target.fields[1].constraints as any).unique;
        const plan = await migration().plan(ddl, models(target, post));
        expect(plan.statements).toEqual([
            `ALTER TABLE post DROP CONSTRAINT post_author;`,
            `ALTER TABLE "user" DROP CONSTRAINT user_email_uk;`,
            `ALTER TABLE post ALTER COLUMN id SET NOT NULL;`,
            `ALTER TABLE post ADD PRIMARY KEY (id);`,
            `ALTER TABLE post ADD FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;`,
        ]);
    });

    it('adds values to native enum types', async () => {
        const plan = await migration().plan(userDdl, changed(m => { m.fields[3].parameters.values = ['GUEST', 'USER', 'ADMIN', 'OWNER']; }));
        expect(plan.statements).toEqual([
            `ALTER TYPE user_role ADD VALUE 'GUEST' BEFORE 'USER';`,
            `ALTER TYPE user_role ADD VALUE 'OWNER' AFTER 'ADMIN';`,
        ]);
    });

    it('refuses to remove values of native enum types', async () => {
        await expect(migration().plan(userDdl, changed(m => { m.fields[3].parameters.values = ['USER']; })))
            .rejects.toThrow('values can only be added');
    });

    it('changes table constraints, indexes, comments and schemas', async () => {
        const ddl = `CREATE TABLE public.item (a integer, b integer, CONSTRAINT item_order CHECK ((a < b)));
            CREATE INDEX item_a ON public.item (a); COMMENT ON TABLE public.item IS 'Items';`;
        const item = {
            metadata: { name: 'Item', schema: 'store', description: 'Store items' },
            fields: [{ name: 'a', type: 'INT32', description: 'First' }, { name: 'b', type: 'INT32' }],
            constraints: [{ name: 'item_order', type: 'check', rule: { field: 'a', op: '<=', otherField: 'b' } }],
            indexes: [{ name: 'item_b', fields: ['b'] }],
        };
        const plan = await migration().plan(ddl, models(item));
        expect(plan.statements).toEqual([
            `ALTER TABLE item DROP CONSTRAINT item_order;`,
            `DROP INDEX item_a;`,
            `CREATE SCHEMA IF NOT EXISTS store;`,
            `ALTER TABLE item SET SCHEMA store;`,
            `COMMENT ON TABLE store.item IS 'Store items';`,
            `ALTER TABLE store.item ADD CONSTRAINT item_order CHECK (a <= b);`,
            `CREATE INDEX item_b ON store.item (b);`,
            `COMMENT ON COLUMN store.item.a IS 'First';`,
        ]);
    });

    it('keeps the plan as data: the diff between what the database has and what it should have', async () => {
        const plan = await migration().plan(readFixture('events.pg_dump.sql'), models(...eventsJson.slice(0, 2)));
        expect(plan.diff.removed.map(m => m.metadata.name)).toEqual(['Person', 'Ticket']);
        expect(plan.actual.names).toEqual(['Event', 'Person', 'Ticket', 'Venue']);
        expect(plan.desired.names).toEqual(['Event', 'Venue']);
    });
});

describe('Migration.apply', () => {
    const plan = { statements: ['A', 'B', 'C'] } as any;

    it('runs the statements in one transaction', async () => {
        const run: string[] = [];
        await migration().apply(plan, { query: async sql => { run.push(sql); } });
        expect(run).toEqual(['BEGIN', 'A', 'B', 'C', 'COMMIT']);
    });

    it('rolls back when a statement fails', async () => {
        const run: string[] = [];
        const db = { query: async (sql: string) => { run.push(sql); if (sql === 'B') throw new Error('boom'); } };
        await expect(migration().apply(plan, db)).rejects.toThrow('Migration failed at statement 2, nothing was changed: B\nboom');
        expect(run).toEqual(['BEGIN', 'A', 'B', 'ROLLBACK']);
    });

    it('does nothing for an empty plan', async () => {
        const run: string[] = [];
        await migration().apply({ statements: [] } as any, { query: async sql => { run.push(sql); } });
        expect(run).toEqual([]);
    });
});
