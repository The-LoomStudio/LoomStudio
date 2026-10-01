const fs = require('fs');

const path = 'src/app/studio-panel-registry.tsx';
let content = fs.readFileSync(path, 'utf8');

const target = `    macro: () => <LazyMacroPanel
      macroTargetKey={state.macroTargetKey}
      macroInspection={state.macroInspection}
      buildMacroInspection={state.buildMacroInspection}
      macroInspectionLoading={state.macroInspectionLoading}
      macroInspectionError={state.macroInspectionError}
      macroSelections={state.macroSelections}
      card={state.selectedCardDetails ?? undefined}
      t={state.t}
      onSaveCardMacros={state.updateCardMacros}
      onSelectSource={state.selectMacroSource}
      onRefresh={state.refreshMacros}
    />,`;

const replacement = `    macro: () => {
      const sources: import('../features/state-variables/ui/macro-authoring-panel.js').MacroAuthoringSource[] = []
      
      if (state.selectedCardDetails) {
        const card = state.selectedCardDetails
        sources.push({
          id: card.id,
          kind: 'card',
          label: card.name,
          version: card.version,
          macros: card.macros ?? {},
          macroOptions: card.macroOptions,
          onSave: async input => {
            const updated = await state.updateCardMacros({
              cardId: card.id,
              expectedVersion: input.expectedVersion,
              macros: input.macros,
              macroOptions: input.macroOptions,
            })
            return { version: updated.version, macros: input.macros, macroOptions: input.macroOptions }
          }
        })
      }
      
      if (activePresetId) {
        const preset = state.promptResources.find(r => r.id === activePresetId)
        if (preset) {
          sources.push({
            id: preset.id,
            kind: 'preset',
            label: preset.rootNode.label,
            version: preset.version,
            macros: preset.macros ?? {},
            macroOptions: preset.macroOptions,
            onSave: async input => {
              const updated = await state.updatePresetMacros(preset.id, input)
              return { version: updated.version, macros: input.macros, macroOptions: input.macroOptions }
            }
          })
        }
      }

      return <LazyMacroPanel
        macroTargetKey={state.macroTargetKey}
        macroInspection={state.macroInspection}
        buildMacroInspection={state.buildMacroInspection}
        macroInspectionLoading={state.macroInspectionLoading}
        macroInspectionError={state.macroInspectionError}
        macroSelections={state.macroSelections}
        sources={sources}
        t={state.t}
        onSelectSource={state.selectMacroSource}
        onRefresh={state.refreshMacros}
      />
    },`;

content = content.replace(target, replacement);
fs.writeFileSync(path, content);
