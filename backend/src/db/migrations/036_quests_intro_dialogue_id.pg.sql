-- 036_quests_intro_dialogue_id.pg.sql
--
-- Commit 332ba14 changed Quest.intro (an embedded DialogueTree) into
-- Quest.introDialogueId (a reference). The code changed; the stored rows did
-- not, because seedDefaultQuests skips ids that already exist — deliberately,
-- so it never clobbers admin edits to a seeded quest. The result was rows
-- still carrying `intro` while the code read `introDialogueId`, which came
-- back undefined and got written into user_quest_progress.
--
-- The old tree's rootNodeId is exactly the id the .twee sources were authored
-- under (intro.rootNodeId "embers-root" -> data/dialogues/embers-root.twee),
-- so the reference can be derived rather than guessed.
--
-- QuestStep entries of type 'dialogue' also moved from `tree` to `dialogueId`.
-- No row currently has one, and converting a tree there would invent a
-- reference to a dialogue that was never authored, so those are left alone:
-- the Zod schema rejects them loudly rather than failing silently.
UPDATE quests
   SET data = (data - 'intro') || jsonb_build_object('introDialogueId', data->'intro'->>'rootNodeId'),
       updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
 WHERE data ? 'intro'
   AND data->'intro'->>'rootNodeId' IS NOT NULL;
