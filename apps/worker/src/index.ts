import { startWorker } from "../../../modules/worker/src/worker-service";
import { registerCRMHandoffWorker } from "../../../modules/crm/src/crm-handoff-worker";
import { tko_logger } from "../../../packages/observability/src/logger";

registerCRMHandoffWorker();
const tko_stop = startWorker();
tko_logger.info("Tasko worker started");

for (const tko_signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(tko_signal, () => {
    tko_stop();
    tko_logger.info({ signal: tko_signal }, "Tasko worker stopped");
    process.exit(0);
  });
}
