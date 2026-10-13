import { spawnSync } from "node:child_process";

for (const [command, args] of [
  [process.platform === "win32" ? "python" : "python3", ["ops/mainland/test-retain-next-static.py"]],
  [process.execPath, ["--import", "./scripts/test-server-context.mjs", "--import", "tsx", "--test", "tests/reader-load-recovery.test.tsx"]],
]) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
