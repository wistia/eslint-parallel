"use strict";

const { Legacy: { naming } } = require("@eslint/eslintrc");
const { normalizeSeverityToString } = require("./shared/severity");
const { ModuleImporter } = require("@humanwhocodes/module-importer");

/**
 * Predicate function for whether or not to apply fixes in quiet mode.
 * If a message is a warning, do not apply a fix.
 * @param {LintMessage} message The lint result.
 * @returns {boolean} True if the lint message is an error (and thus should be
 * autofixed), false otherwise.
 */
function quietFixPredicate(message) {
    return message.severity === 2;
}

/**
 * Predicate function for whether or not to run a rule in quiet mode.
 * If a rule is set to warning, do not run it.
 * @param {{ ruleId: string; severity: number; }} rule The rule id and severity.
 * @returns {boolean} True if the lint rule should run, false otherwise.
 */
function quietRuleFilter(rule) {
    return rule.severity === 2;
}

/**
 * Translates the CLI options into the options expected by the ESLint constructor.
 * @param {ParsedCLIOptions} cliOptions The CLI options to translate.
 * @param {"flat"|"eslintrc"} [configType="eslintrc"] The format of the
 *      config to generate.
 * @returns {Promise<ESLintOptions>} The options object for the ESLint constructor.
 * @private
 */
async function translateOptions({
    cache,
    cacheFile,
    cacheLocation,
    cacheStrategy,
    config,
    configLookup,
    env,
    errorOnUnmatchedPattern,
    eslintrc,
    ext,
    fix,
    fixDryRun,
    fixType,
    global,
    ignore,
    ignorePath,
    ignorePattern,
    inlineConfig,
    parser,
    parserOptions,
    plugin,
    quiet,
    reportUnusedDisableDirectives,
    reportUnusedDisableDirectivesSeverity,
    resolvePluginsRelativeTo,
    rule,
    rulesdir,
    warnIgnored,
    passOnNoPatterns,
    maxWarnings
}, configType) {

    let overrideConfig, overrideConfigFile;
    const importer = new ModuleImporter();

    if (configType === "flat") {
        overrideConfigFile = (typeof config === "string") ? config : !configLookup;
        if (overrideConfigFile === false) {
            overrideConfigFile = void 0;
        }

        let globals = {};

        if (global) {
            globals = global.reduce((obj, name) => {
                if (name.endsWith(":true")) {
                    obj[name.slice(0, -5)] = "writable";
                } else {
                    obj[name] = "readonly";
                }
                return obj;
            }, globals);
        }

        overrideConfig = [{
            languageOptions: {
                globals,
                parserOptions: parserOptions || {}
            },
            rules: rule ? rule : {}
        }];

        if (reportUnusedDisableDirectives || reportUnusedDisableDirectivesSeverity !== void 0) {
            overrideConfig[0].linterOptions = {
                reportUnusedDisableDirectives: reportUnusedDisableDirectives
                    ? "error"
                    : normalizeSeverityToString(reportUnusedDisableDirectivesSeverity)
            };
        }

        if (parser) {
            overrideConfig[0].languageOptions.parser = await importer.import(parser);
        }

        if (plugin) {
            const plugins = {};

            for (const pluginName of plugin) {

                const shortName = naming.getShorthandName(pluginName, "eslint-plugin");
                const longName = naming.normalizePackageName(pluginName, "eslint-plugin");

                plugins[shortName] = await importer.import(longName);
            }

            overrideConfig[0].plugins = plugins;
        }

    } else {
        overrideConfigFile = config;

        overrideConfig = {
            env: env && env.reduce((obj, name) => {
                obj[name] = true;
                return obj;
            }, {}),
            globals: global && global.reduce((obj, name) => {
                if (name.endsWith(":true")) {
                    obj[name.slice(0, -5)] = "writable";
                } else {
                    obj[name] = "readonly";
                }
                return obj;
            }, {}),
            ignorePatterns: ignorePattern,
            parser,
            parserOptions,
            plugins: plugin,
            rules: rule
        };
    }

    const options = {
        allowInlineConfig: inlineConfig,
        cache,
        cacheLocation: cacheLocation || cacheFile,
        cacheStrategy,
        errorOnUnmatchedPattern,
        fix: (fix || fixDryRun) && (quiet ? quietFixPredicate : true),
        fixTypes: fixType,
        ignore,
        overrideConfig,
        overrideConfigFile,
        passOnNoPatterns
    };

    if (configType === "flat") {
        options.ignorePatterns = ignorePattern;
        options.warnIgnored = warnIgnored;

        /*
         * For performance reasons rules not marked as 'error' are filtered out in quiet mode. As maxWarnings
         * requires rules set to 'warn' to be run, we only filter out 'warn' rules if maxWarnings is not specified.
         */
        options.ruleFilter = quiet && maxWarnings === -1 ? quietRuleFilter : () => true;
    } else {
        options.resolvePluginsRelativeTo = resolvePluginsRelativeTo;
        options.rulePaths = rulesdir;
        options.useEslintrc = eslintrc;
        options.extensions = ext;
        options.ignorePath = ignorePath;
        if (reportUnusedDisableDirectives || reportUnusedDisableDirectivesSeverity !== void 0) {
            options.reportUnusedDisableDirectives = reportUnusedDisableDirectives
                ? "error"
                : normalizeSeverityToString(reportUnusedDisableDirectivesSeverity);
        }
    }

    return options;
}

module.exports = { translateOptions };
