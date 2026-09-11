# Character Status Text Pipeline

This sample keeps text processing declarative and rendering sandboxed:

1. Import `character-status.rule.json` and `character-status.extractor.json` for the target Card owner.
2. Import `alice-presentation.loom.js` for the same Card.
3. Create a Mount for the imported Script. New Mounts are disabled and have no grants.
4. Review the requested `state.read` capability, grant it only when needed, then enable the Mount.

The Rule marks `<CharacterStatus>...</CharacterStatus>` without changing text. The Extractor emits `loom.character-status`. The Script contributes an inline Match renderer and a Timeline summary Artifact renderer.
