-- Multi-wallet. Address/AddressState/Utxo/Tx are an Electrum cache: rebuilt per wallet on the next sync.
-- Labels are user data: existing ones belong to the .env wallet ("env").

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "xpub" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "fingerprint" INTEGER NOT NULL,
    "encSeed" TEXT,
    "passphrase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Account" (
    "pubkey" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cache tables: drop and recreate with walletId
DROP TABLE "Address";
DROP TABLE "AddressState";
DROP TABLE "Utxo";
DROP TABLE "Tx";

-- CreateTable
CREATE TABLE "Address" (
    "walletId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "change" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "scripthash" TEXT NOT NULL,

    PRIMARY KEY ("walletId", "address")
);

-- CreateTable
CREATE TABLE "AddressState" (
    "walletId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "confirmed" BIGINT NOT NULL DEFAULT 0,
    "unconfirmed" BIGINT NOT NULL DEFAULT 0,
    "history" TEXT NOT NULL DEFAULT '[]',

    PRIMARY KEY ("walletId", "chain", "address")
);

-- CreateTable
CREATE TABLE "Utxo" (
    "walletId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "vout" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "height" INTEGER NOT NULL,

    PRIMARY KEY ("walletId", "chain", "txid", "vout")
);

-- CreateTable
CREATE TABLE "Tx" (
    "walletId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "height" INTEGER NOT NULL,
    "time" INTEGER,
    "amount" BIGINT NOT NULL,
    "fee" BIGINT,
    "vsize" INTEGER,

    PRIMARY KEY ("walletId", "chain", "txid")
);

-- CreateIndex
CREATE UNIQUE INDEX "Address_walletId_scripthash_key" ON "Address"("walletId", "scripthash");
-- CreateIndex
CREATE UNIQUE INDEX "Address_walletId_change_index_key" ON "Address"("walletId", "change", "index");
-- CreateIndex
CREATE INDEX "AddressState_walletId_chain_used_idx" ON "AddressState"("walletId", "chain", "used");
-- CreateIndex
CREATE INDEX "Utxo_walletId_chain_address_idx" ON "Utxo"("walletId", "chain", "address");
-- CreateIndex
CREATE INDEX "Tx_walletId_chain_height_idx" ON "Tx"("walletId", "chain", "height");

-- Labels: keep them, scoped to the env wallet
PRAGMA foreign_keys=OFF;
-- CreateTable
CREATE TABLE "new_Label" (
    "walletId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "label" TEXT,
    "spendable" BOOLEAN,

    PRIMARY KEY ("walletId", "chain", "type", "ref")
);

INSERT INTO "new_Label" ("walletId", "chain", "type", "ref", "label", "spendable")
SELECT 'env', "chain", "type", "ref", "label", "spendable" FROM "Label";
DROP TABLE "Label";
ALTER TABLE "new_Label" RENAME TO "Label";
PRAGMA foreign_keys=ON;
