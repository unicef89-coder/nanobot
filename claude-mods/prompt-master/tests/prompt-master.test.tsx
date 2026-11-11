import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'prompt-master',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false },
} as const

test('the button rewrites the draft in the box', async ($, on) => {
  let box = { text: 'fix the login bug its broken', cursor: 0 }
  on('prompt.read', () => ({ value: box }))
  on('prompt.fill', (_, e) => {
    box = { text: e.text, cursor: e.text.length }
    return { isFilled: true }
  })
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: 'Fix the login bug. Find the cause, fix it, and add a test.',
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }))
  on('ui.toast', () => ({ value: undefined }))

  for (const surface of ['terminal', 'desktop'] as const) {
    box = { text: 'fix the login bug its broken', cursor: 0 }
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.press({ key: 'prompt-master' })
    expect(box.text).toBe('Fix the login bug. Find the cause, fix it, and add a test.')
  }
})

test('an empty box arms a rewrite of the next message', async ($, on) => {
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('ui.toast', () => ({ value: undefined }))

  const ui = await $.ui.mount({ ...BAND, surface: 'mobile' })
  await ui.press({ key: 'prompt-master' })
  expect((await ui.find({ key: 'prompt-master' }))?.text).toContain('armed')
})
