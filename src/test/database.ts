import { execFileSync } from 'node:child_process';
import pg from 'pg';

/*
 * Databases for the tests that migrate a real PostgreSQL. They run when MIGRATION_TEST_DATABASE_URL points at a
 * server the tests may create databases on, e.g. postgres://postgres:test@localhost:55432/postgres; pg_dump of the
 * same major version must be on the PATH, or given in PG_DUMP.
 */
export const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const pgDump = process.env.PG_DUMP ?? 'pg_dump';

export interface TestDatabase {
    db: pg.Client;
    /** pg_dump --schema-only of the database. */
    dump(): string;
    /** The dump without the \restrict lines, which pg_dump writes with a new random key every time. */
    schema(): string;
    rows(sql: string): Promise<any[]>;
    drop(): Promise<void>;
}

/** Creates an empty database and connects to it. */
export async function createDatabase(name: string): Promise<TestDatabase> {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(adminUrl!);
    url.pathname = `/${name}`;
    const db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    const dump = () => execFileSync(pgDump, ['--schema-only', '--no-owner', '--no-privileges', url.toString()], { encoding: 'utf-8' });
    return {
        db,
        dump,
        schema: () => dump().replace(/^\\(un)?restrict .*$/gm, ''),
        rows: async sql => (await db.query(sql)).rows,
        drop: async () => {
            await db.end();
            await admin.query(`DROP DATABASE IF EXISTS ${name}`);
            await admin.end();
        },
    };
}
