import { Model, ModelSet } from 'model-algebra-common';
import { Migration } from './Migration';
import { adminUrl, createDatabase, type TestDatabase } from './test/database';
import { eventsJson } from './test/models';

// Migrates a real PostgreSQL database, see src/test/database.ts
const database = `migration_test_${process.pid}`;
// The same backup prefix for every migration of the database, so backups of careful ones are left alone later
const prefix = { backupPrefix: '_bk_' };

const version1 = () => structuredClone(eventsJson);

/** The changes careful mode must apply without losing data. */
function version2(): any[] {
    const [venue, event, , ticket] = version1();
    venue.metadata.description = 'Places and halls';
    venue.fields = venue.fields.filter((f: any) => f.name !== 'tags');
    venue.fields.push({ name: 'city', type: 'STRING', parameters: { length: 50 }, constraints: { nullable: false, default: { value: 'Kyiv' } } });
    const field = (model: any, name: string) => model.fields.find((f: any) => f.name === name);
    field(venue, 'capacity').constraints.max = 50000;
    delete field(venue, 'name').constraints.unique;

    field(event, 'title').parameters.length = 300;
    field(event, 'status').parameters.values = ['DRAFT', 'PUBLISHED', 'CANCELLED'];
    field(event, 'price').constraints.default = { value: 1 };
    field(event, 'kind').parameters.values = ['talk', 'concert', 'workshop'];
    delete field(event, 'code').constraints;
    field(event, 'online').constraints.nullable = false;
    field(event, 'rating').description = 'Average rating';
    event.indexes = event.indexes.filter((i: any) => i.name !== 'event_starts');
    event.indexes.push({ name: 'event_title', fields: ['title'] });
    event.constraints.find((c: any) => c.name === 'event_not_free').rule.value = 99;

    delete field(ticket, 'holderId').constraints;
    ticket.fields.push({ name: 'price', type: 'DECIMAL', parameters: { precision: 6, scale: 2 } });

    const review = {
        metadata: { name: 'Review', version: '1.0.0' },
        fields: [
            { name: 'id', type: 'INT64', constraints: { primaryKey: true, identity: 'always' } },
            { name: 'eventId', type: 'INT64', constraints: { nullable: false, foreignKey: { ref: 'Event', field: 'id', onDelete: 'cascade' } } },
            { name: 'stars', type: 'INT16', constraints: { nullable: false, min: 1, max: 5 } },
            { name: 'body', type: 'TEXT' },
        ],
    };
    // Person is removed
    return [venue, event, ticket, review];
}

/** Without careful mode: the review table and the ticket price really go. */
function version3(): any[] {
    const [venue, event, ticket] = version2();
    ticket.fields = ticket.fields.filter((f: any) => f.name !== 'price');
    return [venue, event, ticket];
}

const models = (json: any[]) => new ModelSet(json.map(model => new Model(model)));

describe.skipIf(adminUrl === undefined)('Migration on PostgreSQL', () => {
    let test: TestDatabase;
    const dump = () => test.dump();
    const schema = () => test.schema();
    const rows = (sql: string) => test.rows(sql);
    let db: TestDatabase['db'];

    beforeAll(async () => {
        test = await createDatabase(database);
        db = test.db;
    });

    afterAll(async () => {
        await test?.drop();
    });

    it('creates the tables of an empty database', async () => {
        const plan = await new Migration(prefix).migrate(dump(), models(version1()), db);
        expect(plan.diff.added).toHaveLength(4);
        expect((await new Migration(prefix).plan(dump(), models(version1()))).statements).toEqual([]);

        await db.query(`INSERT INTO events.venue (name, tags) VALUES ('Hall', ARRAY['indoor'])`);
        await db.query(`INSERT INTO events.event (venue_id, title, kind, price, online, rating, notes)
                        VALUES (1, 'Opening', 'talk', 5, TRUE, 4, NULL)`);
        await db.query(`INSERT INTO person (id, event_id) VALUES (7, 1)`);
        await db.query(`INSERT INTO ticket (event_id, seat, holder_id) VALUES (1, 'A1', 7)`);
    });

    it('in careful mode changes the database keeping all data', async () => {
        const migration = new Migration({ ...prefix, careful: true, now: new Date('2026-10-31T12:00:00Z') });
        const plan = await migration.migrate(dump(), models(version2()), db);
        expect(plan.backups.map(b => [b.kind, b.backup])).toEqual([['column', '_bk_20261031120000_tags'], ['table', '_bk_20261031120000_person']]);

        // Nothing left to do: the database has the new models
        expect((await migration.plan(dump(), models(version2()))).statements).toEqual([]);

        expect(await rows(`SELECT name, city, _bk_20261031120000_tags AS tags FROM events.venue`)).toEqual([{ name: 'Hall', city: 'Kyiv', tags: ['indoor'] }]);
        expect(await rows(`SELECT id, event_id FROM _bk_20261031120000_person`)).toEqual([{ id: '7', event_id: '1' }]);
        expect(await rows(`SELECT title, status, price FROM events.event`)).toEqual([{ title: 'Opening', status: 'DRAFT', price: '5.00' }]);
        expect(await rows(`SELECT seat, holder_id FROM ticket`)).toEqual([{ seat: 'A1', holder_id: '7' }]);

        // The new constraints work, and rows without the backed-up columns can be written
        await db.query(`INSERT INTO events.venue (name, capacity) VALUES ('Hall', 50000)`);
        await expect(db.query(`INSERT INTO events.venue (name, capacity) VALUES ('Big', 60000)`)).rejects.toThrow(/venue_capacity_check/);
        await db.query(`UPDATE events.event SET status = 'CANCELLED', kind = 'workshop', title = '${'x'.repeat(300)}'`);
        await db.query(`INSERT INTO review (event_id, stars) VALUES (1, 5)`);
        await expect(db.query(`INSERT INTO review (event_id, stars) VALUES (1, 6)`)).rejects.toThrow(/check/);
        await db.query(`DELETE FROM _bk_20261031120000_person`);
    });

    it('without careful mode drops removed tables and columns', async () => {
        const plan = await new Migration(prefix).migrate(dump(), models(version3()), db);
        expect(plan.statements).toEqual(['ALTER TABLE ticket DROP COLUMN price;', 'DROP TABLE review;']);
        expect((await new Migration(prefix).plan(dump(), models(version3()))).statements).toEqual([]);
        expect(await rows(`SELECT to_regclass('review') AS review`)).toEqual([{ review: null }]);
    });

    it('changes nothing when a statement fails', async () => {
        const target = version3();
        target[1].fields.push({ name: 'extra', type: 'TEXT' });
        // The existing event has no notes
        target[1].fields.find((f: any) => f.name === 'notes').constraints = { nullable: false };
        const before = schema();
        await expect(new Migration(prefix).migrate(before, models(target), db)).rejects.toThrow(/Migration failed at statement \d+, nothing was changed/);
        expect(schema()).toBe(before);
    });
});
