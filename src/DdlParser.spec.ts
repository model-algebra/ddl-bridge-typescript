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
