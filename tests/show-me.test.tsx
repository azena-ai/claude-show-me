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
