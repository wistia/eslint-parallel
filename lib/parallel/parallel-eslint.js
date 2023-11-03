/* eslint-disable class-methods-use-this -- disabling so that things work */
"use strict";

const { ParallelEngine } = require("./parallel-engine");
const { compareResultsByFilePath, createRulesMeta } = require("../eslint/eslint");

/** @typedef {import("../options").ParsedCLIOptions} ParsedCLIOptions */

/**
 * A parallelized implementation of ESLint, spawing multiple worker processes to
 * distribute subsets of files to and collate into a final report.
 *
 * This class is needed to intercept the options before they get translated into
 * JS objects, so that they can be passed to the worker processes first.
 */
class ParallelESLint {

    /**
     *
     * @param {ParsedCLIOptions} options Un-translated options that can be passed to each worker
     */
    constructor(options) {
        this.options = options;
        this.parallelEngine = new ParallelEngine(options);
    }

    /**
     * Executes the current configuration on an array of file and directory names.
     * @param {string | string[]} patterns An array of file and directory names.
     * @returns {Promise<import("../cli-engine/cli-engine").LintResult[]>} The results of linting the file patterns given.
     */
    async lintFiles(patterns) {
        const patternsArray = Array.isArray(patterns) ? patterns : [patterns];

        if (patternsArray.some(pattern => pattern.trim() === "")) {
            throw new Error("'patterns' must be a non-empty string or an array of non-empty strings");
        }

        return this.parallelEngine.run(patterns);
    }

    /**
     * A no-op for parallel operations, linting of stdin text is not supported.
     * @returns {undefined}
     */
    async lintText() {
        throw new Error("linting text from stdin is not supported in parallel mode");
    }

    /**
     * This should not exist. It's a copy from eslint/eslint.js
     *
     * Returns the formatter representing the given formatter name.
     * @param {string} [name] The name of the formatter to load.
     * The following values are allowed:
     * - `undefined` ... Load `stylish` builtin formatter.
     * - A builtin formatter name ... Load the builtin formatter.
     * - A third-party formatter name:
     *   - `foo` → `eslint-formatter-foo`
     *   - `@foo` → `@foo/eslint-formatter`
     *   - `@foo/bar` → `@foo/eslint-formatter-bar`
     * - A file path ... Load the file.
     * @returns {Promise<LoadedFormatter>} A promise resolving to the formatter object.
     * This promise will be rejected if the given formatter was not found or not
     * a function.
     */
    async loadFormatter(name = "stylish") {
        if (typeof name !== "string") {
            throw new Error("'name' must be a string");
        }

        const formatter = this.parallelEngine.getFormatter(name);

        if (typeof formatter !== "function") {
            throw new Error(`Formatter must be a function, but got a ${typeof formatter}.`);
        }

        return {

            /**
             * The main formatter method.
             * @param {LintResult[]} results The lint results to format.
             * @param {ResultsMeta} resultsMeta Warning count and max threshold.
             * @returns {string | Promise<string>} The formatted lint results.
             */
            format(results, resultsMeta) {
                let rulesMeta = null;

                results.sort(compareResultsByFilePath);

                return formatter(results, {
                    ...resultsMeta,
                    get cwd() {
                        return this.options.cwd;
                    },
                    get rulesMeta() {
                        if (!rulesMeta) {
                            rulesMeta = createRulesMeta(this.parallelEngine.getRules());
                        }

                        return rulesMeta;
                    }
                });
            }
        };
    }
}

module.exports = { ParallelESLint };
/* eslint-enable class-methods-use-this -- disabling so that things work */
