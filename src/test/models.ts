import * as fs from 'node:fs';
import { Model, ModelSet } from 'model-algebra-common';

/** Models of src/examples/shop_database, in JSON form. */
export const shopJson = ['user', 'delivery_type', 'discount', 'product', 'order']
    .map(name => JSON.parse(fs.readFileSync(`src/examples/shop_database/${name}.json`, 'utf-8')));

/** Models using every feature the DDL bridge supports: schemas, native enums, arrays, identity, defaults, checks... */
export const eventsJson: any[] = [
    {
        metadata: { name: 'Venue', version: '1.0.0', schema: 'events', description: 'Places events happen at' },
        fields: [
            { name: 'id', type: 'INT32', constraints: { primaryKey: true, identity: 'byDefault' } },
            { name: 'name', type: 'STRING', description: 'Shown to visitors', parameters: { length: 100 }, constraints: { nullable: false, unique: true } },
            { name: 'capacity', type: 'INT32', constraints: { min: 1, max: 100000, default: { value: 100 } } },
            { name: 'tags', type: 'ARRAY', parameters: { items: { type: 'STRING', parameters: { length: 20 } } }, constraints: { default: { value: ['indoor'] } } },
            { name: 'location', type: 'JSON', constraints: { default: { value: { lat: 0, lng: 0 } } } },
        ],
    },
    {
        metadata: { name: 'Event', version: '1.0.0', schema: 'events' },
        fields: [
            { name: 'id', type: 'INT64', constraints: { primaryKey: true, identity: 'always' } },
            { name: 'venueId', type: 'INT32', constraints: { nullable: false, foreignKey: { ref: 'Venue', field: 'id', onDelete: 'cascade' } } },
            { name: 'title', type: 'STRING', parameters: { length: 200 }, constraints: { nullable: false } },
            { name: 'code', type: 'STRING', parameters: { length: 3 }, constraints: { regex: '^[A-Z]{3}$' } },
            { name: 'status', type: 'ENUM', parameters: { values: ['DRAFT', 'PUBLISHED'] }, targets: { postgresql: { enumType: 'event_status' } }, constraints: { nullable: false, default: { value: 'DRAFT' } } },
            { name: 'kind', type: 'ENUM', parameters: { values: ['talk', 'concert'] } },
            { name: 'price', type: 'DECIMAL', parameters: { precision: 8, scale: 2 }, constraints: { min: 0, default: { value: 0 } } },
            { name: 'startsAt', type: 'TIMESTAMP_TZ', parameters: { precision: 3 }, constraints: { default: { function: 'now' } } },
            { name: 'endsAt', type: 'TIMESTAMP_TZ' },
            { name: 'duration', type: 'DURATION' },
            { name: 'doors', type: 'TIME', parameters: { precision: 0 } },
            { name: 'day', type: 'DATE', constraints: { default: { function: 'currentDate' } } },
            { name: 'token', type: 'UUID', constraints: { default: { function: 'uuid' }, unique: true } },
            { name: 'flags', type: 'ARRAY', parameters: { items: { type: 'ENUM', parameters: { values: ['a', 'b'] } } } },
            { name: 'online', type: 'BOOLEAN', constraints: { default: { value: false } } },
            { name: 'rating', type: 'FLOAT64', constraints: { min: -1.5, max: 5 } },
            { name: 'small', type: 'INT16' },
            { name: 'real', type: 'FLOAT32' },
            { name: 'data', type: 'BYTES' },
            { name: 'ip', type: 'TEXT', targets: { postgresql: { type: 'inet' } } },
            { name: 'notes', type: 'TEXT', description: "Organizer's notes" },
        ],
        constraints: [
            { name: 'event_dates', type: 'check', rule: { field: 'endsAt', op: '>=', otherField: 'startsAt' } },
            { name: 'event_venue_title', type: 'unique', fields: ['venueId', 'title'] },
            { name: 'event_not_free', type: 'check', rule: { field: 'price', op: '!=', value: 13 } },
        ],
        indexes: [
            { name: 'event_starts', fields: ['startsAt'] },
            { name: 'event_online_venue', fields: ['venueId', 'day'], where: { field: 'online', op: '=', value: true } },
            { name: 'event_title_hash', fields: ['title'], targets: { postgresql: { method: 'hash' } } },
        ],
    },
    {
        metadata: { name: 'Person', version: '1.0.0' },
        fields: [
            { name: 'id', type: 'INT64', constraints: { primaryKey: true } },
            { name: 'managerId', type: 'INT64', constraints: { foreignKey: { ref: 'Person', field: 'id', onDelete: 'setNull' } } },
            { name: 'eventId', type: 'INT64', constraints: { foreignKey: { ref: 'Event', field: 'id' } } },
        ],
    },
    {
        metadata: { name: 'Ticket', version: '1.0.0' },
        fields: [
            { name: 'eventId', type: 'INT64', constraints: { foreignKey: { ref: 'Event', field: 'id', onUpdate: 'restrict' } } },
            { name: 'seat', type: 'STRING', parameters: { length: 10 } },
            { name: 'holderId', type: 'INT64', constraints: { foreignKey: { ref: 'Person', field: 'id' } } },
        ],
        constraints: [{ name: 'ticket_key', type: 'primaryKey', fields: ['eventId', 'seat'] }],
    },
];

export const shopModels = () => new ModelSet(shopJson.map(model => new Model(structuredClone(model))));
export const eventModels = () => new ModelSet(eventsJson.map(model => new Model(structuredClone(model))));

export const readFixture = (name: string) => fs.readFileSync(`src/test/fixtures/${name}`, 'utf-8');
