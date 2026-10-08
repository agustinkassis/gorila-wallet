-- CreateTable
CREATE TABLE "Address" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "change" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "scripthash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AddressState" (
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "confirmed" BIGINT NOT NULL DEFAULT 0,
    "unconfirmed" BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY ("chain", "address")
);

-- CreateTable
CREATE TABLE "Utxo" (
    "chain" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "vout" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "height" INTEGER NOT NULL,

    PRIMARY KEY ("chain", "txid", "vout")
);

-- CreateTable
CREATE TABLE "Tx" (
    "chain" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "height" INTEGER NOT NULL,
    "time" INTEGER,
    "amount" BIGINT NOT NULL,
    "fee" BIGINT,
    "vsize" INTEGER,

    PRIMARY KEY ("chain", "txid")
);

-- CreateTable
CREATE TABLE "RawTx" (
    "chain" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "hex" TEXT NOT NULL,

    PRIMARY KEY ("chain", "txid")
);

-- CreateTable
CREATE TABLE "Header" (
    "chain" TEXT NOT NULL,
    "height" INTEGER NOT NULL,
    "time" INTEGER NOT NULL,

    PRIMARY KEY ("chain", "height")
);

-- CreateTable
CREATE TABLE "Label" (
    "chain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "label" TEXT,
    "spendable" BOOLEAN,

    PRIMARY KEY ("chain", "type", "ref")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Address_scripthash_key" ON "Address"("scripthash");

-- CreateIndex
CREATE UNIQUE INDEX "Address_change_index_key" ON "Address"("change", "index");

-- CreateIndex
CREATE INDEX "Utxo_chain_address_idx" ON "Utxo"("chain", "address");

-- CreateIndex
CREATE INDEX "Tx_chain_height_idx" ON "Tx"("chain", "height");
