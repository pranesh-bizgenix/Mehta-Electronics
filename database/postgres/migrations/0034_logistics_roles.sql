-- Add operational roles without changing any grant held by an existing role.
INSERT INTO roles(key,name,description,is_system) VALUES
 ('LOGISTICS_LEAD','Logistics lead','Reads operational orders; manages GRN, dispatch and store assignments. No financial access.',true),
 ('STORE_STAFF','Store staff','Reads explicitly assigned orders; records photos and item-code observations only.',true);

INSERT INTO permissions(key,resource,action,description) VALUES
 ('logistics.read','logistics','R','Open the operational logistics workspace'),
 ('logistics.orders.read','logistics','R','Read orders without financial fields'),
 ('logistics.orders.assigned','logistics','R','Read only explicitly assigned orders'),
 ('logistics.grn.read','logistics','R','Read GRN and receiving lines without prices'),
 ('logistics.grn.manage','logistics','W','Create GRN with receipt quantities'),
 ('logistics.grn.post','logistics','A','Independently post non-financial GRN review'),
 ('logistics.dispatch.manage','logistics','W','Dispatch approved orders and confirm delivery'),
 ('logistics.assignment.manage','logistics','W','Assign or revoke store staff access to an order'),
 ('logistics.evidence.write','logistics','W','Append photos and item-code observations on GRN and dispatch');
INSERT INTO role_permissions(role_key,permission_key)
 SELECT 'LOGISTICS_LEAD',key FROM permissions WHERE key LIKE 'logistics.%' AND key<>'logistics.orders.assigned';
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('STORE_STAFF','logistics.read'),('STORE_STAFF','logistics.orders.assigned'),('STORE_STAFF','logistics.evidence.write');

CREATE TABLE logistics_order_assignments (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 sales_order_id integer NOT NULL REFERENCES sales_orders(id),
 user_id integer NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 reason text NOT NULL CHECK(length(trim(reason))>=3),
 created_by integer NOT NULL REFERENCES users(id), updated_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(sales_order_id,user_id)
);
CREATE TABLE logistics_evidence (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 sales_order_id integer NOT NULL REFERENCES sales_orders(id),
 grn_id integer REFERENCES crm_grns(id), shipment_id integer REFERENCES crm_shipments(id),
 kind text NOT NULL CHECK(kind IN ('GRN','DISPATCH')),line_ref text NOT NULL,
 item_code text,photo_name text,photo_mime text,photo_bytes bytea,photo_sha256 text,
 created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='GRN' AND grn_id IS NOT NULL AND shipment_id IS NULL) OR (kind='DISPATCH' AND grn_id IS NULL)),
 CHECK(item_code IS NOT NULL OR photo_bytes IS NOT NULL),
 CHECK(photo_bytes IS NULL OR (photo_mime IN ('image/jpeg','image/png') AND octet_length(photo_bytes)>0 AND photo_sha256 IS NOT NULL))
);
CREATE INDEX logistics_evidence_order_idx ON logistics_evidence(sales_order_id,id);
CREATE FUNCTION logistics_retention_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Logistics records cannot be deleted; evidence is immutable and assignments must be archived with a reason'; END $$;
CREATE TRIGGER logistics_assignment_no_delete BEFORE DELETE OR TRUNCATE ON logistics_order_assignments FOR EACH STATEMENT EXECUTE FUNCTION logistics_retention_guard();
CREATE TRIGGER logistics_evidence_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON logistics_evidence FOR EACH STATEMENT EXECUTE FUNCTION logistics_retention_guard();

INSERT INTO access_matrix_events(role_key,change,new_value,reason)
 SELECT key,'SEED',jsonb_build_object('name',name,'permissions',(SELECT jsonb_agg(permission_key ORDER BY permission_key) FROM role_permissions WHERE role_key=roles.key)),
 '0034 logistics operational roles; existing role grants preserved' FROM roles WHERE key IN ('LOGISTICS_LEAD','STORE_STAFF');
INSERT INTO audit_logs(entity,record_id,action,new_value,reason)
 VALUES('ACCESS_MATRIX','0034_logistics_roles','MIGRATION','{"roles":["LOGISTICS_LEAD","STORE_STAFF"],"existingGrantsUnchanged":true}', 'Add operational logistics roles without financial access or Admin');
