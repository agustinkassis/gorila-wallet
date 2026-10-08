// Desktop entry, run by the Tauri shell on the bundled Node: apply pending migrations, then start the Next.js server.
import { createHash, randomUUID } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"

// The shell holds our stdin: when the app quits or crashes the pipe closes, and the server goes with it.
process.stdin.on("end", () => process.exit()).resume()

// Same bookkeeping as `prisma migrate deploy` (table, sha256 checksum, ms timestamps), so either can manage the file.
// Scripts run as-is, like Prisma does: their own PRAGMAs handle foreign keys while tables are redefined.
const Database = createRequire(import.meta.url)("better-sqlite3")
const db = new Database(process.env.DATABASE_URL.replace(/^file:/, ""))
db.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT PRIMARY KEY NOT NULL, "checksum" TEXT NOT NULL, "finished_at" DATETIME, "migration_name" TEXT NOT NULL,
  "logs" TEXT, "rolled_back_at" DATETIME, "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
  "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)`)
const applied = new Set(db.prepare(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`).pluck().all())
for (const name of readdirSync("migrations").sort()) {
  const file = `migrations/${name}/migration.sql`
  if (applied.has(name) || !existsSync(file)) continue
  const sql = readFileSync(file, "utf8")
  const started = Date.now()
  db.exec(sql)
  db.prepare(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)`)
    .run(randomUUID(), createHash("sha256").update(sql).digest("hex"), Date.now(), name, started)
  console.log(`applied migration ${name}`)
}
db.close()

await import("./server.js")
