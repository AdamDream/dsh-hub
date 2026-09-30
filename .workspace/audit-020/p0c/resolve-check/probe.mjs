const mod = await import("@local/dsh-office-route-b");
const core = await import("@local/dsh-office-route-b/core");
console.log("bare-name resolve OK:", mod.name, Object.keys(mod).sort().join(","));
console.log("subpath export OK:", typeof core.verifyToken);
