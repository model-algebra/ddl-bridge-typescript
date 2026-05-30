/* Classes to store data model. Example of model in json format:
{
    "metadata": {
        "name": "User",
        "version": "1.0.0"
    },
    "fields": [
        {
            "name": "id",
            "type": "integer",
            "description": "Main index",
            "constraints": {
                "primaryKey": true,
                "nullable": false
            }
        },
        {
            "name": "userName",
            "type": "string",
            "description": "Login name",
            "constraints": {
                "nullable": false
            }
        },
        {
            "name": "firstName",
            "type": "string",
            "description": "First name",
            "constraints": {
                "nullable": false
            }
        },
        {
            "name": "secondName",
            "type": "string",
            "description": "Second name"
        }
    ]
}
*/

export class Metadata {
    name: string;
    version: string;

    constructor(data: any) {
        this.name = data.name;
        this.version = data.version;
    }
}

export class Constraint {
    constructor(public readonly name: string, public readonly value: any) {}
}

export class Field {
    name: string;
    type: string;
    description?: string;
    constraints: Array<Constraint>;

    constructor(data: any) {
        this.name = data.name;
        this.type = data.type;
        this.description = data.description;
        this.constraints = data.constraints;
    }

    public static fromJSON(data: any): Field {
        const constraints: Array<Constraint> = [];
        if (data.constraints) {
            for (const [key, value] of Object.entries(data.constraints)) {
                constraints.push(new Constraint(key, value));
            }
        }
        return new Field({
            name: data.name,
            type: data.type,
            description: data.description,
            constraints: constraints
        });
    }
}

export class Model {
    metadata: Metadata;
    fields: Array<Field>;

    constructor(data: any) {
        this.metadata = data.metadata;
        this.fields = data.fields;
    }

    public static fromJSON(data: any): Model {
        const metadata = new Metadata(data.metadata);
        const fields: Array<Field> = data.fields.map((fieldData: any) => Field.fromJSON(fieldData));
        return new Model({
            metadata: metadata,
            fields: fields
        });
    }

    public static fromJsonString(jsonString: string): Model {
        const data = JSON.parse(jsonString);
        return Model.fromJSON(data);
    }
}