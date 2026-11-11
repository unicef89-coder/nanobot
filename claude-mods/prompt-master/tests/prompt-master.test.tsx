import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'prompt-master',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false },
} as const

const PANE = {
  plugin: 'prompt-master',
  component: 'Pane',
  requestId: 'prompt-master',
  props: {
    title: '✨ Prompt Master',
    isFocused: true,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const BETTER = 'Fix the login bug. Find the cause, fix it, and add a test.'

test('the band button rewrites the draft in the box', async ($, on) => {
  let box = { text: 'fix the login bug its broken', cursor: 0 }
  on('prompt.read', () => ({ value: box }))
  on('prompt.fill', (_, e) => {
    box = { text: e.text, cursor: e.text.length }
    return { isFilled: true }
  })
  on('model.complete', () => ({
    value: { isAnswered: true, text: BETTER, usage: { input_tokens: 1, output_tokens: 1 } },
  }))
  on('ui.toast', () => ({ value: undefined }))

  for (const surface of ['terminal', 'desktop'] as const) {
    box = { text: 'fix the login bug its broken', cursor: 0 }
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'prompt-master' })
    expect(box.text).toBe(BETTER)
  }
})

test('on mobile the pane rewrites and sends', async ($, on) => {
  const sent: string[] = []
  on('model.complete', () => ({
    value: { isAnswered: true, text: BETTER, usage: { input_tokens: 1, output_tokens: 1 } },
  }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await ui.input({ key: 'rough', text: 'fix the login bug its broken' })
  await ui.press({ key: 'rewrite' })
  expect(await ui.find({ type: 'Text', text: BETTER })).toBeDefined()
  await ui.press({ key: 'send' })
  expect(sent).toEqual([BETTER])
})

test('/promptmaster <rough> prints the rewrite, /promptmaster send sends it', async ($, on) => {
  const sent: string[] = []
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'promptmaster' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', () => ({
    value: { isAnswered: true, text: BETTER, usage: { input_tokens: 1, output_tokens: 1 } },
  }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  const r = await $.command.run({ command: 'promptmaster', args: 'fix the login bug its broken' })
  expect(r.text).toContain(BETTER)
  await $.command.run({ command: 'promptmaster', args: 'send' })
  await clock.advance(500)
  expect(sent).toEqual([BETTER])
})
