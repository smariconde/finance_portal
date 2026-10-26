import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { expiredBackupManifests } from "./backup-neon-retention";

/** Private operational backup. Run with `node --env-file=.env.neon.local --import tsx`. */
const connection = process.env.DATABASE_DIRECT_URL;
if (!connection) throw new Error("DATABASE_DIRECT_URL is required");

const database = new URL(connection);
if (
  !database.hostname.endsWith(".neon.tech") ||
  database.hostname.includes("-pooler.")
) {
  throw new Error("The backup requires a direct Neon connection");
}

const directory = join(homedir(), ".local/share/finance-portal/backups");
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);

const createdAt = new Date().toISOString();
const basename = `finance-portal-neon-${createdAt.replaceAll(":", "-").replaceAll(".", "-")}`;
const partial = join(directory, `.${basename}.partial`);
const dump = join(directory, `${basename}.dump`);
const manifest = join(directory, `${basename}.json`);

async function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.resume(); // Never print connection details from a provider error.
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

const env = {
  ...process.env,
  PGPASSWORD: decodeURIComponent(database.password),
  PGSSLMODE: database.searchParams.get("sslmode") ?? "require",
  PGCHANNELBINDING: database.searchParams.get("channel_binding") ?? "prefer",
  PGCONNECT_TIMEOUT: "15",
};

try {
  await run(
    "pg_dump",
    [
      "--format=custom",
      "--compress=9",
      "--no-owner",
      "--no-acl",
      "--host",
      database.hostname,
      "--port",
      database.port || "5432",
      "--username",
      decodeURIComponent(database.username),
      "--dbname",
      database.pathname.slice(1),
      "--file",
      partial,
    ],
    env,
  );

  const listing = await run("pg_restore", ["--list", partial], process.env);
  const tableCount = listing
    .split("\n")
    .filter((line) => line.includes("TABLE DATA")).length;
  if (tableCount === 0) throw new Error("Backup has no table data entries");

  const digest = createHash("sha256");
  for await (const chunk of createReadStream(partial)) digest.update(chunk);
  const bytes = (await stat(partial)).size;
  const sha256 = digest.digest("hex");
  await rename(partial, dump);
  await writeFile(
    manifest,
    JSON.stringify({ createdAt, bytes, sha256, tableCount }) + "\n",
    { mode: 0o600 },
  );

  // Retain at least the two newest verified archives, plus every archive from
  // the previous 30 days. An unverified or manually named file is untouched.
  const manifestNames = (await readdir(directory))
    .filter((name) => /^finance-portal-neon-.*\.json$/.test(name))
    .sort();
  const manifests = await Promise.all(
    manifestNames.map(async (name) => {
      const metadata = JSON.parse(
        await readFile(join(directory, name), "utf8"),
      ) as { createdAt: string };
      return { name, createdAt: metadata.createdAt };
    }),
  );
  for (const name of expiredBackupManifests(manifests, Date.now())) {
    const oldDump = join(directory, name.replace(/\.json$/, ".dump"));
    await unlink(oldDump);
    await unlink(join(directory, name));
  }

  console.log(
    `Backup verified: ${bytes} bytes, ${tableCount} tables, SHA-256 ${sha256}`,
  );
} catch (error) {
  await unlink(partial).catch(() => {});
  throw error;
}
