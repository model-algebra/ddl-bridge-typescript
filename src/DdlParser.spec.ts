import { Model, ModelSet } from 'model-algebra-common';
import { toModelData } from 'model-algebra-typescript';
import { DdlBridge } from './DdlBridge';
import { DdlSetBridge } from './DdlSetBridge';
import { loadDdlParser, parseDdl } from './DdlParser';
import { eventModels, readFixture, shopModels } from './test/models';

const data = (models: ModelSet) => models.models.map(model => toModelData(model));
const field = (models: ModelSet, model: string, name: string) =>
    toModelData(models.get(model)!).fields.find(f => f.name === name)!;

beforeAll(loadDdlParser);

describe('parseDdl', () => {
    const bridge = new DdlSetBridge();

    // The fixtures are pg_dump --schema-only of databases created from DdlBridge's DDL of the same models
    describe.each([
        ['shop', shopModels],
        ['events', eventModels],
    ])('%s models', (name, models) => {
        it('read from pg_dump output and from DdlBridge DDL are the same', () => {
            const dumped = parseDdl(readFixture(`${name}.pg_dump.sql`));
            const generated = parseDdl(bridge.toTarget(models()));
            expect(data(dumped.models)).toEqual(data(generated.models));
            expect(dumped.catalog).toEqual(generated.catalog);
            expect(dumped.warnings).toEqual([]);
        });

        it('give the same models again when converted to DDL and read back', () => {
            const read = bridge.toModel(readFixture(`${name}.pg_dump.sql`));
            expect(data(bridge.toModel(bridge.toTarget(read)))).toEqual(data(read));
        });
    });

    it('reads tables with model names and canonical types', () => {
        const models = bridge.toModel(readFixture('events.pg_dump.sql'));
        expect(models.names).toEqual(['Event', 'Person', 'Ticket', 'Venue']);
        const event = toModelData(models.get('Event')!);
        expect(event.metadata).toEqual({ name: 'Event', schema: 'events' });
        expect(Object.fromEntries(event.fields.map(f => [f.name, [f.type, f.parameters]]))).toEqual({
            id: ['INT64', undefined],
            venueId: ['INT32', undefined],
            title: ['STRING', { length: 200 }],
            code: ['STRING', { length: 3 }],
            status: ['ENUM', { values: ['DRAFT', 'PUBLISHED'] }],
            kind: ['TEXT', undefined],
            price: ['DECIMAL', { precision: 8, scale: 2 }],
            startsAt: ['TIMESTAMP_TZ', { precision: 3 }],
            endsAt: ['TIMESTAMP_TZ', undefined],
            duration: ['DURATION', undefined],
            doors: ['TIME', { precision: 0 }],
            day: ['DATE', undefined],
            token: ['UUID', undefined],
            flags: ['ARRAY', { items: { type: 'TEXT' } }],
            online: ['BOOLEAN', undefined],
            rating: ['FLOAT64', undefined],
            small: ['INT16', undefined],
            real: ['FLOAT32', undefined],
            data: ['BYTES', undefined],
            ip: ['TEXT', undefined],
            notes: ['TEXT', undefined],
        });
        expect(field(models, 'Event', 'status').targets).toEqual({ postgresql: { enumType: 'event_status' } });
        expect(field(models, 'Event', 'ip').targets).toEqual({ postgresql: { type: 'inet' } });
        expect(field(models, 'Event', 'notes').description).toBe("Organizer's notes");
        expect(toModelData(models.get('Venue')!).metadata.description).toBe('Places events happen at');
    });

    it('reads field constraints from constraints PostgreSQL named itself', () => {
        const models = bridge.toModel(readFixture('events.pg_dump.sql'));
        const constraints = (model: string, name: string) => field(models, model, name).constraints;
        expect(constraints('Event', 'id')).toEqual({ primaryKey: true, identity: 'always', nullable: false });
        expect(constraints('Venue', 'id')).toEqual({ primaryKey: true, identity: 'byDefault', nullable: false });
        expect(constraints('Event', 'venueId')).toEqual({ nullable: false, foreignKey: { ref: 'Venue', field: 'id', onDelete: 'cascade' } });
        expect(constraints('Event', 'code')).toEqual({ regex: '^[A-Z]{3}$' });
        expect(constraints('Event', 'kind')).toEqual({ enum: ['talk', 'concert'] });
        expect(constraints('Event', 'flags')).toEqual({ enum: ['a', 'b'] });
        expect(constraints('Event', 'rating')).toEqual({ min: -1.5, max: 5 });
        expect(constraints('Event', 'token')).toEqual({ default: { function: 'uuid' }, unique: true });
        expect(constraints('Venue', 'capacity')).toEqual({ default: { value: 100 }, min: 1, max: 100000 });
        expect(constraints('Venue', 'tags')).toEqual({ default: { value: ['indoor'] } });
        expect(constraints('Venue', 'location')).toEqual({ default: { value: { lat: 0, lng: 0 } } });
        expect(constraints('Event', 'startsAt')).toEqual({ default: { function: 'now' } });
        expect(constraints('Event', 'day')).toEqual({ default: { function: 'currentDate' } });
        expect(constraints('Ticket', 'eventId')).toEqual({ nullable: false, foreignKey: { ref: 'Event', field: 'id', onUpdate: 'restrict' } });
    });

    it('keeps constraints with names of their own as table constraints, and reads indexes', () => {
        const event = toModelData(bridge.toModel(readFixture('events.pg_dump.sql')).get('Event')!);
        expect(event.constraints).toEqual([
            { name: 'event_dates', type: 'check', rule: { field: 'endsAt', op: '>=', otherField: 'startsAt' } },
            { name: 'event_not_free', type: 'check', rule: { field: 'price', op: '!=', value: 13 } },
            { name: 'event_venue_title', type: 'unique', fields: ['venueId', 'title'] },
        ]);
        expect(event.indexes).toEqual([
            { name: 'event_online_venue', fields: ['venueId', 'day'], where: { field: 'online', op: '=', value: true } },
            { name: 'event_starts', fields: ['startsAt'] },
            { name: 'event_title_hash', fields: ['title'], targets: { postgresql: { method: 'hash' } } },
        ]);
    });

    it('lists the names of the constraints behind field constraints', () => {
        const { catalog } = parseDdl(readFixture('events.pg_dump.sql'));
        expect(catalog.enumTypes).toEqual({ 'events.event_status': ['DRAFT', 'PUBLISHED'] });
        expect(catalog.tables.Event.table).toBe('events.event');
        expect(catalog.tables.Event.primaryKey).toBe('event_pkey');
        expect(catalog.tables.Event.columns.rating).toEqual({ checks: ['event_rating_check'] });
        expect(catalog.tables.Event.columns.token).toEqual({ checks: [], unique: 'event_token_key' });
        expect(catalog.tables.Event.columns.venueId).toEqual({ checks: [], foreignKey: 'event_venue_id_fkey' });
        expect(catalog.tables.Ticket.primaryKey).toBeUndefined();
    });

    it('names constraints created without a name as PostgreSQL does', () => {
        const { catalog } = parseDdl(`CREATE TABLE t (a INTEGER CHECK (a > 0) CHECK (a < 9) UNIQUE, b TEXT);
            ALTER TABLE t ADD CHECK (a <> 5);`);
        expect(catalog.tables.T.columns.a).toEqual({ checks: [], unique: 't_a_key' });
        const t = toModelData(parseDdl(`CREATE TABLE t (a INTEGER CHECK (a > 0) CHECK (a < 9));`).models.get('T')!);
        expect(t.constraints?.map(c => c.name)).toEqual(['t_a_check', 't_a_check1']);
    });

    it('accepts hand-written DDL', () => {
        const models = parseDdl(`
            CREATE TABLE customer (id serial4 PRIMARY KEY);
        `.replace('serial4', 'integer GENERATED BY DEFAULT AS IDENTITY')).models;
        expect(toModelData(models.get('Customer')!).fields[0].constraints).toEqual({ identity: 'byDefault', primaryKey: true, nullable: false });
    });

    it('leaves out backups: tables and columns with the skip prefix, and what uses them', () => {
        const { models, catalog, warnings } = parseDdl(`
            CREATE TABLE _bk_1_person (id integer PRIMARY KEY);
            CREATE TABLE ticket (
                seat text,
                _bk_1_holder integer UNIQUE REFERENCES ticket(seat),
                owner_id integer CONSTRAINT owner REFERENCES _bk_1_person(id),
                CONSTRAINT seat_holder UNIQUE (seat, _bk_1_holder),
                CONSTRAINT holder_check CHECK (_bk_1_holder > 0)
            );
            ALTER TABLE ticket ALTER COLUMN _bk_1_holder SET NOT NULL;
            CREATE INDEX holder_idx ON ticket (_bk_1_holder);
            CREATE INDEX person_idx ON _bk_1_person (id);
            COMMENT ON COLUMN ticket._bk_1_holder IS 'Old';
            COMMENT ON TABLE _bk_1_person IS 'Old';
        `, { skipPrefix: '_bk_' });
        expect(models.models.map(m => toModelData(m))).toEqual([
            { metadata: { name: 'Ticket' }, fields: [{ name: 'seat', type: 'TEXT' }, { name: 'ownerId', type: 'INT32' }] },
        ]);
        expect(catalog.tables.Ticket.columns).toEqual({});
        expect(warnings).toEqual(['Skipped foreign key owner of table ticket: it references left-out table _bk_1_person']);
    });

    it('skips statements that do not define tables, with warnings', () => {
        const { models, warnings } = parseDdl(`
            SET statement_timeout = 0;
            CREATE TABLE a (id INTEGER);
            CREATE FUNCTION f() RETURNS integer LANGUAGE sql AS 'SELECT 1';
            CREATE VIEW v AS SELECT * FROM a;
        `);
        expect(models.names).toEqual(['A']);
        expect(warnings).toEqual(['Skipped CreateFunctionStmt', 'Skipped ViewStmt']);
    });

    it.each([
        ['expression indexes', 'CREATE TABLE a (b TEXT); CREATE INDEX i ON a (lower(b));', 'only plain columns'],
        ['multi-column foreign keys', 'CREATE TABLE a (b INTEGER, c INTEGER, UNIQUE (b, c)); CREATE TABLE d (b INTEGER, c INTEGER, FOREIGN KEY (b, c) REFERENCES a (b, c));', 'single-column foreign keys'],
        ['sequence defaults', "CREATE TABLE a (id INTEGER DEFAULT nextval('s'::regclass));", 'only constants'],
        ['names that do not round trip', 'CREATE TABLE "UserTable" (id INTEGER);', 'cannot be represented'],
        ['constraint names that do not round trip', 'CREATE TABLE a (id INTEGER, CONSTRAINT "Positive" CHECK (id > 0));', 'cannot be represented'],
        ['checks that are not comparisons', 'CREATE TABLE a (b TEXT, CONSTRAINT x CHECK (length(b) > 3));', 'only comparisons'],
        ['invalid SQL', 'CREATE TABLE (', 'Cannot parse DDL'],
    ])('rejects %s', (_, ddl, message) => {
        expect(() => parseDdl(ddl)).toThrow(message);
    });
});

