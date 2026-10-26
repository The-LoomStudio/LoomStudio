import { createStudioTrpcClient } from '../../../apps/studio-client/src/shared/api/trpc-client.js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { CharacterPanel } from '../../../apps/studio-client/src/widgets/character-panel/character-panel.js'

type Props = ComponentProps<typeof CharacterPanel>

export function characterPanelProps(overrides: Partial<Props> = {}): Props {
  return {
    active: true, busy: false, cards: [], endpoint: 'test',
    resourceApi: createStudioApi(createStudioTrpcClient({ fetch: async () => { throw new Error('Unexpected RPC in rendering test') } })),
    onCreateCard: async () => {},
    onForkCard: async () => {},
    onCreateTimelineFromCard: async () => {},
    onExportCard: async () => {},
    onImportCards: async () => {},
    onDeleteCards: async () => {},
    onPreviewCardDeletion: async () => ({ timelines: [] }),
    onSelectCard: () => {},
    onPreviewCard: () => {},
    onOpenTimeline: () => {},
    onUpdateCardMedia: async () => {},
    onUpdateCardProfile: async () => {},
    onChangeResourceNode: () => {},
    onCommitResourceNode: () => {},
    t: key => key,
    ...overrides,
  }
}

export function renderCharacterPanel(props: Props, timelines: NonNullable<Props['timeline']>[] = []): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const card = props.selectedCard ?? props.cards[0]
  if (card) {
    client.setQueryData(['character-browser', props.endpoint, card.id], { card, timelines })
    client.setQueryData(['card-resource-directory', props.endpoint, card.id, 'card'], { card })
  }
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(CharacterPanel, props)))
  } finally {
    client.clear()
  }
}
