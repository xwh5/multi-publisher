/**
 * CLI 统一输出契约（对标 OpenCLI）：
 *   成功 → {"ok":true,"data":...}
 *   失败 → {"ok":false,"error":{"code","message","hint"?}}
 * 失败时退出码非 0；人类可读格式在 --json 之外默认打印。
 */
export interface CliError {
  code: string
  message: string
  hint?: string
}

export interface OutputOptions {
  json?: boolean
  /** 人类可读输出（--json 时忽略） */
  human?: string | (() => string)
}

export function emitSuccess(data: unknown, opts: OutputOptions = {}): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: true, data }, null, 2) + '\n')
    return
  }
  const text = typeof opts.human === 'function' ? opts.human() : opts.human
  if (text) process.stdout.write(text.endsWith('\n') ? text : text + '\n')
}

export function emitFailure(error: CliError, opts: OutputOptions = {}): void {
  process.exitCode = 1
  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: false, error }, null, 2) + '\n')
    return
  }
  const hint = error.hint ? `\n  → ${error.hint}` : ''
  process.stderr.write(`❌ [${error.code}] ${error.message}${hint}\n`)
}

/** 表格输出（人类可读） */
export function formatTable(rows: Record<string, string>[], columns?: string[]): string {
  if (rows.length === 0) return '(空)'
  const cols = columns ?? Object.keys(rows[0])
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => (r[c] ?? '').length)),
  )
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()
  const sep = widths.map((w) => '─'.repeat(w)).join('  ')
  return [line(cols), sep, ...rows.map((r) => line(cols.map((c) => r[c] ?? '')))].join('\n')
}
