"use strict";

const fs = require("fs");
const {
    calculateStatsPerRun,
    CLIEngine,
    getCLIEngineInternalSlots,
    iterateRuleDeprecationWarnings,
    verifyText
} = require("../cli-engine/cli-engine");
const { translateOptions } = require("../translate-options");


/**
 * Child implementation for running the CLIEngine on a subset of files for the whole run.
 */
class ParallelEngineWorker extends CLIEngine {

    /**
     * Creates a new instance of the core CLI engine.
     * @param {CLIEngineOptions} providedOptions The options for this instance.
     * @param {Object} [additionalData] Additional settings that are not CLIEngineOptions.
     * @param {Record<string,Plugin>|null} [additionalData.preloadedPlugins] Preloaded plugins.
     */
    constructor(providedOptions, additionalData) {
        super(providedOptions, additionalData);

        /** @type {LintResults[]} */
        this.results = [];
    }

    /**
     * Executes the current configuration on an array of file names, specifically.
     * @param {string[]} files An array of file names.
     * @returns {undefined}
     */
    executeOnFiles(files) {
        const {
            fileEnumerator,
            lastConfigArrays,
            linter,
            options: {
                allowInlineConfig,
                cwd,
                fix,
                reportUnusedDisableDirectives
            }
        } = getCLIEngineInternalSlots(this);
        const results = [];

        // Clear the last used config arrays.
        lastConfigArrays.length = 0;

        // Iterate source code files.
        for (const { config, filePath } of fileEnumerator.iterateFiles(files)) {

            /*
             * Store used configs for:
             * - this method uses to collect used deprecated rules.
             * - `getRules()` method uses to collect all loaded rules.
             * - `--fix-type` option uses to get the loaded rule's meta data.
             */
            if (!lastConfigArrays.includes(config)) {
                lastConfigArrays.push(config);
            }

            // Do lint.
            const result = verifyText({
                text: fs.readFileSync(filePath, "utf8"),
                filePath,
                config,
                cwd,
                fix,
                allowInlineConfig,
                reportUnusedDisableDirectives,
                fileEnumerator,
                linter
            });

            results.push(result);
        }


        this.results.concat(results);
    }

    /**
     * Create a report from all results this worker has run so far.
     * @returns {import("../cli-engine/cli-engine").LintReport} The complete lint report
     */
    getReport() {
        const {
            lastConfigArrays
        } = getCLIEngineInternalSlots(this);

        let usedDeprecatedRules;

        return {
            results: this.results,
            ...calculateStatsPerRun(this.results),

            // Initialize it lazily because CLI and `ESLint` API don't use it.
            get usedDeprecatedRules() {
                if (!usedDeprecatedRules) {
                    usedDeprecatedRules = Array.from(
                        iterateRuleDeprecationWarnings(lastConfigArrays)
                    );
                }
                return usedDeprecatedRules;
            }
        };
    }
}

/** @type {ParallelEngineWorker | undefined} */
let worker;

process.on("message", async message => {
    switch (message.type) {
        case "init": {
            const options = await translateOptions(message.options);

            worker = new ParallelEngineWorker(options, { preloadedPlugins: options.plugins });
            break;
        }
        case "files":
            worker.executeOnFiles(message.files);
            process.send({ type: "done" });
            break;

        case "report":
            process.send({ type: "reportback", report: worker.getReport() });
            break;

        default:
            break;
    }
});
