import { DdlBridge } from "./DdlBridge.js";
import { parseDdl } from "./DdlParser.js";
/**
 * DDL of a whole database schema: the tables of a set of models, created in an order that satisfies their
 * foreign keys. Reading DDL needs the parser loaded first, see loadDdlParser().
 */
export class DdlSetBridge {
    bridge;
    parseOptions;
    constructor(options = {}) {
        this.bridge = new DdlBridge(options);
        this.parseOptions = { defaultSchema: options.defaultSchema, skipPrefix: options.skipPrefix };
    }
    toTarget(models) {
        return this.bridge.toDdlArray(models.models).join('\n\n');
    }
    /**
     * Reads the models of the tables the DDL creates, e.g. from pg_dump --schema-only. Names are converted back to
     * model names: user_profile becomes UserProfile, first_name becomes firstName.
     */
    toModel(ddl) {
        return this.parse(ddl).models;
    }
    /** Like toModel(), with the names of the constraints in the database and the statements that were skipped. */
    parse(ddl) {
        return parseDdl(ddl, this.parseOptions);
    }
}
//# sourceMappingURL=DdlSetBridge.js.map