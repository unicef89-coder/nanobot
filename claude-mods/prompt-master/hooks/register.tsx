import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Phase } from '../types'

const phase = atom({ plugin: 'prompt-master', key: 'phase' } as const, 'idle' as Phase)
// Armed: rewrite the next prompt as it is sent (for surfaces whose own
// composer a mod cannot read, such as the mobile app).
const isArmed = atom({ plugin: 'prompt-master', key: 'isArmed' } as const, false)

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

async function runFromBox($: EngineInterface) {
  if ((await read($, phase)) === 'busy') return
  const box = await $.prompt.read()
  const rough = box.text.trim()
  if (!rough) {
    // Nothing readable in the box: arm a rewrite of the next send instead.
    const wasArmed = await read($, isArmed)
    await update($, isArmed, () => !wasArmed)
    $.ui.toast(
      wasArmed
        ? 'Prompt Master disarmed'
        : 'Prompt Master armed: your next message will be rewritten before it is sent',
    )
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
      description: 'Rewrite a rough prompt into a better one: /promptmaster <rough prompt>',
    })
    return next(e)
  })

  on('command.run', { command: 'promptmaster' }, async ($, e) => {
    const rough = e.args.trim()
    if (!rough) {
      await runFromBox($)
      return { text: 'Usage: /promptmaster <rough prompt>', isTextDisplayOnly: true }
    }
    const out = await rewrite($, rough)
    if (!out.ok) return { text: `Prompt Master could not rewrite (${out.why})`, isTextDisplayOnly: true }
    const filled = await $.prompt.fill({ text: out.text, mode: 'replace' })
    return {
      text: filled.isFilled
        ? 'Rewritten prompt is in the box. Review it, then press Enter.'
        : `Rewritten prompt:\n\n${out.text}`,
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

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const busy = (await read($, phase)) === 'busy'
    const armed = await read($, isArmed)

    return (
      <Box>
        <Button
          key="prompt-master"
          label={busy ? '✨ Rewriting…' : armed ? '✨ Prompt Master (armed)' : '✨ Prompt Master'}
          onPress={() => runFromBox($)}
        />
        <Text dimColor>
          {' '}
          {busy
            ? 'improving your prompt'
            : armed
              ? 'next message will be rewritten · tap to disarm'
              : 'type a rough prompt, then tap to rewrite it'}
        </Text>
      </Box>
    )
  })
}
