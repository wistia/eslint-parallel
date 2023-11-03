/* eslint-disable class-methods-use-this -- disabling so that things work */
"use strict";

const { ParallelEngine } = require("./parallel-engine");

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
     * @returns {Promise<LintResult[]>} The results of linting the file patterns given.
     */
    async lintFiles(patterns) {
        const patternsArray = Array.isArray(patterns) ? patterns : [patterns];

        if (patternsArray.some(pattern => pattern.trim() === "")) {
            throw new Error("'patterns' must be a non-empty string or an array of non-empty strings");
        }

        this.parallelEngine.run(patterns);
    }

    /**
     * A no-op for parallel operations, linting of stdin text is not supported.
     * @returns {undefined}
     */
    async lintText() {
        throw new Error("linting text from stdin is not supported in parallel mode");
    }
}

module.exports = { ParallelESLint };
/* eslint-enable class-methods-use-this -- disabling so that things work */
