ALTER TABLE "checkout_orders"
  ADD COLUMN "paypal_refund_id" TEXT,
  ADD COLUMN "paypal_refund_requested_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "checkout_orders_paypal_refund_id_key" ON "checkout_orders"("paypal_refund_id");
