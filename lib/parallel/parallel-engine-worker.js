"use strict";

const fs = require("fs");
const {
    CLIEngine,
    getCLIEngineInternalSlots,
    verifyText
} = require("../cli-engine/cli-engine");
const { translateOptions } = require("../translate-options");
const debug = require("debug")("eslint:parallel");


/**
 * Child implementation for running the CLIEngine on a subset of files for the whole run.
 */
class ParallelEngineWorker extends CLIEngine {

    /**
     * Creates a new instance of the core CLI engine.
     * @param {number} workerId Unique identifier for this worker.
     * @param {CLIEngineOptions} providedOptions The options for this instance.
     * @param {Object} [additionalData] Additional settings that are not CLIEngineOptions.
     * @param {Record<string,Plugin>|null} [additionalData.preloadedPlugins] Preloaded plugins.
     */
    constructor(workerId, providedOptions, additionalData) {
        super(providedOptions, additionalData);

        /** @type {number} */
        this.workerId = workerId;

        /** @type {import("../cli").LintResult[]} */
        this.results = [];
    }

    /**
     * Executes the current configuration on an array of file names, specifically.
     * @param {string[]} files An array of file names.
     * @param {number} jobId Unique identifier for the job
     * @returns {undefined}
     */
    executeOnFiles(files, jobId) {
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
        const startTime = Date.now();

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

        debug(`[worker:${this.workerId}] Parallel lint job ${jobId} completed in ${Date.now() - startTime}ms`);
        this.results = this.results.concat(results);
    }

    /**
     * Create a report from all results this worker has run so far.
     * @returns {import("../cli-engine/cli-engine").LintReport} The complete lint report
     */
    getResults() {
        return this.results;
    }
}

/** @type {ParallelEngineWorker | undefined} */
let worker;
let isReady;

process.on("message", async message => {
    switch (message.type) {
        case "init":
            isReady = new Promise(resolve => {
                translateOptions(message.options).then(options => {
                    worker = new ParallelEngineWorker(message.workerId, options, { preloadedPlugins: options.plugins });
                    resolve();
                });
            });
            break;
        case "files":
            await isReady;
            worker.executeOnFiles(message.files, message.id);
            process.send({ type: "done" });
            break;

        case "report":
            process.send({ type: "reportback", results: worker.getResults() });
            break;

        default:
            break;
    }
});
