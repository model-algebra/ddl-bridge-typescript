import { Model } from "./Model";

const typeMap: Record<string, string> = {
    "integer": "INTEGER",
    "number": "NUMERIC",
    "string": "TEXT",
    "boolean": "BOOLEAN",
    "date": "DATE"
};

function toSnakeCase(name: string): string {
    return name
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '')
        .replace(/[^a-z0-9_]/g, '');
}

export class DdlBridge {

    toDdl(model: Model): string {
        const tableName = toSnakeCase(model.metadata.name);
        const columns = model.fields.map(field => this.convertField(field));
        return `CREATE TABLE ${tableName} (\n${columns.join(',\n')}\n);`;
    }

    toDdlFromProcessorResult(fields: Array<{name: string, value: any}>, tableName: string): string {
        const columns = fields.map(f => `    ${toSnakeCase(f.name)} ${this.inferSqlType(f.value)}`);
        return `CREATE TABLE ${tableName} (\n${columns.join(',\n')}\n);`;
    }

    convertField(field: Record<string, any>): string {
        if (!Object.hasOwn(typeMap, field.type)) {
            throw new Error(`Unsupported field type: ${field.type} for field ${field.name}`);
        }
        const colName = toSnakeCase(field.name);
        const sqlType = typeMap[field.type];
        const parts = this.getConstraintParts(field);
        const constraintStr = parts.length > 0 ? ' ' + parts.join(' ') : '';
        return `    ${colName} ${sqlType}${constraintStr}`;
    }

    private inferSqlType(value: any): string {
        if (typeof value === 'boolean') return 'BOOLEAN';
        if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'NUMERIC';
        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return 'JSONB';
        return 'TEXT';
    }

    private getConstraintParts(field: Record<string, any>): string[] {
        const parts: string[] = [];
        const c = field.constraints;
        if (!c) return parts;
        const col = toSnakeCase(field.name);
        if (c.nullable === false) parts.push('NOT NULL');
        if (c.primaryKey === true) parts.push('PRIMARY KEY');
        if (c.unique === true) parts.push('UNIQUE');
        if (c.min !== undefined || c.max !== undefined) {
            const range: string[] = [];
            if (c.min !== undefined) range.push(`${col} >= ${c.min}`);
            if (c.max !== undefined) range.push(`${col} <= ${c.max}`);
            parts.push(`CHECK (${range.join(' AND ')})`);
        }
        if (Array.isArray(c.enum)) {
            const values = c.enum.map((v: any) => `'${v}'`).join(', ');
            parts.push(`CHECK (${col} IN (${values}))`);
        }
        if (c.regex !== undefined) {
            parts.push(`CHECK (${col} ~ '${c.regex}')`);
        }
        return parts;
    }
}
