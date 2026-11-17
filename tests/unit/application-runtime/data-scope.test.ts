import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  readTimelineCardId,
  resolveTimelineOperationScope,
  timelineOperationScope,
} from '../../../packages/application-runtime/src/data/scope.js'

describe('timeline data commit operation scope helpers', () => {
  it('returns undefined when narrative_timelines table does not exist yet', () => {
    const database = new DatabaseSync(':memory:')
    try {
      expect(readTimelineCardId(database, 'timeline-1')).toBeUndefined()
      expect(resolveTimelineOperationScope(database, 'timeline-1')).toEqual({
        store: 'narrative',
        entityType: 'narrative.timeline',
        entityId: 'timeline-1',
        timelineId: 'timeline-1',
      })
    } finally {
      database.close()
    }
  })

  it('resolves created_from_card_id from narrative_timelines and builds upfront scope tags', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec(`
        CREATE TABLE narrative_timelines (
          id TEXT PRIMARY KEY,
          created_from_card_id TEXT
        );
        INSERT INTO narrative_timelines (id, created_from_card_id) VALUES
          ('tl-card', 'card-42'),
          ('tl-empty', ''),
          ('tl-null', NULL);
      `)

      expect(readTimelineCardId(database, 'tl-card')).toBe('card-42')
      expect(readTimelineCardId(database, 'tl-empty')).toBeUndefined()
      expect(readTimelineCardId(database, 'tl-null')).toBeUndefined()
      expect(readTimelineCardId(database, 'tl-missing')).toBeUndefined()

      expect(timelineOperationScope('tl-card', 'card-42')).toEqual({
        store: 'narrative',
        entityType: 'narrative.timeline',
        entityId: 'tl-card',
        timelineId: 'tl-card',
        cardId: 'card-42',
      })
      expect(resolveTimelineOperationScope(database, 'tl-card')).toEqual({
        store: 'narrative',
        entityType: 'narrative.timeline',
        entityId: 'tl-card',
        timelineId: 'tl-card',
        cardId: 'card-42',
      })
      expect(resolveTimelineOperationScope(database, 'tl-null')).toEqual({
        store: 'narrative',
        entityType: 'narrative.timeline',
        entityId: 'tl-null',
        timelineId: 'tl-null',
      })
    } finally {
      database.close()
    }
  })
})
