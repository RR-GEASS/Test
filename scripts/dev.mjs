import { spawn } from "node:child_process";
const children = [];
const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop();
    process.exit(0);
  });
for (const [script, args, environment] of [
  [
    "server/index.js",
    [],
    { PORT: process.env.SCI_API_PORT || "3001", NODE_ENV: "development" },
  ],
  ["node_modules/vite/bin/vite.js", process.argv.slice(2), {}],
]) {
  const child = spawn(process.execPath, [script, ...args], {
    stdio: "inherit",
    env: { ...process.env, ...environment },
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop();
    process.exit(1);
  });
  child.on("exit", (code) => {
    stop();
    process.exit(code || 0);
  });
}
