-- Bulk data for the stress suite (load/run.mjs). Clones the demo seed rows
-- with fresh ids so list, dashboard, search and export routes run against
-- tens of thousands of rows instead of a handful. Rows that would break a
-- unique constraint are skipped (ON CONFLICT DO NOTHING). Local only: never
-- run against a shared or production database.
DO $$
DECLARE
  spec record;
  cols text;
  sel text;
  before bigint;
  after bigint;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('companies', 2000),
      ('opportunities', 20000),
      ('contacts', 20000),
      ('leads', 20000),
      ('tasks', 20000),
      ('notes', 10000),
      ('activities', 20000)
    ) AS t(tbl, target_rows)
  LOOP
    IF to_regclass(spec.tbl) IS NULL THEN
      CONTINUE;
    END IF;
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
           string_agg(
             CASE WHEN column_name = 'id' THEN 'gen_random_uuid()'
                  -- Unique per org: suffix with the copy number so clones fit.
                  WHEN column_name = 'email' THEN 'regexp_replace(src.email, ''@'', ''+'' || g.n || ''@'')'
                  WHEN column_name IN ('code', 'domain') THEN 'src.' || quote_ident(column_name) || ' || ''-'' || g.n'
                  WHEN column_name = 'name' AND spec.tbl = 'companies' THEN 'src.name || '' '' || g.n'
                  ELSE 'src.' || quote_ident(column_name) END,
             ', ' ORDER BY ordinal_position)
      INTO cols, sel
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = spec.tbl
       AND is_generated = 'NEVER' AND generation_expression IS NULL;
    EXECUTE format('SELECT count(*) FROM %I', spec.tbl) INTO before;
    IF before = 0 OR before >= spec.target_rows THEN
      RAISE NOTICE '% rows: % (unchanged)', spec.tbl, before;
      CONTINUE;
    END IF;
    EXECUTE format(
      'INSERT INTO %I (%s) SELECT %s FROM %I src CROSS JOIN generate_series(1, %s) AS g(n) ' ||
      'WHERE src.id IN (SELECT id FROM %I LIMIT 50) ON CONFLICT DO NOTHING',
      spec.tbl, cols, sel, spec.tbl, ceil(spec.target_rows::numeric / GREATEST(LEAST(before, 50), 1))::int, spec.tbl);
    EXECUTE format('SELECT count(*) FROM %I', spec.tbl) INTO after;
    RAISE NOTICE '% rows: % -> %', spec.tbl, before, after;
  END LOOP;
END $$;
ANALYZE;
