-- Bridge SV -> worship (stage 8b): the projector source "Traducere · <limbă>". The source
-- itself is already an allowed projector_source ('translation', migration 007); this remembers
-- WHICH target language the operator picked. The translated text is not stored here — it streams
-- from SV over the bridge socket and is merged onto the projector frame (lib/projector.js).
-- NULL until a translation language is picked. Shown only while projector_source = 'translation'.
ALTER TABLE live_state ADD COLUMN translation_lang TEXT;
