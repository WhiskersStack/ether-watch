-- Stage 2 only: never package until retirement is live and the drain gate has passed.
-- Invalid/missing settings, or a mismatched copy at the same revision, abort before any DROP.
CREATE TABLE retirement_purge_check (ok INTEGER NOT NULL CHECK(ok=1));
--> statement-breakpoint
INSERT INTO retirement_purge_check
SELECT CASE WHEN (SELECT count(*) FROM dashboard_settings)=1 AND NOT EXISTS(
  SELECT 1 FROM monitor m JOIN dashboard_settings s ON s.id=m.id
  WHERE json_type(m.data,'$.config.revision') IS NOT 'integer'
    OR json_extract(m.data,'$.config.revision') < 1
    OR s.revision < json_extract(m.data,'$.config.revision')
    OR (s.revision=json_extract(m.data,'$.config.revision') AND (
      s.s3 IS NOT json_extract(m.data,'$.config.levels.S3') OR s.s2 IS NOT json_extract(m.data,'$.config.levels.S2') OR s.s1 IS NOT json_extract(m.data,'$.config.levels.S1') OR s.r1 IS NOT json_extract(m.data,'$.config.levels.R1') OR s.r2 IS NOT json_extract(m.data,'$.config.levels.R2') OR s.r3 IS NOT json_extract(m.data,'$.config.levels.R3')
    ))
) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE push_subscriptions;
--> statement-breakpoint
DROP TABLE monitor;
--> statement-breakpoint
DROP TABLE retirement_purge_check;
