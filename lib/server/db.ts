import "server-only"
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3"
import { PrismaClient } from "@/lib/generated/prisma/client"

const url = process.env.DATABASE_URL ?? "file:./data/wallet.db"

function connect() {
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
  // WAL: readers (API routes) never block the sync writer.
  void db.$queryRawUnsafe("PRAGMA journal_mode=WAL").catch(() => {})
  return db
}

const g = globalThis as typeof globalThis & { db?: PrismaClient }
export const db = (g.db ??= connect())
