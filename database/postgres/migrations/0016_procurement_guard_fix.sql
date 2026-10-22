-- Forward-only correction: evaluate document fields only for document rows.
CREATE OR REPLACE FUNCTION crm_procurement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Procurement records cannot be deleted or truncated'; END IF;
 IF current_setting('mehta.procurement_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use the procurement service'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='crm_procurement_events' THEN RAISE EXCEPTION 'Procurement audit is immutable'; END IF;
  IF TG_TABLE_NAME='crm_supplier_documents' THEN
   IF NEW.original_bytes IS DISTINCT FROM OLD.original_bytes OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.original_name IS DISTINCT FROM OLD.original_name OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.supplier_po_id IS DISTINCT FROM OLD.supplier_po_id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.byte_count IS DISTINCT FROM OLD.byte_count THEN RAISE EXCEPTION 'Supplier originals are immutable'; END IF;
  END IF;
  NEW.updated_at=now();NEW.created_at=OLD.created_at;NEW.created_by=OLD.created_by;
 END IF;
 RETURN NEW;
END $$;