describe('DdlBridge.toModel', () => {
    it('reads the model of one table', () => {
        const bridge = new DdlBridge();
        const model = bridge.toModel(`CREATE TABLE user_profile (first_name TEXT NOT NULL); COMMENT ON TABLE user_profile IS 'Profiles';`);
        expect(toModelData(model)).toEqual({
            metadata: { name: 'UserProfile', description: 'Profiles' },
            fields: [{ name: 'firstName', type: 'TEXT', constraints: { nullable: false } }],
        });
    });

    it('refuses DDL of several tables', () => {
        expect(() => new DdlBridge().toModel('CREATE TABLE a (id INTEGER); CREATE TABLE b (id INTEGER);'))
            .toThrow('exactly one table, found 2');
    });
});

describe('DdlBridge.toTarget', () => {
    it('reads constraints of models built with Model.fromJSON', () => {
        const json = { metadata: { name: 'A', version: '1' }, fields: [{ name: 'id', type: 'INT32', constraints: { primaryKey: true } }] };
        expect(new DdlBridge().toTarget(Model.fromJSON(json))).toBe(new DdlBridge().toTarget(new Model(json)));
        expect(new DdlBridge().toTarget(Model.fromJSON(json))).toContain('PRIMARY KEY');
    });
});

describe('parseDdl of hand-written DDL', () => {
    const model = (ddl: string, name: string, options = {}) => toModelData(parseDdl(ddl, options).models.get(name)!);

    it('reads types and defaults written in other ways', () => {
        const t = model(`
            CREATE TABLE t (
                a integer NULL,
                b text DEFAULT now(),
                c numeric(10),
                d varchar,
                e interval(3),
                f boolean DEFAULT 't',
                g integer DEFAULT '5',
                h integer DEFAULT -(5),
                i text[] DEFAULT '{a,"b c","d\\"e"}',
                j integer[] DEFAULT '{1, 2}',
                k character(2),
                l time with time zone,
                m json DEFAULT '[1]',
                n bit varying(8)
            );`, 'T');
        expect(t.fields).toEqual([
            { name: 'a', type: 'INT32' },
            { name: 'b', type: 'TEXT', constraints: { default: { function: 'now' } } },
            { name: 'c', type: 'DECIMAL', parameters: { precision: 10, scale: 0 } },
            { name: 'd', type: 'TEXT', targets: { postgresql: { type: 'varchar' } } },
            { name: 'e', type: 'DURATION', parameters: { precision: 3 } },
            { name: 'f', type: 'BOOLEAN', constraints: { default: { value: true } } },
            { name: 'g', type: 'INT32', constraints: { default: { value: 5 } } },
            { name: 'h', type: 'INT32', constraints: { default: { value: -5 } } },
            { name: 'i', type: 'ARRAY', parameters: { items: { type: 'TEXT' } }, constraints: { default: { value: ['a', 'b c', 'd"e'] } } },
            { name: 'j', type: 'ARRAY', parameters: { items: { type: 'INT32' } }, constraints: { default: { value: [1, 2] } } },
            { name: 'k', type: 'TEXT', targets: { postgresql: { type: 'bpchar(2)' } } },
            { name: 'l', type: 'TEXT', targets: { postgresql: { type: 'timetz' } } },
            { name: 'm', type: 'JSON', targets: { postgresql: { type: 'json' } }, constraints: { default: { value: [1] } } },
            { name: 'n', type: 'TEXT', targets: { postgresql: { type: 'varbit(8)' } } },
        ]);
    });

    it('reads negated quoted numbers', () => {
        const t = model(`CREATE TABLE t (a integer DEFAULT -'5', b numeric CHECK (b >= -'1.5'));`, 'T');
        expect(t.fields.map(f => f.constraints)).toEqual([{ default: { value: -5 } }, { min: -1.5 }]);
    });

    it.each([
        ['bit strings', "CREATE TABLE t (a bit(3) DEFAULT B'101');"],
        ['negated expressions', 'CREATE TABLE t (a integer DEFAULT -abs(1));'],
    ])('rejects defaults of %s', (_, ddl) => {
        expect(() => parseDdl(ddl)).toThrow('only constants');
    });

    it('reads constraints added and changed by ALTER TABLE, and ignores what does not change the model', () => {
        const t = model(`
            CREATE TABLE t (a integer, b text);
            ALTER TABLE t ALTER COLUMN a SET NOT NULL, ALTER COLUMN b SET DEFAULT 'x';
            ALTER TABLE t ALTER COLUMN b DROP DEFAULT;
            ALTER TABLE t ADD CONSTRAINT t_a_key UNIQUE (a);
            ALTER TABLE t OWNER TO someone;
            ALTER INDEX t_a_key SET (fillfactor = 50);
            ALTER SEQUENCE IF EXISTS s OWNED BY NONE;
            COMMENT ON SCHEMA public IS 'Standard public schema';
            CREATE EXTENSION IF NOT EXISTS citext;
        `, 'T');
        expect(t.fields).toEqual([
            { name: 'a', type: 'INT32', constraints: { nullable: false, unique: true } },
            { name: 'b', type: 'TEXT', constraints: { default: { value: 'x' } } },
        ]);
    });

    it('reads a foreign key without columns as one to the primary key', () => {
        const models = parseDdl(`
            CREATE TABLE a (id integer PRIMARY KEY);
            CREATE TABLE b (code text, CONSTRAINT b_key PRIMARY KEY (code));
            CREATE TABLE c (a_id integer REFERENCES a, b_code text REFERENCES b);
        `).models;
        expect(toModelData(models.get('C')!).fields.map(f => f.constraints?.foreignKey)).toEqual([
            { ref: 'A', field: 'id' },
            { ref: 'B', field: 'code' },
        ]);
    });

    it('reads native enum types of another schema as a type override', () => {
        const t = model(`CREATE TYPE other.mood AS ENUM ('ok'); CREATE TABLE t (m other.mood);`, 'T');
        expect(t.fields[0]).toEqual({ name: 'm', type: 'TEXT', targets: { postgresql: { type: 'other.mood' } } });
    });

    it('reads tables of the default schema it is told', () => {
        const t = model(`CREATE TABLE app.t (a integer); CREATE TABLE public.u (b integer);`, 'T', { defaultSchema: 'app' });
        expect(t.metadata).toEqual({ name: 'T' });
        expect(model(`CREATE TABLE public.u (b integer);`, 'U', { defaultSchema: 'app' }).metadata).toEqual({ name: 'U', schema: 'public' });
    });

    it('accepts DDL without tables', () => {
        expect(parseDdl('').models.size).toBe(0);
        expect(parseDdl('-- nothing here\n').models.size).toBe(0);
    });

    it.each([
        ['inherited tables', 'CREATE TABLE a (id integer); CREATE TABLE b () INHERITS (a);', 'Inherited, partitioned and typed tables'],
        ['partitioned tables', 'CREATE TABLE a (id integer) PARTITION BY RANGE (id);', 'Inherited, partitioned and typed tables'],
        ['LIKE in tables', 'CREATE TABLE a (id integer); CREATE TABLE b (LIKE a);', 'Unsupported element TableLikeClause'],
        ['generated columns', 'CREATE TABLE a (b integer, c integer GENERATED ALWAYS AS (b * 2) STORED);', 'Generated column c'],
        ['multidimensional arrays', 'CREATE TABLE a (b integer[][]);', 'Multidimensional array columns'],
        ['intervals of some fields', 'CREATE TABLE a (b interval year to month);', 'Interval columns limited to some fields'],
        ['exclusion constraints', 'CREATE TABLE a (b integer, EXCLUDE USING gist (b WITH =));', 'Unsupported constraint CONSTR_EXCLUSION'],
        ['unknown columns in constraints', 'CREATE TABLE a (b integer, UNIQUE (c));', 'Unknown column c of table a'],
        ['unknown columns in ALTER TABLE', 'CREATE TABLE a (b integer); ALTER TABLE a ALTER COLUMN c SET NOT NULL;', 'Unknown column c of table a'],
        ['other ALTER TABLE commands', 'CREATE TABLE a (b integer); ALTER TABLE a ADD COLUMN c integer;', 'Unsupported ALTER TABLE command AT_AddColumn'],
        ['tables used before they are created', 'ALTER TABLE a ADD CONSTRAINT x UNIQUE (b);', 'Table a is used before it is created'],
        ['tables that become the same model', 'CREATE TABLE s1.a (b integer); CREATE TABLE s2.a (b integer);', 'Tables s1.a and s2.a both become model A'],
        ['foreign keys to tables without a primary key', 'CREATE TABLE a (b integer); CREATE TABLE c (d integer REFERENCES a);', 'Cannot find the key'],
        ['indexes without a name', 'CREATE TABLE a (b integer); CREATE INDEX ON a (b);', 'Index without a name'],
        ['descending indexes', 'CREATE TABLE a (b integer); CREATE INDEX i ON a (b DESC);', 'only plain columns'],
        ['indexes with operator classes', 'CREATE TABLE a (b text); CREATE INDEX i ON a (b text_pattern_ops);', 'only plain columns'],
        ['indexes with INCLUDE', 'CREATE TABLE a (b integer, c integer); CREATE INDEX i ON a (b) INCLUDE (c);', 'INCLUDE columns'],
        ['checks comparing with null', 'CREATE TABLE a (b integer, CONSTRAINT x CHECK (b = NULL));', 'compared with a constant or another column'],
        ['checks comparing with functions', 'CREATE TABLE a (b timestamp, CONSTRAINT x CHECK (b < now()));', 'compared with a constant or another column'],
        ['checks of allowed numbers', 'CREATE TABLE a (b integer CHECK (b IN (1, 2)));', 'only comparisons'],
        ['checks of two columns at once', 'CREATE TABLE a (b integer, c integer, CHECK (b > 0 AND c > 0));', 'only comparisons'],
        ['array defaults that are not arrays', "CREATE TABLE a (b text[] DEFAULT 'x');", 'Unsupported default of b in table a: x'],
        ['number defaults that are not numbers', "CREATE TABLE a (b integer DEFAULT 'x');", 'x is not a number'],
        ['defaults calling other functions', 'CREATE TABLE a (b text DEFAULT upper(\'x\'));', 'only constants'],
    ])('rejects %s', (_, ddl, message) => {
        expect(() => parseDdl(ddl)).toThrow(message);
    });
});

describe('the DDL parser', () => {
    afterEach(() => {
        vi.doUnmock('libpg-query');
        vi.resetModules();
    });

    const withParser = async (parseSync: () => unknown) => {
        vi.resetModules();
        vi.doMock('libpg-query', () => ({ loadModule: async () => undefined, parseSync }));
        return import('./DdlParser');
    };

    it('must be loaded before DDL is read synchronously', async () => {
        const fresh = await withParser(() => { throw new Error('WASM module not initialized. Call loadModule() first.'); });
        expect(() => fresh.parseDdl('CREATE TABLE a (b integer);')).toThrow('The DDL parser is not loaded; await loadDdlParser() first');
    });

    it('reports errors that are not Error objects', async () => {
        const fresh = await withParser(() => { throw 'out of memory'; });
        expect(() => fresh.parseDdl('CREATE TABLE a (b integer);')).toThrow('Cannot parse DDL: out of memory');
    });

    it('accepts a parse result without statements', async () => {
        const fresh = await withParser(() => ({ version: 180004 }));
        expect(fresh.parseDdl('').models.size).toBe(0);
    });
});
