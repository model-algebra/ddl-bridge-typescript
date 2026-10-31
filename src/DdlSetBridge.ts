import type { ModelSet, ModelSetBridge } from "model-algebra-common";
import { DdlBridge, type DdlBridgeOptions } from "./DdlBridge.js";
import { parseDdl, type DdlParseOptions, type ParsedSchema } from "./DdlParser.js";

export interface DdlSetBridgeOptions extends DdlBridgeOptions, DdlParseOptions {}

/**
 * DDL of a whole database schema: the tables of a set of models, created in an order that satisfies their
 * foreign keys. Reading DDL needs the parser loaded first, see loadDdlParser().
 */
export class DdlSetBridge implements ModelSetBridge<string> {
    private readonly bridge: DdlBridge;
    private readonly parseOptions: DdlParseOptions;

    constructor(options: DdlSetBridgeOptions = {}) {
        this.bridge = new DdlBridge(options);
        this.parseOptions = { defaultSchema: options.defaultSchema, skipPrefix: options.skipPrefix };
    }

    toTarget(models: ModelSet): string {
        return this.bridge.toDdlArray(models.models).join('\n\n');
    }

    /**
     * Reads the models of the tables the DDL creates, e.g. from pg_dump --schema-only. Names are converted back to
     * model names: user_profile becomes UserProfile, first_name becomes firstName.
     */
    toModel(ddl: string): ModelSet {
        return this.parse(ddl).models;
    }

    /** Like toModel(), with the names of the constraints in the database and the statements that were skipped. */
    parse(ddl: string): ParsedSchema {
        return parseDdl(ddl, this.parseOptions);
    }
}
