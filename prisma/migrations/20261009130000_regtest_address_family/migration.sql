DROP INDEX "Address_walletId_scripthash_key";
CREATE UNIQUE INDEX "Address_walletId_family_scripthash_key" ON "Address"("walletId", "family", "scripthash");
