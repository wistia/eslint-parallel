"use strict";

const {
    getCLIEngineInternalSlots,
    createIgnoreResult
} = require("../cli-engine/cli-engine");
const { WorkerPool } = require("./worker-pool");
const debug = require("debug")("eslint:cli-engine");

const BATCH_SIZE = 50;


/**
 * @typedef {import("../options").ParsedCLIOptions} ParsedCLIOptions
 * @typedef {import("../cli-engine/cli-engine").LintReport} LintReport
 */

/**
 * Combine all of the worker reports into a single report
 * @param {LintReport[]} reports List of reports to merge
 * @throws {Error} Throws if no reports are provided.
 * @returns {LintReport} The combined report
 */
function mergeReports(reports) {
    if (reports.length === 0) {
        throw new Error("No reports were provided to merge");
    }

    const finalReport = reports[0];

    for (const report of reports.slice(1)) {
        finalReport.errorCount += report.errorCount;
        finalReport.warningCount += report.warningCount;
        finalReport.fatalErrorCount += report.fatalErrorCount;
        finalReport.fixableErrorCount += report.fixableErrorCount;
        finalReport.fixableWarningCount += report.fixableWarningCount;
        finalReport.results.concat(report.results);
        finalReport.usedDeprecatedRules.concat(report.usedDeprecatedRules);
    }

    return finalReport;
}

/**
 * The supervising process for running multiple worker processes to lint files.
 */
class ParallelEngine {

    /**
     * @param {ParsedCLIOptions} options Options to pass to the worker engines
     */
    constructor(options) {
        this.options = options;
        this.pool = new WorkerPool();
    }

    /**
     * Run the current configuration on an array of file and directory names.
     * @param {string[]} patterns An array of file and directory names.
     * @returns {LintReport} The results for all files that were linted.
     */
    async run(patterns) {
        const {
            fileEnumerator,
            lastConfigArrays,
            options: { cwd }
        } = getCLIEngineInternalSlots(this);
        const results = [];
        const startTime = Date.now();

        // Clear the last used config arrays.
        lastConfigArrays.length = 0;

        /** @type {string[]} */
        let fileBatch = [];

        let jobCount = 0;

        // Iterate source code files.
        for (const { config, filePath, ignored } of fileEnumerator.iterateFiles(patterns)) {
            if (ignored) {
                results.push(createIgnoreResult(filePath, cwd));
                continue;
            }

            /*
             * Store used configs for:
             * - this method uses to collect used deprecated rules.
             * - `getRules()` method uses to collect all loaded rules.
             * - `--fix-type` option uses to get the loaded rule's meta data.
             */
            if (!lastConfigArrays.includes(config)) {
                lastConfigArrays.push(config);
            }

            fileBatch.push(filePath);
            if (fileBatch.length >= BATCH_SIZE) {
                jobCount += 1;
                this.pool.run(fileBatch);
                fileBatch = [];
            }
        }

        // Wait for all of the job tasks to complete by counting down as they finish.
        await new Promise(resolve => {
            this.pool.onTaskCompleted(() => {
                jobCount -= 1;
                if (jobCount === 0) {
                    resolve();
                }
            });
        });

        debug(`Linting complete in: ${Date.now() - startTime}ms`);

        const reports = await this.pool.getReports();
        const report = mergeReports(reports);

        return report;
    }
}

module.exports = { ParallelEngine };
