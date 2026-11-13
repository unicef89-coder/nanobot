import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Phase } from '../types'

const PANE = 'prompt-master'
const TITLE = '✨ Prompt Master'

const phase = atom({ plugin: 'prompt-master', key: 'phase' } as const, 'idle' as Phase)
// Armed: rewrite the next typed message as it is sent.
const isArmed = atom({ plugin: 'prompt-master', key: 'isArmed' } as const, false)
// The pane's own rough prompt and its rewrite (works on every surface, mobile too).
const draft = atom({ plugin: 'prompt-master', key: 'draft' } as const, '')
const result = atom({ plugin: 'prompt-master', key: 'result' } as const, '')
const error = atom({ plugin: 'prompt-master', key: 'error' } as const, '')

const SYSTEM = `You are Prompt Master. You rewrite a user's rough prompt for an AI coding assistant into a better prompt.

Rules:
- Keep the user's intent, facts, names, file paths, code and constraints exactly. Never invent requirements, files or details.
- Make it clear and specific: state the goal first, then context, then concrete requirements, then what "done" looks like.
- Fix spelling and grammar. Remove filler. Use short bullet points where they help; keep simple asks short.
- If something important is ambiguous, add a brief line asking the assistant to state its assumption rather than guessing silently.
- Write it in the user's voice, addressed to the assistant.
- Output ONLY the rewritten prompt. No preamble, no quotes, no commentary.`

type Rewrite = { ok: true; text: string } | { ok: false; why: string }

async function rewrite($: EngineInterface, rough: string): Promise<Rewrite> {
  const r = await $.model
    .complete({
      model: 'sonnet',
      system: SYSTEM,
      prompt: `Rough prompt:\n<<<\n${rough}\n>>>`,
      maxTokens: 2048,
      effort: 'low',
      timeoutMs: 60000,
    })
    .catch((err: unknown) => ({ isAnswered: false as const, reason: String(err) }))
  if (!r.isAnswered) return { ok: false, why: r.reason }
  const text = r.text.trim()
  return text ? { ok: true, text } : { ok: false, why: 'empty-reply' }
}

async function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE, focus: true })
}

// Pane: rewrite what was typed in the pane's own field.
async function rewriteDraft($: EngineInterface, text?: string) {
  if ((await read($, phase)) === 'busy') return
  const rough = (text ?? (await read($, draft))).trim()
  if (text !== undefined) await update($, draft, () => text)
  if (!rough) {
    await update($, error, () => 'Type a rough prompt first.')
    return
  }
  await update($, error, () => '')
  await update($, phase, () => 'busy' as Phase)
  try {
    const out = await rewrite($, rough)
    if (out.ok) await update($, result, () => out.text)
    else await update($, error, () => `Could not rewrite (${out.why}). Try again.`)
  } finally {
    await update($, phase, () => 'idle' as Phase)
  }
}

async function sendResult($: EngineInterface) {
  const text = await read($, result)
  if (!text) return
  await update($, draft, () => '')
  await update($, result, () => '')
  void $.prompt.submit({ text })
  $.ui.toast('Sent the rewritten prompt')
}

// A command cannot submit while it holds its own turn: send once it has returned.
async function sendSoon($: EngineInterface) {
  await $.clock.sleep(250)
  await sendResult($)
}

async function useResultInBox($: EngineInterface) {
  const text = await read($, result)
  if (!text) return
  const filled = await $.prompt.fill({ text, mode: 'replace' })
  if (filled.isFilled) {
    await update($, draft, () => '')
    await update($, result, () => '')
    $.ui.toast('Rewrite is in the prompt box. Edit it or press Enter')
  } else {
    await update($, error, () => 'This app does not let mods write the prompt box. Use Send.')
  }
}

async function toggleArmed($: EngineInterface) {
  const was = await read($, isArmed)
  await update($, isArmed, () => !was)
  $.ui.toast(
    was ? 'Prompt Master disarmed' : 'Armed: your next message will be rewritten as it is sent',
  )
}

