-- Remove o trigger quebrado (referenciava total_value que foi renomeado para subtotal)
DROP TRIGGER IF EXISTS trg_audit_order_items ON order_items;
DROP FUNCTION IF EXISTS fn_audit_order_items();
