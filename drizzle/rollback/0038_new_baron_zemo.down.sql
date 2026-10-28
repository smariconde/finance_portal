BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM financial_declarations WHERE common_book IS NOT NULL) THEN
    RAISE EXCEPTION 'owner-transcribed common equity exists; preserve it before rolling back 0038';
  END IF;
END $$;
ALTER TABLE financial_declarations DROP COLUMN common_book;
COMMIT;
