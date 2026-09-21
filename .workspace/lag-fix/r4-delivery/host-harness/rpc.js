import { control } from './control.js';

export function registerUsageRpc(_ctx, deps) {
  control.rpc = deps;
}
