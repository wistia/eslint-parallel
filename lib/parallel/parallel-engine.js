"use strict";

const {
    CLIEngine,
    getCLIEngineInternalSlots,
    createIgnoreResult
} = require("../cli-engine/cli-engine");
const { processOptions } = require("../eslint/eslint");
const builtInRules = require("../rules");
const { translateOptions } = require("../translate-options");
const { WorkerPool } = require("./worker-pool");
const debug = require("debug")("eslint:cli-engine");

const BATCH_SIZE = 50;


/**
 * @typedef {import("../options").ParsedCLIOptions} ParsedCLIOptions
 * @typedef {import("../cli-engine/cli-engine").LintReport} LintReport
 */

/**
 * The supervising process for running multiple worker processes to lint files.
 */
class ParallelEngine {

    /**
     * @param {ParsedCLIOptions} options Options to pass to the worker engines
     */
    constructor(options) {
        this.options = options;
        this.pool = new WorkerPool(options);
    }

    /**
     * Run the current configuration on an array of file and directory names.
     * @param {string[]} patterns An array of file and directory names.
     * @returns {LintResult} The results for all files that were linted.
     */
    async run(patterns) {
        if (!this.engine) {
            const translatedOptions = await translateOptions(this.options);
            const processedOptions = processOptions(translatedOptions);

            this.engine = new CLIEngine(processedOptions, { preloadedPlugins: processedOptions.plugins });
        }
        const {
            fileEnumerator,
            lastConfigArrays,
            options: { cwd }
        } = getCLIEngineInternalSlots(this.engine);
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

        jobCount += 1;
        this.pool.run(fileBatch);

        debug("All parallel jobs submitted, waiting on results");

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

        const poolResults = await this.pool.getResults();

        this.pool.spinDown();
        return results.concat(poolResults);
    }


    /**
     * All of this should not have to exist. It's a copy from cli-engine.js
     */

    /**
     * Returns the formatter representing the given format or null if the `format` is not a string.
     * @param {string} [format] The name of the format to load or the path to a
     *      custom formatter.
     * @throws {any} As may be thrown by requiring of formatter
     * @returns {(FormatterFunction|null)} The formatter function or null if the `format` is not a string.
     */
    getFormatter(format) {
        const path = require("path");
        const {
            Legacy: {
                naming,
                ModuleResolver
            }
        } = require("@eslint/eslintrc");

        const resolvedFormatName = format || "stylish";

        // only strings are valid formatters
        if (typeof resolvedFormatName === "string") {

            // replace \ with / for Windows compatibility
            const normalizedFormatName = resolvedFormatName.replace(/\\/gu, "/");

            const slots = getCLIEngineInternalSlots(this);
            const cwd = slots ? slots.options.cwd : process.cwd();
            const namespace = naming.getNamespaceFromTerm(normalizedFormatName);

            let formatterPath;

            // if there's a slash, then it's a file (TODO: this check seems dubious for scoped npm packages)
            if (!namespace && normalizedFormatName.includes("/")) {
                formatterPath = path.resolve(cwd, normalizedFormatName);
            } else {
                try {
                    const npmFormat = naming.normalizePackageName(normalizedFormatName, "eslint-formatter");

                    formatterPath = ModuleResolver.resolve(npmFormat, path.join(cwd, "__placeholder__.js"));
                } catch {
                    formatterPath = path.resolve(path.join(__dirname, "..", "cli-engine", "formatters"), normalizedFormatName);
                }
            }

            try {
                return require(formatterPath);
            } catch (ex) {
                if (format === "table" || format === "codeframe") {
                    ex.message = `The ${format} formatter is no longer part of core ESLint. Install it manually with \`npm install -D eslint-formatter-${format}\``;
                } else {
                    ex.message = `There was a problem loading formatter: ${formatterPath}\nError: ${ex.message}`;
                }
                throw ex;
            }

        } else {
            return null;
        }
    }

    getRules() {
        const { lastConfigArrays } = getCLIEngineInternalSlots(this);

        return new Map(function *() {
            yield* builtInRules;

            for (const configArray of lastConfigArrays) {
                yield* configArray.pluginRules;
            }
        }());
    }
}

module.exports = { ParallelEngine };
