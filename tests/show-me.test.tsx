import { expect, test } from 'claude-code/testing'

const TOOL = 'mcp__show-me__show'
// a 1×1 PNG stands in for every picture
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg=='

const VIEW = {
  kind: 'pdf', title: 'Offer.pdf', source: '/tmp/Offer.pdf', total: 3,
  pages: [1, 2, 3].map(n => ({ png: `/tmp/p-${n}.png`, jpg: `/tmp/v-${n}.jpg`, w: 900, h: 1270, name: `Page ${n}` })),
  before: [{ png: '/tmp/old.png', jpg: '/tmp/old.jpg', w: 900, h: 1270, name: 'Page 1' }],
  beforeSource: '/tmp/Offer-old.pdf',
}

const ROW = (surface: 'terminal' | 'mobile' | 'desktop') => ({
  plugin: 'show-me',
  component: 'ToolResult',
  requestId: 'toolu_1',
  surface,
  props: { tool_use_id: 'toolu_1', tool: TOOL, output: 'ok', isErrored: false },
}) as const

function stubHost(on: any) {
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'LANG' ? 'en_US.UTF-8' : undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'Darwin', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', () => ({ value: { base64: PNG } }))
}

test('a PDF viewer shows its title, page, paging and before/after on every surface', async ($, on) => {
  stubHost(on)
  on('state.get', (_, e) =>
    (e as { key: string }).key === 'views'
      ? { value: { value: { shape: 'views-1', value: { toolu_1: VIEW } }, version: 1 } }
      : { value: { value: { shape: 'positions-1', value: {} }, version: 1 } },
  )
  for (const surface of ['terminal', 'mobile', 'desktop'] as const) {
    const ui = await $.ui.mount(ROW(surface))
    const heading = await ui.find({ type: 'Text', text: /Offer\.pdf/ })
    expect(heading?.text).toContain('Page 1 of 3')
    expect(await ui.find({ type: 'Button', key: 'next' })).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'mode-both' })).toBeTruthy()
    await ui.unmount()
  }
})

test('Hide folds the picture away and leaves heading, Show and Open; unfolded it draws again', async ($, on) => {
  stubHost(on)
  let hidden = true // the stub below reads it; hooks beneath are registered before the first $ call
  on('state.get', (_, e) =>
    (e as { key: string }).key === 'views'
      ? { value: { value: { shape: 'views-1', value: { toolu_1: VIEW } }, version: 1 } }
      : { value: { value: { shape: 'positions-1', value: { toolu_1: { page: 0, mode: 'after', hidden } } }, version: 1 } },
  )
  for (const fold of [true, false]) {
    hidden = fold
    for (const surface of ['terminal', 'mobile'] as const) {
      const ui = await $.ui.mount(ROW(surface))
      expect(await ui.find({ type: 'Text', text: /Offer\.pdf/ })).toBeTruthy()
      expect((await ui.find({ type: 'Button', key: 'fold' }))?.text).toBe(hidden ? 'Show' : 'Hide')
      expect(Boolean(await ui.find({ type: surface === 'terminal' ? 'Image' : 'Svg' }))).toBe(!hidden)
      expect(Boolean(await ui.find({ type: 'Button', key: 'next' }))).toBe(!hidden)
      if (surface === 'terminal') expect(await ui.find({ type: 'Button', key: 'open' })).toBeTruthy()
      await ui.unmount()
    }
  }
})

test('a page is read once, kept in memory, and the next page is read ahead', async ($, on) => {
  const reads: string[] = []
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'LANG' ? 'en_US.UTF-8' : undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'Darwin', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', (_: unknown, e: { path: string }) => { reads.push(e.path); return { value: { base64: PNG } } })
  on('state.get', (_, e) =>
    (e as { key: string }).key === 'views'
      ? { value: { value: { shape: 'views-1', value: { toolu_1: VIEW } }, version: 1 } }
      : { value: { value: { shape: 'positions-1', value: {} }, version: 1 } },
  )
  const ui = await $.ui.mount(ROW('terminal'))
  await ui.redraw()
  expect(reads.filter(p => p === '/tmp/p-1.png').length).toBe(1)
  await ui.redraw()
  expect(reads).toContain('/tmp/p-2.png')
  await ui.unmount()
})

test('with no stored view the engine draws its own row', async ($, on) => {
  stubHost(on)
  on('state.get', () => ({ value: { value: {}, version: 1 } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(ROW('terminal'))
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

const READ_ROW = (surface: 'terminal' | 'mobile') => ({
  plugin: 'show-me',
  component: 'ToolResult',
  requestId: 'toolu_read',
  surface,
  props: { tool_use_id: 'toolu_read', tool: 'Read', isErrored: false,
    output: { type: 'image', file: { base64: PNG, type: 'image/png', originalSize: 70, dimensions: { displayWidth: 800, displayHeight: 600 } } } },
}) as const

function engineRow(on: any) {
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Read image (70B)</Text>
  })
}

test('a Read image row gets a "show me" button and draws nothing more while closed', async ($, on) => {
  stubHost(on)
  engineRow(on)
  on('store.get', () => ({ value: undefined }))
  on('state.get', () => ({ value: { value: false, version: 1 } }))
  for (const surface of ['terminal', 'mobile'] as const) {
    const ui = await $.ui.mount(READ_ROW(surface))
    expect((await ui.find({ type: 'Text', text: /Read image/ }))?.text).toBe('Read image (70B)')
    expect(await ui.find({ type: 'Button', key: 'show-me' })).toBeTruthy()
    expect(await ui.find({ type: 'Image' })).toBeFalsy()
    await ui.unmount()
  }
})

test('pressed open in the terminal, the PNG Claude Code already holds is drawn', async ($, on) => {
  stubHost(on)
  engineRow(on)
  on('store.get', () => ({ value: undefined }))
  on('state.get', () => ({ value: { value: true, version: 2 } }))
  const ui = await $.ui.mount(READ_ROW('terminal'))
  expect(await ui.find({ type: 'Image', key: 'read' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'show-me' })).toBeTruthy()
  await ui.unmount()
})

test('a text Read is left to the engine', async ($, on) => {
  stubHost(on)
  engineRow(on)
  const ui = await $.ui.mount({ ...READ_ROW('terminal'), props: { tool_use_id: 'toolu_read', tool: 'Read', isErrored: false, output: { type: 'text', file: { filePath: '/a.md', content: '#', numLines: 1, startLine: 1, totalLines: 1 } } } })
  expect(await ui.find({ type: 'Button', key: 'show-me' })).toBeFalsy()
  await ui.unmount()
})
