-- Stage 1: copy and verify only chart settings, then disarm/cancel legacy work.
-- Run only after the linked schedule and runtime processing are disabled.
CREATE TABLE dashboard_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
  s3 REAL NOT NULL CHECK(typeof(s3) IN ('integer','real') AND s3>0 AND s3<=90071992547409.91 AND abs(s3*100-round(s3*100))<0.0000001),
  s2 REAL NOT NULL CHECK(typeof(s2) IN ('integer','real') AND s2>0 AND s2<=90071992547409.91 AND abs(s2*100-round(s2*100))<0.0000001),
  s1 REAL NOT NULL CHECK(typeof(s1) IN ('integer','real') AND s1>0 AND s1<=90071992547409.91 AND abs(s1*100-round(s1*100))<0.0000001),
  r1 REAL NOT NULL CHECK(typeof(r1) IN ('integer','real') AND r1>0 AND r1<=90071992547409.91 AND abs(r1*100-round(r1*100))<0.0000001),
  r2 REAL NOT NULL CHECK(typeof(r2) IN ('integer','real') AND r2>0 AND r2<=90071992547409.91 AND abs(r2*100-round(r2*100))<0.0000001),
  r3 REAL NOT NULL CHECK(typeof(r3) IN ('integer','real') AND r3>0 AND r3<=90071992547409.91 AND abs(r3*100-round(r3*100))<0.0000001),
  CHECK(s3<s2 AND s2<s1 AND s1<r1 AND r1<r2 AND r2<r3)
);
--> statement-breakpoint
INSERT INTO dashboard_settings (id,revision,s3,s2,s1,r1,r2,r3)
SELECT 1,CASE WHEN json_type(data,'$.config.revision') = 'integer' THEN json_extract(data,'$.config.revision') ELSE NULL END,CASE WHEN json_type(data,'$.config.levels.S3') IN ('integer','real') THEN json_extract(data,'$.config.levels.S3') ELSE NULL END,CASE WHEN json_type(data,'$.config.levels.S2') IN ('integer','real') THEN json_extract(data,'$.config.levels.S2') ELSE NULL END,CASE WHEN json_type(data,'$.config.levels.S1') IN ('integer','real') THEN json_extract(data,'$.config.levels.S1') ELSE NULL END,CASE WHEN json_type(data,'$.config.levels.R1') IN ('integer','real') THEN json_extract(data,'$.config.levels.R1') ELSE NULL END,CASE WHEN json_type(data,'$.config.levels.R2') IN ('integer','real') THEN json_extract(data,'$.config.levels.R2') ELSE NULL END,CASE WHEN json_type(data,'$.config.levels.R3') IN ('integer','real') THEN json_extract(data,'$.config.levels.R3') ELSE NULL END
FROM monitor WHERE id=1;
--> statement-breakpoint
INSERT INTO dashboard_settings(id,revision,s3,s2,s1,r1,r2,r3)
SELECT 1,1,2320,2373,2416,2554,2683,2813 WHERE NOT EXISTS(SELECT 1 FROM monitor WHERE id=1);
--> statement-breakpoint
CREATE TABLE retirement_settings_check (ok INTEGER NOT NULL CHECK(ok=1));
--> statement-breakpoint
INSERT INTO retirement_settings_check
SELECT CASE WHEN (SELECT count(*) FROM dashboard_settings)=1 AND NOT EXISTS(
  SELECT 1 FROM monitor m JOIN dashboard_settings s ON s.id=m.id
  WHERE s.revision IS NOT json_extract(m.data,'$.config.revision')
    OR s.s3 IS NOT json_extract(m.data,'$.config.levels.S3') OR s.s2 IS NOT json_extract(m.data,'$.config.levels.S2') OR s.s1 IS NOT json_extract(m.data,'$.config.levels.S1') OR s.r1 IS NOT json_extract(m.data,'$.config.levels.R1') OR s.r2 IS NOT json_extract(m.data,'$.config.levels.R2') OR s.r3 IS NOT json_extract(m.data,'$.config.levels.R3')
) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE retirement_settings_check;
--> statement-breakpoint
UPDATE monitor SET version=version+1,data=json_set(data,
  '$.config.armed',json('false'),'$.background.enabled',json('false'),
  '$.pushJobs',json(COALESCE((
    SELECT json_group_array(json(CASE WHEN json_extract(value,'$.state') IN ('queued','retry','sending')
      THEN json_set(value,'$.state','cancelled','$.lastError','Alerts permanently retired')
      ELSE value END))
    FROM json_each(monitor.data,'$.pushJobs')
  ),'[]')));
