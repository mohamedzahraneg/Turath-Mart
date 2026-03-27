-- Clear all orders and audit logs data
-- Preserves table structure, inventory, products, and images
-- No schema changes - data deletion only

-- Delete all audit logs first (no foreign key constraint but good practice)
DELETE FROM public.order_audit_logs;

-- Delete all orders
DELETE FROM public.zahranship_orders;
