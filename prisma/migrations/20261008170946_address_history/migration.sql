-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AddressState" (
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "confirmed" BIGINT NOT NULL DEFAULT 0,
    "unconfirmed" BIGINT NOT NULL DEFAULT 0,
    "history" TEXT NOT NULL DEFAULT '[]',

    PRIMARY KEY ("chain", "address")
);
INSERT INTO "new_AddressState" ("address", "chain", "confirmed", "status", "unconfirmed", "used") SELECT "address", "chain", "confirmed", "status", "unconfirmed", "used" FROM "AddressState";
DROP TABLE "AddressState";
ALTER TABLE "new_AddressState" RENAME TO "AddressState";
CREATE INDEX "AddressState_chain_used_idx" ON "AddressState"("chain", "used");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
