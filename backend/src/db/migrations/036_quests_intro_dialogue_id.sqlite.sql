-- 036_quests_intro_dialogue_id.sqlite.sql
--
-- SQLite counterpart of the Postgres migration of the same number; see that
-- file for why this exists. `data` is TEXT holding JSON here rather than
-- jsonb, so the rewrite goes through json_remove/json_set. Both sides of the
-- expression read the pre-update row, so extracting from `$.intro` after
-- removing it in the same statement is safe.
UPDATE quests
   SET data = json_set(
                json_remove(data, '$.intro'),
                '$.introDialogueId',
                json_extract(data, '$.intro.rootNodeId')
              ),
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE json_extract(data, '$.intro') IS NOT NULL
   AND json_extract(data, '$.intro.rootNodeId') IS NOT NULL;
