import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const playwrightCli = fileURLToPath(
  new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
);

process.env.VITE_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_local_browser_test";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:54321";

const server = await createServer({
  root: projectRoot,
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});

try {
  await server.listen();
  const exitCode = await new Promise((resolve, reject) => {
    const testProcess = spawn(
      process.execPath,
      [playwrightCli, "test", ...process.argv.slice(2)],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          DIARY_E2E_SERVER_READY: "1",
        },
        stdio: "inherit",
      },
    );
    testProcess.once("error", reject);
    testProcess.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally {
  await server.close();
}
