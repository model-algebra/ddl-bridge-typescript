import { Model } from "model-algebra-common";
import { DdlBridge } from "./DdlBridge.js";
import { columnName, tableName } from "./names.js";

describe('SQL names', () => {
    const model = Model.fromJSON({
        metadata: { name: 'GoodsModel', version: '1.0.0' },
        fields: [{ name: 'id', type: 'INT64' }, { name: 'vendorId', type: 'INT64' }, { name: 'order', type: 'INT32' }],
    });

    it('are those of the DDL', () => {
        const ddl = new DdlBridge({ comments: false }).toTarget(model);
        expect(tableName(model)).toBe('goods_model');
        expect(model.fields.map(columnName)).toEqual(['id', 'vendor_id', '"order"']);
        for (const name of [tableName(model), ...model.fields.map(columnName)]) expect(ddl).toContain(name);
    });

    it('quote reserved words and qualify schemas', () => {
        expect(tableName({ metadata: { name: 'User' } })).toBe('"user"');
        expect(tableName({ metadata: { name: 'Offer', schema: 'shop' } })).toBe('shop.offer');
        expect(columnName('createdAt')).toBe('created_at');
    });
});
