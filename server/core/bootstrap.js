import { reconcileTrackedProcesses } from "./processManager.js";
import { revokeStaleTaskLeases } from "./taskLifecycle.js";
import { seedCoreToolRegistry } from "./toolRegistryService.js";

let bootstrapped = false;

export function bootstrapCoreRuntime() {
  if (bootstrapped) {
    return {
      bootstrapped: true,
      reused: true
    };
  }

  seedCoreToolRegistry();
  const zombifiedProcessCount = reconcileTrackedProcesses();
  const revokedLeaseCount = revokeStaleTaskLeases();
  bootstrapped = true;

  return {
    bootstrapped: true,
    reused: false,
    zombifiedProcessCount,
    revokedLeaseCount
  };
}
