import { Model } from "./Model";

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

    toDdlArray(models: Model[]): string[] {
        return models.map(model => this.toDdl(model));
    }

    toDdlFromProcessorResult(fields: Array<{name: string, value: any}>, tableName: string): string {
        const columns = fields.map(f => `    ${toSnakeCase(f.name)} ${this.inferSqlType(f.value)}`);
        return `CREATE TABLE ${tableName} (\n${columns.join(',\n')}\n);`;
    }

    convertField(field: Record<string, any>): string {
        const colName = toSnakeCase(field.name);
        const sqlType = this.getSqlType(field);
        const parts = this.getConstraintParts(field);
        const constraintStr = parts.length > 0 ? ' ' + parts.join(' ') : '';
        return `    ${colName} ${sqlType}${constraintStr}`;
    }

    private getSqlType(field: Record<string, any>): string {
        const params = field.parameters || {};
        switch (field.type) {
            case 'integer':
            case 'INT32':   return 'INTEGER';
            case 'INT64':   return 'BIGINT';
            case 'FLOAT32': return 'REAL';
            case 'FLOAT64': return 'DOUBLE PRECISION';
            case 'number':
            case 'DECIMAL':
                return (params.precision !== undefined && params.scale !== undefined)
                    ? `NUMERIC(${params.precision}, ${params.scale})`
                    : 'NUMERIC';
            case 'STRING':
                return params.length !== undefined ? `VARCHAR(${params.length})` : 'TEXT';
            case 'string':
            case 'TEXT':    return 'TEXT';
            case 'boolean':
            case 'BOOLEAN': return 'BOOLEAN';
            case 'UUID':    return 'UUID';
            case 'date':
            case 'DATE':    return 'DATE';
            case 'TIME':    return 'TIME';
            case 'DATETIME':
            case 'TIMESTAMP': return 'TIMESTAMP';
            case 'TIMESTAMP_TZ': return 'TIMESTAMP WITH TIME ZONE';
            case 'DURATION': return 'INTERVAL';
            case 'OBJECT':
            case 'UNION':
            case 'JSON':    return 'JSONB';
            case 'ENUM':    return 'TEXT';
            default:
                throw new Error(`Unsupported field type: ${field.type} for field ${field.name}`);
        }
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
        const enumValues = Array.isArray(c.enum)
            ? c.enum
            : (field.type === 'ENUM' && Array.isArray((field.parameters || {}).values)
                ? field.parameters.values
                : null);
        if (enumValues) {
            const vals = enumValues.map((v: any) => `'${v}'`).join(', ');
            parts.push(`CHECK (${col} IN (${vals}))`);
        }
        if (c.regex !== undefined) {
            parts.push(`CHECK (${col} ~ '${c.regex}')`);
        }
        if (c.foreign_key !== undefined) {
            const refTable = toSnakeCase(c.foreign_key.ref);
            const refCol   = toSnakeCase(c.foreign_key.field);
            parts.push(`REFERENCES ${refTable}(${refCol})`);
        }
        return parts;
    }
}