// Band button (terminal/desktop): rewrite the draft in the prompt box in place.
async function runFromBox($: EngineInterface) {
  if ((await read($, phase)) === 'busy') return
  const box = await $.prompt.read()
  const rough = box.text.trim()
  if (!rough) {
    await openPane($)
    return
  }
  await update($, phase, () => 'busy' as Phase)
  try {
    const out = await rewrite($, rough)
    if (!out.ok) {
      $.ui.toast(`Prompt Master could not rewrite (${out.why})`)
      return
    }
    const filled = await $.prompt.fill({ text: out.text, mode: 'replace' })
    $.ui.toast(
      filled.isFilled
        ? 'Prompt rewritten. Review it, then press Enter to send'
        : 'Could not put the rewrite in the box',
    )
  } finally {
    await update($, phase, () => 'idle' as Phase)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'promptmaster',
      description: 'Open Prompt Master, or rewrite inline: /promptmaster <rough prompt>',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'promptmaster' }, async ($, e) => {
    const arg = e.args.trim()
    const word = arg.toLowerCase()

    if (word === 'send') {
      const text = await read($, result)
      if (!text) return { text: 'Nothing to send yet. Use /promptmaster <rough prompt> first.', isTextDisplayOnly: true }
      void sendSoon($)
      return { text: 'Sending the rewritten prompt…', isTextDisplayOnly: true }
    }
    if (word === 'auto') {
      await toggleArmed($)
      const nowOn = await read($, isArmed)
      return {
        text: nowOn
          ? 'Auto is ON: your next chat message will be rewritten as it is sent.'
          : 'Auto is off.',
        isTextDisplayOnly: true,
      }
    }

    void openPane($)
    if (!arg) {
      return {
        text: [
          '✨ Prompt Master',
          '',
          '• /promptmaster <rough prompt> — rewrite it and show the better version',
          '• /promptmaster send — send the last rewrite',
          '• /promptmaster auto — rewrite your next chat message automatically',
        ].join('\n'),
        isTextDisplayOnly: true,
      }
    }

    await rewriteDraft($, arg)
    const out = await read($, result)
    if (!out) {
      return { text: (await read($, error)) || 'Could not rewrite. Try again.', isTextDisplayOnly: true }
    }
    return {
      text: `✨ Better prompt:\n\n${out}\n\nTap ➤ Send in the Prompt Master panel, or type /promptmaster send.`,
      isTextDisplayOnly: true,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' || e.command || !(await read($, isArmed)) || !e.text.trim()) {
      return next(e)
    }
    await update($, isArmed, () => false)
    await update($, phase, () => 'busy' as Phase)
    try {
      const out = await rewrite($, e.text).catch(
        (err: unknown): Rewrite => ({ ok: false, why: String(err) }),
      )
      if (!out.ok) {
        $.ui.toast(`Prompt Master could not rewrite (${out.why}); sent as typed`)
        return next(e)
      }
      $.ui.toast('Prompt Master rewrote this message')
      return next({ ...e, text: out.text })
    } finally {
      await update($, phase, () => 'idle' as Phase)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const busy = (await read($, phase)) === 'busy'
    const armed = await read($, isArmed)
    const rough = await read($, draft)
    const out = await read($, result)
    const err = await read($, error)

    return (
      <Box flexDirection="column" gap={1}>
        <Input
          key="rough"
          label="Rough prompt"
          placeholder="Type it however it comes out…"
          value={rough}
          rows={4}
          submitLabel="rewrite"
          onInput={value => void update($, draft, () => value)}
          onSubmit={value => void rewriteDraft($, value)}
        />
        <Box flexDirection="row" gap={1}>
          <Button
            key="rewrite"
            label={busy ? '✨ Rewriting…' : '✨ Rewrite'}
            onPress={() => rewriteDraft($)}
          />
          <Button
            key="arm"
            label={armed ? 'Auto: ON' : 'Auto: off'}
            onPress={() => toggleArmed($)}
          />
        </Box>
        {err !== '' && <Text color="red">{err}</Text>}
        {out !== '' && (
          <Box flexDirection="column" gap={1}>
            <Text bold>Better prompt</Text>
            <Text>{out}</Text>
            <Box flexDirection="row" gap={1}>
              <Button key="send" label="➤ Send" onPress={() => sendResult($)} />
              <Button key="use" label="Put in box" onPress={() => useResultInBox($)} />
              <Button
                key="discard"
                label="Discard"
                onPress={() => update($, result, () => '')}
              />
            </Box>
          </Box>
        )}
        {out === '' && !busy && (
          <Text dimColor>
            {armed
              ? 'Auto is on: the next message you type in the chat box is rewritten as it is sent.'
              : 'Tap Rewrite to improve it, then Send. Auto rewrites your next chat message instead.'}
          </Text>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const busy = (await read($, phase)) === 'busy'

    return (
      <Box>
        <Button
          key="prompt-master"
          label={busy ? '✨ Rewriting…' : '✨ Prompt Master'}
          onPress={() => runFromBox($)}
        />
        <Text dimColor> {busy ? 'improving your prompt' : 'rewrite what you typed'}</Text>
      </Box>
    )
  })
}
