"use strict";

const cluster = require("cluster");
const path = require("path");

/**
 * Error thrown when a worker process exits unexpectedly.
 */
class WorkerExitedError extends Error {

    /**
     * @param {number | string} codeOrSignal Signal sent when the worker exited
     */
    constructor(codeOrSignal) {
        super(`Worker exited with unexpected ${codeOrSignal} code`);
    }
}

/**
 * Pool of workers.
 */
class WorkerPool {

    /**
     * @param {import("../options").ParsedCLIOptions} options Options to send to spawned workers
     */
    constructor(options) {
        this.options = options;

        /** @type {Array<{worker: cluster.Worker; active: number }>} */
        this.workers = [];

        /** @type {number} */
        this.workIdCounter = 0;

        /** @type {number} */
        this.activeTasks = 0;

        /** @type {(() => void)[]} */
        this.subscriptions = [];
    }

    /**
     * Maximum size of the worker pool.
     * @returns {number} Maximum concurrency of the pool
     */
    get maxSize() {
        return this.options.concurrency;
    }

    /**
     * Schedules the given files to be linted.
     * @param {string[]} files Files to be linted
     * @returns {undefined}
     */
    run(files) {
        if (this.workers.length < this.options.concurrency) {
            this.spawnWorker();
        }

        this.activeTasks += 1;

        const target = this.workers[0];
        const id = this.workIdCounter++;

        target.active++;
        this.sortWorkers();

        target.worker.send({ type: "files", files, id });
    }

    async getReports() {
        const reports = this.workers.map(worker => new Promise(resolve => {

            /**
             * Handle the report
             * @param {any} message the message
             * @returns {undefined}
             */
            function handleReport(message) {
                if (message.type !== "reportback") {
                    return;
                }

                resolve(message.report);
                worker.off("message", handleReport);
            }

            worker.on("message", handleReport);
            worker.send({ type: "report" });
        }));

        return Promise.all(reports);
    }

    sortWorkers() {
        this.workers.sort((a, b) => a.active - b.active);
    }

    onTaskCompleted(callback) {
        this.subscriptions.push(callback);
    }

    _sendTaskCompleted() {
        for (const sub of this.subscriptions) {
            sub();
        }
    }


    spawnWorker() {
        const worker = cluster.fork(path.join(__dirname, "parallel-engine-worker.js"));

        this.workers.unshift({ worker, active: 0 });
        worker.on("message", message => {
            if (message.type === "done") {
                this.activeTasks -= 1;
                worker.active--;
                this.sortWorkers();
                this._sendTaskCompleted();
            }
        });

        worker.send({ type: "init", options: this.options });
    }
}

module.exports = { WorkerPool, WorkerExitedError };
