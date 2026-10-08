-- Networks: a wallet gets one account per family of chains (WalletAccount), and its addresses are scoped by family.
-- Wallet.xpub/path/fingerprint move to WalletAccount as the "main" account (every existing wallet is mainnet).

-- CreateTable
CREATE TABLE "WalletAccount" (
    "walletId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "xpub" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "fingerprint" INTEGER NOT NULL,

    PRIMARY KEY ("walletId", "family")
);
INSERT INTO "WalletAccount" ("walletId", "family", "xpub", "path", "fingerprint") SELECT "id", 'main', "xpub", "path", "fingerprint" FROM "Wallet";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Address" (
    "walletId" TEXT NOT NULL,
    "family" TEXT NOT NULL DEFAULT 'main',
    "address" TEXT NOT NULL,
    "change" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "scripthash" TEXT NOT NULL,

    PRIMARY KEY ("walletId", "address")
);
INSERT INTO "new_Address" ("address", "change", "index", "scripthash", "walletId") SELECT "address", "change", "index", "scripthash", "walletId" FROM "Address";
DROP TABLE "Address";
ALTER TABLE "new_Address" RENAME TO "Address";
CREATE UNIQUE INDEX "Address_walletId_scripthash_key" ON "Address"("walletId", "scripthash");
CREATE UNIQUE INDEX "Address_walletId_family_change_index_key" ON "Address"("walletId", "family", "change", "index");
CREATE TABLE "new_Wallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "encSeed" TEXT,
    "passphrase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Wallet" ("createdAt", "encSeed", "id", "kind", "name", "passphrase") SELECT "createdAt", "encSeed", "id", "kind", "name", "passphrase" FROM "Wallet";
DROP TABLE "Wallet";
ALTER TABLE "new_Wallet" RENAME TO "Wallet";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
