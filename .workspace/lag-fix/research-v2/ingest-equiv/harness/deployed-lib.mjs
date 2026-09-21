/** Deployed (real) plugin under test — read-only import, never modified. */
import { join } from "node:path";
import { homedir } from "node:os";
export const DEPLOYED_LIB = join(homedir(), ".dsh", "profiles", "node_modules", "@local", "dsh-usage", "lib");
export const loadDeployed = (name) => import(join(DEPLOYED_LIB, name));
