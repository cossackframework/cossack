import { Worker } from "node:worker_threads";
import config from "./context.config.js";

export default {
  ...config,
  async adapter(context: Parameters<typeof config.adapter>[0]) {
    // Miniflare's binding bridge also evaluates CommonJS in an inherited Worker.
    const worker = new Worker('const { parentPort } = require("node:worker_threads"); parentPort.postMessage("ready");', { eval: true });
    try {
      await new Promise<void>((resolve, reject) => {
        worker.once("message", () => resolve());
        worker.once("error", reject);
      });
    } finally { await worker.terminate(); }
    return config.adapter(context);
  },
};
