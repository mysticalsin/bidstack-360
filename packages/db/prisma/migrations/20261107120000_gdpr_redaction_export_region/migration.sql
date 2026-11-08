-- GDPR erasure: replace a subject's identifiers inside jsonb values (strings and
-- object keys, recursively) without touching numbers, booleans or structure.
CREATE OR REPLACE FUNCTION gdpr_redact_jsonb(j jsonb, re text, repl text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE jsonb_typeof(j)
    WHEN 'string' THEN to_jsonb(regexp_replace(j #>> '{}', re, repl, 'gi'))
    WHEN 'array' THEN coalesce(
      (SELECT jsonb_agg(gdpr_redact_jsonb(e, re, repl) ORDER BY i)
         FROM jsonb_array_elements(j) WITH ORDINALITY AS t(e, i)),
      '[]'::jsonb)
    WHEN 'object' THEN coalesce(
      (SELECT jsonb_object_agg(regexp_replace(k, re, repl, 'gi'), gdpr_redact_jsonb(v, re, repl))
         FROM jsonb_each(j) AS t(k, v)),
      '{}'::jsonb)
    ELSE j
  END;
END
$$;

-- Data residency: the region whose bucket holds a tenant export archive, so a
-- download signs against the bucket it was written to even if the org's
-- region changes later. NULL means the default bucket.
ALTER TABLE "tenant_exports" ADD COLUMN "storage_region" VARCHAR(8);
