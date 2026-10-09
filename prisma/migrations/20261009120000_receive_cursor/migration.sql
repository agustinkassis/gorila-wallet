CREATE TABLE "ReceiveCursor" (
    "walletId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "index" INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("walletId", "family")
);
