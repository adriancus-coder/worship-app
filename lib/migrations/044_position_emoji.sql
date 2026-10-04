-- An emoji per team position (🎤 Voce, 🎸 Chitară, …), shown before its name in Echipa, the
-- event's team and the pickers. NULL = none. The default positions get theirs here; new ones
-- get a guess from the name (lib/positions.js), the owner / leader can change it.
ALTER TABLE positions ADD COLUMN emoji TEXT;
UPDATE positions SET emoji = CASE name
  WHEN 'Voce' THEN '🎤'
  WHEN 'Chitară' THEN '🎸'
  WHEN 'Pian/Clape' THEN '🎹'
  WHEN 'Bas' THEN '🎸'
  WHEN 'Tobe' THEN '🥁'
  WHEN 'Operator' THEN '💻'
  WHEN 'Prezentator' THEN '🎙️'
  ELSE NULL END;
