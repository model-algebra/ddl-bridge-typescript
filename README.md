# ddl-bridge-typescript

PostgreSQL DDL for [model-algebra](https://github.com/model-algebra) models, in both directions, and migrations
that bring a database to a set of models.

- **`DdlBridge`**: one model ↔ the DDL of one table
- **`DdlSetBridge`**: a `ModelSet` ↔ the DDL of a whole schema, e.g. `pg_dump --schema-only` output
- **`Migration`**: reads the DDL of a database, compares it with the models it should have, and changes it

## Installation

```sh
pnpm add github:model-algebra/ddl-bridge-typescript
```

With pnpm, allow the build scripts of the GitHub-hosted packages in `pnpm-workspace.yaml`:

```yaml
onlyBuiltDependencies:
  - ddl-bridge-typescript
  - model-algebra-common
  - model-algebra-typescript
```

## Models to DDL

```ts
import { DdlBridge, DdlSetBridge } from 'ddl-bridge-typescript'

new DdlBridge().toTarget(userModel)              // CREATE TABLE "user" (...)
new DdlSetBridge().toTarget(new ModelSet(models)) // every table, referenced ones first
```

## DDL to models

DDL is read with the PostgreSQL parser itself ([libpg-query](https://github.com/launchql/libpg-query-node), compiled
to WebAssembly). It has to be loaded once before reading:

```ts
import { loadDdlParser, DdlSetBridge } from 'ddl-bridge-typescript'

await loadDdlParser()
const models = new DdlSetBridge().toModel(ddl)   // a ModelSet
```

Names become model names (`user_profile` → `UserProfile`, `first_name` → `firstName`), types become canonical types
(`character varying(20)` → `STRING` with `length: 20`), and PostgreSQL types without a model type are kept as a
`targets.postgresql.type` override.

The result is **canonical**: DDL that creates the same tables gives the same models, whoever wrote it. In particular:

- **Field constraints:** constraints of one column that a field can express become field constraints, whatever they
  are named. These are primary key, unique, foreign key, and checks of `min`/`max`, allowed values (`enum`) or `regex`.
- **Table constraints:** constraints of several columns, and other checks, stay table constraints.
- **Implied NOT NULL:** primary key and identity columns are `nullable: false`, as PostgreSQL makes them.
- **Order:** tables, table constraints and indexes are ordered by name.

`DdlSetBridge.parse()` returns the models with a catalog of the constraint names in the database, which migrations
need to drop constraints, and warnings for statements that were skipped (functions, views, triggers…).

Some DDL can't be read; it is rejected with an error rather than ignored:

- expression or multi-column foreign keys, and expression indexes
- defaults other than constants, `CURRENT_TIMESTAMP`, `CURRENT_DATE` and `gen_random_uuid()` (e.g. `serial`)
- generated, inherited and partitioned tables
- names the bridge cannot write back, i.e. not lowercase `snake_case`

## Migrations

```ts
import pg from 'pg'
import { Migration } from 'ddl-bridge-typescript'

// pg_dump --schema-only --no-owner --no-privileges mydb > current.sql
const migration = new Migration({ careful: true })
const plan = await migration.plan(currentDdl, desiredModels)
console.log(plan.statements)      // review them

const client = new pg.Client(connectionString)
await client.connect()
await migration.apply(plan, client)   // one transaction: all statements or none
```

`migration.migrate(currentDdl, desiredModels, client)` does both. The steps:

1. **Read** the models the database has from its DDL (`DdlSetBridge.parse`).
2. **Compare** them with the desired models (`diff` from model-algebra-typescript). The desired models are first
   converted to DDL and read back, so both sides are canonical and only differences the database can see count.
3. **Convert** the diff to DDL. The statements are ordered so PostgreSQL accepts them:
   1. constraints and indexes that go
   2. removed columns and tables
   3. schema moves and enum types
   4. new tables, then new and changed columns, constraints, indexes and comments
   5. foreign keys
4. **Apply** the statements in one transaction. If one fails, it is rolled back and the error names the statement.

`plan` returns the actual and desired models, the diff, the statements, the backups careful mode makes, and warnings.
It doesn't touch the database.

### Careful mode

With `careful: true`, removed tables and columns are renamed instead of dropped, so their data stays and the
change can be undone:

| Change | Careful | Not careful |
|---|---|---|
| Column removed | `RENAME COLUMN email TO _deleted_20261031120000_email` | `DROP COLUMN email` |
| Table removed | `RENAME TO _deleted_20261031120000_log`, and its indexes likewise | `DROP TABLE log` |

A backed-up column loses what would stop new rows without it: `NOT NULL`, identity, its primary key and foreign key.
Its data and other constraints stay. `plan.backups` lists every rename.

Tables and columns whose names start with the backup prefix (`backupPrefix`, default `_deleted_`) are left out
when the database is read. So backups are never compared, dropped or backed up again, in careful mode or not. To
undo a removal, rename the backup back; to get rid of backups, drop them.

### What migrations cannot do

- **Renames:** tables, columns, constraints and indexes are matched by name, so a rename is a removal and an
  addition. Careful mode keeps the data of the removed one.
- **Enum values:** values can be added to native enum types, not removed or reordered. A value added in a migration
  can't be used in the same transaction, e.g. as a new default.
- **Data:** a new `NOT NULL` column without a default, a narrower type or a stricter check fails on existing rows
  that don't fit. The whole migration is then rolled back.
- **Schema moves:** a table that uses a native enum type can't move to another schema.

## Development

```sh
pnpm install
pnpm test            # vitest
pnpm test:coverage   # with a coverage report
pnpm type-check
pnpm build
```

What the tests cover:

- **`RoundTrip.spec.ts`:** model → DDL → model. Canonical models come back unchanged, one test per type, constraint
  and table feature. Other models come back in their documented canonical form. DDL becomes stable after one round
  trip.
- **`DdlParser.spec.ts`:** `pg_dump` output and hand-written DDL, and every construct that is rejected.
- **`Migration.spec.ts`:** the statements migrations plan.
- **`*.db.spec.ts`:** migrations run on a real PostgreSQL. Each scenario creates the old models, writes rows, migrates,
  then checks the data and that the database has exactly the new models.

The database tests run when `MIGRATION_TEST_DATABASE_URL` names a server they may create databases on. They also
need `pg_dump` of the same major version, on the `PATH` or in `PG_DUMP`; without the URL they are skipped:

```sh
docker run -d --name pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:18
MIGRATION_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres pnpm test
```

`src/test/fixtures/*.pg_dump.sql` are `pg_dump` outputs of databases created from the test models, used to check
that real dumps read the same as generated DDL.
