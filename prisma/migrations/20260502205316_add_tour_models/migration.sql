-- CreateTable
CREATE TABLE "tour_operators" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "email" TEXT,
    "notify_channel" TEXT NOT NULL DEFAULT 'kakao',
    "public_token" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tours" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "operator_id" TEXT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "meeting_point" TEXT,
    "duration_min" INTEGER,
    "base_price" DECIMAL(65,30),
    "max_group_size" INTEGER,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_schedules" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "booked_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tour_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_bookings" (
    "id" TEXT NOT NULL,
    "tour_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "guests" INTEGER NOT NULL DEFAULT 1,
    "total_price" DECIMAL(65,30),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "forwarded_at" TIMESTAMP(3),
    "message" TEXT,
    "source" TEXT NOT NULL DEFAULT 'direct',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tour_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tour_operators_public_token_key" ON "tour_operators"("public_token");

-- CreateIndex
CREATE INDEX "tour_operators_owner_id_idx" ON "tour_operators"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "tours_slug_key" ON "tours"("slug");

-- CreateIndex
CREATE INDEX "tours_owner_id_idx" ON "tours"("owner_id");

-- CreateIndex
CREATE INDEX "tours_operator_id_idx" ON "tours"("operator_id");

-- CreateIndex
CREATE UNIQUE INDEX "tour_schedules_tour_id_date_start_time_key" ON "tour_schedules"("tour_id", "date", "start_time");

-- CreateIndex
CREATE INDEX "tour_schedules_date_status_idx" ON "tour_schedules"("date", "status");

-- CreateIndex
CREATE INDEX "tour_bookings_tour_id_status_idx" ON "tour_bookings"("tour_id", "status");

-- CreateIndex
CREATE INDEX "tour_bookings_schedule_id_idx" ON "tour_bookings"("schedule_id");

-- AddForeignKey
ALTER TABLE "tour_operators" ADD CONSTRAINT "tour_operators_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tours" ADD CONSTRAINT "tours_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tours" ADD CONSTRAINT "tours_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "tour_operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_schedules" ADD CONSTRAINT "tour_schedules_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_bookings" ADD CONSTRAINT "tour_bookings_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_bookings" ADD CONSTRAINT "tour_bookings_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "tour_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
