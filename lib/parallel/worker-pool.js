"use strict";

const { fork } = require("child_process");
const path = require("path");
const os = require("os");

const debug = require("debug")("eslint:parallel");

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

        /** @type {Array<{worker: cluster.Worker; active: number; workerId: number }>} */
        this.workers = [];

        /** @type {number} */
        this.workIdCounter = 0;

        /** @type {number} */
        this.nextWorkerId = 1;

        /** @type {number} */
        this.activeTasks = 0;

        /** @type {(() => void)[]} */
        this.subscriptions = [];

        /** @type {number} */
        this.maxSize = os.cpus().length - 1;
    }

    /**
     * Schedules the given files to be linted.
     * @param {string[]} files Files to be linted
     * @returns {undefined}
     */
    run(files) {
        if (this.workers.length < this.maxSize) {
            this.spawnWorker();
        }

        this.activeTasks += 1;

        const target = this.workers[0];
        const id = this.workIdCounter++;

        target.active++;
        this.sortWorkers();

        debug(`Submitting parallel job of ${files.length} files with id ${id} to worker ${target.workerId}`);
        target.worker.send({ type: "files", files, id });
    }

    async getResults() {
        const reportPromises = this.workers.map(({ worker }) => new Promise(resolve => {

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

        const reports = await Promise.all(reportPromises);

        return { results: reports.flatMap(report => report.results), timingData: reports.map(report => report.timingData) };
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

    /**
     * Stop all the current worker processes.
     * @returns {undefined}
     */
    spinDown() {
        for (const { worker } of this.workers) {
            worker.kill();
        }

        this.workers = [];
    }

    spawnWorker() {
        const workerId = this.nextWorkerId++;

        debug(`Spawning new parallel engine worker (${workerId})`);
        const worker = fork(path.join(__dirname, "parallel-engine-worker.js"));

        this.workers.unshift({ worker, active: 0, workerId });
        worker.on("message", message => {
            if (message.type === "done") {
                this.activeTasks -= 1;
                worker.active--;
                this.sortWorkers();
                this._sendTaskCompleted();
            }
        });

        worker.send({ type: "init", options: this.options, workerId });
    }
}

module.exports = { WorkerPool, WorkerExitedError };
