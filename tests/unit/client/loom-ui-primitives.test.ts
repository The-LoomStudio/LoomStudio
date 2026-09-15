import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Button, Field, IconButton, SearchField, TextInput } from '@loom-studio/ui'

describe('@loom-studio/ui primitives', () => {
  it('keeps native button semantics and accessible icon labels', () => {
    const html = renderToStaticMarkup(createElement('div', null,
      createElement(Button, null, 'Default'),
      createElement(Button, { disabled: true, type: 'submit' }, 'Submit'),
      createElement(IconButton, { 'aria-label': 'Refresh' }, 'R'),
    ))

    expect(html).toContain('data-loom-ui-button=""')
    expect(html).toContain('type="button"')
    expect(html).toContain('disabled="" type="submit"')
    expect(html).toContain('aria-label="Refresh"')
  })

  it('associates field help and errors with its control', () => {
    const html = renderToStaticMarkup(createElement(Field, {
      id: 'display-name',
      label: 'Display name',
      description: 'Shown to readers',
      error: 'Required',
      children: controlProps => createElement(TextInput, { ...controlProps, readOnly: true, value: '' }),
    }))

    expect(html).toContain('for="display-name"')
    expect(html).toContain('id="display-name"')
    expect(html).toContain('aria-describedby="display-name-description"')
    expect(html).toContain('aria-errormessage="display-name-error"')
    expect(html).toContain('aria-invalid="true"')
  })

  it('renders the shared search contract', () => {
    const html = renderToStaticMarkup(createElement(SearchField, {
      'aria-label': 'Search',
      clearLabel: 'Clear search',
      value: 'loom',
      onChange: vi.fn(),
      onClear: vi.fn(),
    }))

    expect(html).toContain('type="search"')
    expect(html).toContain('aria-label="Clear search"')
  })
})
