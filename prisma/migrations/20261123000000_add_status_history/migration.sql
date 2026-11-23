-- CreateTable
CREATE TABLE "status_history" (
    "id" TEXT NOT NULL,
    "entity_type" "EventEntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "actor_id" TEXT,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_history_entity_type_entity_id_idx" ON "status_history"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "status_history_entity_id_at_idx" ON "status_history"("entity_id", "at");

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
