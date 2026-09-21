import { workerData, parentPort } from "node:worker_threads";
parentPort.postMessage({ gotDb: typeof workerData.db, ctor: workerData.db?.constructor?.name ?? null });
