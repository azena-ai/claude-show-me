/* show-me: Claude shows its work right in the chat.

   tool "show" (or /show-me <path>)
     ├─ image   → PNG for the terminal + small JPEG for the Claude app / desktop
     ├─ PDF     → every page as a picture, page through with ◀ ▶
     ├─ video   → contact sheet (6 frames) + each frame with its timestamp
     ├─ web page / HTML file → screenshot at desktop and phone size (headless Chrome)
     └─ before  → Before / After / Side by side
   terminal: Image (kitty graphics: Ghostty, kitty; inside tmux with passthrough)
   Claude app, desktop, VS Code: Svg with the JPEG embedded */
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Kind, Mode, Page, Position, Screen, View } from '../types'

const TOOL = 'mcp__show-me__show'
const MARK = 'show-me:'
const views = atom({ plugin: 'show-me', key: 'views' } as const, {}, { shape: 'views-1' })
const positions = atom({ plugin: 'show-me', key: 'positions' } as const, {}, { shape: 'positions-1' })
const screen = atom({ plugin: 'show-me', key: 'screen' } as const, {} as Screen, { shape: 'screen-1' })

const IMAGE = /\.(png|jpe?g|webp|gif|heic|heif|tiff?|bmp|avif)$/i
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i
const PDF = /\.pdf$/i
const URL_RE = /^https?:\/\//i
const HTML = /\.html?$/i
const CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', 'google-chrome', 'chromium', 'chromium-browser']
const MAX_PDF_PAGES = 60
const PDF_EDGE = 1200
const BYTES_KEPT = 48 // pictures held in memory for instant paging
const MAX_VIEWS = 60
const PNG_LIMIT = 1_900_000 // an Image takes at most 2 MiB
const SVG_LIMIT = 120_000 // an Svg source takes at most 131,072 characters
const CELL = 2.1 // a terminal cell is about 2.1 times as tall as it is wide

const DESCRIPTION = `Shows the person a file right in the chat, no browser needed: an image, a PDF (every page, to page through), a video (contact sheet of 6 frames plus each frame), a web page or local HTML file (screenshot at desktop and phone size). With "before" (the path of the old version) it shows Before/After to switch between and side by side.
Use it whenever you built, changed, rendered or found something visual (screenshot, render, PDF, slide, video, page) instead of only naming the path. The picture costs no tokens. Use absolute paths.`

const WORDS = {
  en: { noImagesTmux: 'Pictures are off in this session: tmux did not pass them through when Claude Code started. Restart Claude Code in this window and they show. For every window: set -g allow-passthrough on in ~/.tmux.conf', noImagesTerminal: 'This terminal cannot draw pictures (Ghostty, kitty, WezTerm and iTerm2 can). Open shows the file.', page: 'Page', of: 'of', before: 'Before', after: 'After', both: 'Side by side', open: 'Open', reveal: 'Show in folder', sheet: 'Contact sheet', image: 'Image', desktop: 'Desktop', phone: 'Phone', usage: 'Usage: /show-me <path> [before=<path>] · /show-me buttons on|off', failed: 'Could not show it', hide: 'hide', collapse: 'Hide', expand: 'Show', buttonsOn: 'The "show me" button is on.', buttonsOff: 'The "show me" button is off.' },
  de: { noImagesTmux: 'Bilder sind in dieser Sitzung aus: tmux hat sie beim Start von Claude Code nicht durchgelassen. Claude Code in diesem Fenster neu starten, dann sind sie da. Für alle Fenster: set -g allow-passthrough on in ~/.tmux.conf', noImagesTerminal: 'Dieses Terminal kann keine Bilder zeigen (Ghostty, kitty, WezTerm und iTerm2 können es). Öffnen zeigt die Datei.', page: 'Seite', of: 'von', before: 'Vorher', after: 'Nachher', both: 'Nebeneinander', open: 'Öffnen', reveal: 'Im Ordner zeigen', sheet: 'Kontaktbogen', image: 'Bild', desktop: 'Desktop', phone: 'Handy', usage: 'Benutzung: /show-me <pfad> [before=<pfad>] · /show-me buttons on|off', failed: 'Konnte nicht zeigen', hide: 'zuklappen', collapse: 'Zuklappen', expand: 'Aufklappen', buttonsOn: 'Der „show me“-Knopf ist an.', buttonsOff: 'Der „show me“-Knopf ist aus.' },
}
type Words = (typeof WORDS)['en']

type Run = { code: number; out: string; err: string }
type Host = { mac: boolean; uid: number; words: Words; env: Record<string, string> }

// ---------------------------------------------------------------- the host

let hostFacts: Host | undefined

async function hostOf($: any): Promise<Host> {
  if (hostFacts) return hostFacts
  const path = (await $.env.get('PATH')) ?? '/usr/bin:/bin'
  const home = (await $.env.get('HOME')) ?? '/tmp'
  const env = { PATH: `/opt/homebrew/bin:/usr/local/bin:${path}`, HOME: home, LANG: 'C' }
  const uname = await $.process.run(['uname'], { env, timeoutMs: 5_000 }).catch(() => ({ stdout: '' }))
  const mac = /Darwin/.test(uname.stdout)
  const who = await $.process.run(['id', '-u'], { env, timeoutMs: 5_000 }).catch(() => ({ stdout: '' }))
  const uid = Number(who.stdout.trim())
  let lang = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG')) || ''
  if (!lang && mac) {
    const r = await $.process.run(['defaults', 'read', '-g', 'AppleLocale'], { env, timeoutMs: 5_000 }).catch(() => ({ stdout: '' }))
    lang = r.stdout
  }
  hostFacts = { mac, uid: Number.isFinite(uid) && who.stdout.trim() !== '' ? uid : -1, env, words: /^de/i.test(lang.trim()) ? WORDS.de : WORDS.en }
  return hostFacts
}

async function runOn($: any, argv: string[], timeoutMs = 90_000, stdin?: string): Promise<Run> {
  const { env } = await hostOf($)
  try {
    const r = await $.process.run(argv, { env, timeoutMs, ...(stdin === undefined ? {} : { stdin }) })
    return { code: r.exitCode, out: r.stdout, err: r.stderr }
  } catch (error) {
    return { code: 127, out: '', err: String(error) }
  }
}

/** Owner, permission bits and type of a path, without following a link (stat's default on macOS and Linux). */
async function statOf($: any, path: string): Promise<{ uid: number; mode: number; type: string } | undefined> {
  const { mac } = await hostOf($)
  const r = await runOn($, mac ? ['stat', '-f', '%u %Lp %HT', path] : ['stat', '-c', '%u %a %F', path], 5_000)
  if (r.code !== 0) return undefined
  const [uid, mode, ...type] = r.out.trim().split(' ')
  return { uid: Number(uid), mode: parseInt(mode ?? '777', 8), type: type.join(' ').toLowerCase() }
}

/** The plugin's own cache folder, private to this user: a per-user TMPDIR (macOS), else $XDG_RUNTIME_DIR or ~/.cache.
 *  A shared, writable TMPDIR such as /tmp is never used. Fails unless the folder is a real directory owned by
 *  this user with no rights for anyone else; the hash folders inside it can then only be made by this user. */
async function privateDir($: any): Promise<string> {
  const { uid } = await hostOf($)
  if (uid < 0) throw new Error('could not tell the current user')
  const tmp = ((await $.env.get('TMPDIR')) ?? '').replace(/\/$/, '')
  const home = (await $.env.get('HOME')) ?? ''
  let base = ''
  if (tmp) {
    const t = await statOf($, tmp)
    if (t && t.uid === uid && (t.mode & 0o022) === 0 && t.type.startsWith('directory')) base = tmp
  }
  if (!base) base = (await $.env.get('XDG_RUNTIME_DIR')) || (home ? `${home}/.cache` : '')
  if (!base) throw new Error('no private folder for the cache (TMPDIR, XDG_RUNTIME_DIR or HOME)')
  const dir = `${base}/show-me`
  if ((await runOn($, ['mkdir', '-p', '-m', '700', dir])).code !== 0) throw new Error(`could not make ${dir}`)
  if ((await runOn($, ['chmod', '700', dir])).code !== 0) throw new Error(`could not protect ${dir}`)
  const s = await statOf($, dir)
  if (!s || s.uid !== uid || (s.mode & 0o077) !== 0 || !s.type.startsWith('directory')) {
    throw new Error(`the cache folder is not a private directory of this user: ${dir}`)
  }
  return dir
}

async function cacheDirFor($: any, source: string): Promise<string> {
  let key = source
  try {
    const s = await $.fs.stat(source)
    key += `|${s.size}|${s.mtimeMs}`
  } catch {
    key += `|${Date.now()}`
  }
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619)
  const dir = `${await privateDir($)}/${(hash >>> 0).toString(36)}`
  if ((await runOn($, ['mkdir', '-p', '-m', '700', dir])).code !== 0) throw new Error(`could not make ${dir}`)
  return dir
}

async function sizeOnDisk($: any, path: string): Promise<number> {
  try {
    return (await $.fs.stat(path)).size
  } catch {
    return 0
  }
}

/** Pixel size of one picture: sips on macOS, ffprobe elsewhere. */
async function pixelsOf($: any, path: string): Promise<{ w: number; h: number }> {
  const { mac } = await hostOf($)
  if (mac) {
    const r = await runOn($, ['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path])
    const width = Number((/pixelWidth:\s*(\d+)/.exec(r.out) ?? [])[1] ?? 0)
    const height = Number((/pixelHeight:\s*(\d+)/.exec(r.out) ?? [])[1] ?? 0)
    if (width && height) return { w: width, h: height }
  }
  const r = await runOn($, ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', path])
  const [width, height] = r.out.trim().split('x').map(Number)
  return { w: width || 1200, h: height || 900 }
}

/** Writes a scaled copy (longest side at most `edge`) as PNG or JPEG: sips on macOS, ffmpeg elsewhere. */
async function convertTo($: any, source: string, target: string, edge: number, format: 'png' | 'jpeg', quality: number) {
  const { mac } = await hostOf($)
  if (mac) {
    const argv = ['sips', '-s', 'format', format, ...(format === 'jpeg' ? ['-s', 'formatOptions', String(quality)] : []), '-Z', String(edge), source, '--out', target]
    if ((await runOn($, argv)).code === 0) return
  }
  const scale = `scale='min(iw,${edge})':'min(ih,${edge})':force_original_aspect_ratio=decrease`
  await runOn($, ['ffmpeg', '-y', '-v', 'error', '-i', source, '-frames:v', '1', '-vf', scale, ...(format === 'jpeg' ? ['-q:v', String(Math.round(2 + (100 - quality) / 10))] : []), target])
}

/** From any picture: a PNG (at most 1600 px, under 1.9 MB) and a JPEG preview (under 120 KB as base64). */
async function pageFromPicture($: any, source: string, dir: string, name: string, label: string): Promise<Page> {
  const png = `${dir}/${name}.png`
  const jpg = `${dir}/${name}.jpg`
  const original = await pixelsOf($, source)
  const longest = Math.max(original.w, original.h) // never upscale
  for (const edge of [1600, 1200, 900, 700]) {
    await convertTo($, source, png, Math.min(edge, longest), 'png', 0)
    if ((await sizeOnDisk($, png)) <= PNG_LIMIT) break
  }
  for (const [edge, quality] of [[640, 60], [520, 50], [400, 42], [300, 35]] as const) {
    await convertTo($, source, jpg, Math.min(edge, longest), 'jpeg', quality)
    if ((await sizeOnDisk($, jpg)) * 1.37 <= SVG_LIMIT) break
  }
  const size = await pixelsOf($, png)
  return { png, jpg, w: size.w, h: size.h, name: label }
}

async function prepareImage($: any, source: string): Promise<Page[]> {
  const { words } = await hostOf($)
  return [await pageFromPicture($, source, await cacheDirFor($, source), 's1', words.image)]
}

async function preparePdf($: any, source: string): Promise<{ pages: Page[]; total: number }> {
  const { words } = await hostOf($)
  const dir = await cacheDirFor($, source)
  const info = await runOn($, ['pdfinfo', source])
  if (info.code === 127) throw new Error('pdftoppm/pdfinfo (poppler) is not installed: brew install poppler')
  const total = Number((/Pages:\s+(\d+)/.exec(info.out) ?? [])[1] ?? '1')
  const last = Math.min(total, MAX_PDF_PAGES)
  const listed = ((await $.fs.list(dir).catch(() => [])) as any[]).map(f => f.name)
  if (!listed.some(n => /^s-\d+\.png$/.test(n))) {
    // longest side 1200 px: sharp at full terminal width, a few hundred KB a page, so paging stays instant
    await runOn($, ['pdftoppm', '-scale-to', String(PDF_EDGE), '-png', '-f', '1', '-l', String(last), source, `${dir}/s`], 240_000)
    await runOn($, ['pdftoppm', '-jpeg', '-jpegopt', 'quality=55', '-scale-to', '560', '-f', '1', '-l', String(last), source, `${dir}/v`], 240_000)
  }
  const files = ((await $.fs.list(dir)) as any[]).map(f => f.name).filter(n => /^s-\d+\.png$/.test(n)).sort()
  const pages: Page[] = []
  for (const [i, file] of files.entries()) {
    const nr = /s-(\d+)\.png$/.exec(file)![1]
    const size = await pixelsOf($, `${dir}/${file}`)
    pages.push({ png: `${dir}/${file}`, jpg: `${dir}/v-${nr}.jpg`, w: size.w, h: size.h, name: `${words.page} ${i + 1}` })
  }
  return { pages, total }
}

async function prepareVideo($: any, source: string): Promise<Page[]> {
  const { words } = await hostOf($)
  const dir = await cacheDirFor($, source)
  const probe = await runOn($, ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', source])
  if (probe.code === 127) throw new Error('ffmpeg is not installed: brew install ffmpeg')
  const duration = Math.max(0.5, Number(probe.out.trim()) || 1)
  const pages: Page[] = []
  for (let i = 0; i < 6; i++) {
    const t = ((i + 0.5) / 6) * duration
    const raw = `${dir}/f${i + 1}.png`
    await runOn($, ['ffmpeg', '-y', '-v', 'error', '-ss', t.toFixed(2), '-i', source, '-frames:v', '1', '-vf', 'scale=1280:-2', raw])
    pages.push(await pageFromPicture($, raw, dir, `b${i + 1}`, `${t.toFixed(1)} s`))
  }
  const sheetRaw = `${dir}/sheet-raw.png`
  await runOn($, ['ffmpeg', '-y', '-v', 'error', '-i', `${dir}/f%d.png`, '-vf', 'scale=640:-2,tile=3x2:padding=6:color=white', '-frames:v', '1', sheetRaw])
  const sheet = await pageFromPicture($, sheetRaw, dir, 'sheet', `${words.sheet} · ${duration.toFixed(1)} s`)
  return [sheet, ...pages]
}

async function prepareWeb($: any, source: string): Promise<Page[]> {
  const { words } = await hostOf($)
  const dir = await cacheDirFor($, source)
  const url = URL_RE.test(source) ? source : `file://${source}`
  const pages: Page[] = []
  for (const [name, size] of [[words.desktop, '1440,900'], [words.phone, '390,844']] as const) {
    const raw = `${dir}/web-${size.replace(',', 'x')}.png`
    for (const chrome of CHROMES) {
      const r = await runOn($, [chrome, '--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${size}`, `--screenshot=${raw}`, '--virtual-time-budget=4000', url], 60_000)
      if (r.code === 0 && (await sizeOnDisk($, raw)) > 0) break
    }
    if ((await sizeOnDisk($, raw)) > 0) pages.push(await pageFromPicture($, raw, dir, `w-${size.replace(',', 'x')}`, name))
  }
  if (!pages.length) throw new Error('no headless Chrome or Chromium found for the screenshot')
  return pages
}

function kindOf(source: string): Kind | undefined {
  if (URL_RE.test(source) || HTML.test(source)) return 'web'
  if (PDF.test(source)) return 'pdf'
  if (VIDEO.test(source)) return 'video'
  if (IMAGE.test(source)) return 'image'
  return undefined
}

async function prepareAny($: any, source: string): Promise<{ kind: Kind; pages: Page[]; total: number }> {
  const kind = kindOf(source)
  if (!kind) throw new Error(`file type not supported: ${source}`)
  if (!URL_RE.test(source)) {
    const s = await $.fs.stat(source).catch(() => undefined)
    if (!s || s.kind !== 'file') throw new Error(`file not found: ${source}`)
  }
  if (kind === 'pdf') return { kind, ...(await preparePdf($, source)) }
  const pages = kind === 'image' ? await prepareImage($, source) : kind === 'video' ? await prepareVideo($, source) : await prepareWeb($, source)
  if (!pages.length) throw new Error(`nothing to show for ${source}`)
  return { kind, pages, total: pages.length }
}

/** Claude Code decides when the session starts whether it draws pictures: inside tmux only when allow-passthrough
 *  and focus-events are on at that moment, in Apple's Terminal never. Checked once, before readyTmux turns them on,
 *  so a viewer can say why it shows no picture instead of a grey line. CLAUDE_CODE_FORCE_TERMINAL_IMAGES overrides. */
async function checkScreen($: any): Promise<Screen> {
  if ((await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')) === '1') return {}
  const tmux = await $.env.get('TMUX')
  if (!tmux) return (await $.env.get('TERM_PROGRAM')) === 'Apple_Terminal' ? { imagesOff: 'terminal' } : {}
  const pane = (await $.env.get('TMUX_PANE')) ?? ''
  const env = { ...(await hostOf($)).env, TMUX: tmux }
  const ask = async (argv: string[]) => (await $.process.run(argv, { env, timeoutMs: 5_000 }).catch(() => ({ stdout: '' }))).stdout.trim()
  const pass = await ask(['tmux', 'show', '-Apv', ...(pane ? ['-t', pane] : []), 'allow-passthrough'])
  const focus = await ask(['tmux', 'show', '-gv', 'focus-events'])
  return (pass === 'on' || pass === 'all') && focus === 'on' ? {} : { imagesOff: 'tmux' }
}

/** Inside tmux, pictures need allow-passthrough on this pane and focus-events on. */
async function readyTmux($: any): Promise<void> {
  const tmux = await $.env.get('TMUX')
  if (!tmux) return
  const pane = (await $.env.get('TMUX_PANE')) ?? ''
  const target = pane ? ['-t', pane] : []
  // TMUX goes along so the command reaches this session's server, whatever socket it runs on.
  const env = { ...(await hostOf($)).env, TMUX: tmux }
  for (const argv of [
    ['tmux', 'set', '-p', ...target, 'allow-passthrough', 'on'],
    ['tmux', 'set', '-w', ...target, 'allow-passthrough', 'on'],
    ['tmux', 'set', '-g', 'focus-events', 'on'],
  ]) await $.process.run(argv, { env, timeoutMs: 5_000 }).catch(() => undefined)
}

function expandHome(path: string, home: string): string {
  return path.trim().replace(/^~(?=\/|$)/, home)
}

/** Prepares the file, keeps the view under `id`, and answers the sentence the model reads. */
async function createView($: any, id: string, input: { file: string; before?: string; title?: string; note?: string }): Promise<string> {
  const home = (await $.env.get('HOME')) ?? '~'
  const source = expandHome(input.file, home)
  const ready = await prepareAny($, source)
  const beforeSource = input.before ? expandHome(input.before, home) : undefined
  const before = beforeSource ? (await prepareAny($, beforeSource)).pages : undefined
  const title = input.title?.trim() || source.split('/').pop() || source
  const view: View = {
    kind: ready.kind, title, source, pages: ready.pages, total: ready.total,
    ...(before && beforeSource ? { before, beforeSource } : {}),
    ...(input.note ? { note: input.note } : {}),
  }
  await update($, views, all => {
    const next: Record<string, View> = { ...(all ?? {}), [id]: view }
    const keys = Object.keys(next)
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_VIEWS))) delete next[old]
    return next
  })
  await readyTmux($)
  const what = {
    image: 'an image',
    pdf: `a PDF, ${ready.total} pages${ready.total > ready.pages.length ? ` (the first ${ready.pages.length} to page through)` : ''}`,
    video: 'a video as a contact sheet plus 6 frames',
    web: 'a web page as desktop and phone screenshots',
  }[ready.kind]
  const sentence = `Shown in the chat: "${title}" (${what}${before ? ', with before/after' : ''}).`
  // Followed from the Claude app or a background session: no terminal draws the picture there.
  const surfaces: readonly string[] = await $.session.surfaces().catch(() => [])
  if (surfaces.includes('terminal')) return `${sentence} The person sees it right there.`
  const files = [...(before ?? []).slice(0, 3), ...ready.pages.slice(0, 6)].map(p => p.png)
  return `${sentence} The person is not at a terminal, so the picture may not show for them. If you can send files to the person (for example SendUserFile), send these now: ${files.join(' ')}`
}

// ---------------------------------------------------------------- drawing

function fit(width: number, height: number, maxColumns: number, maxRows: number) {
  let columns = Math.max(8, Math.min(maxColumns, 255))
  let rows = Math.round((columns * height) / width / CELL)
  if (rows > maxRows) {
    rows = maxRows
    columns = Math.max(8, Math.round((rows * CELL * width) / height))
  }
  return { columns: Math.min(columns, 255), rows: Math.max(2, Math.min(rows, 255)) }
}

// Pictures already read, by path: a page turn draws from memory instead of reading the file again.
const pictureBytes = new Map<string, string>()

async function bytesOf($: any, path: string): Promise<string> {
  const kept = pictureBytes.get(path)
  if (kept !== undefined) {
    pictureBytes.delete(path)
    pictureBytes.set(path, kept) // most recent last
    return kept
  }
  const { base64 } = await $.fs.read(path, { as: 'bytes' })
  pictureBytes.set(path, base64)
  while (pictureBytes.size > BYTES_KEPT) pictureBytes.delete(pictureBytes.keys().next().value!)
  return base64
}

/** Reads the pages around the one on screen ahead of time, in the background: a local file takes milliseconds,
 *  and a newer drawing that cancels a read simply asks again for its own neighbours. */
function preloadAround($: any, paths: string[]) {
  void (async () => {
    for (const path of paths) if (!pictureBytes.has(path)) await bytesOf($, path).catch(() => undefined)
  })()
}

async function drawView($: any, e: any, id: string, v: View) {
  const { words, mac } = await hostOf($)
  const at: Position = (await read($, positions))[id] ?? { page: 0, mode: 'after' }
  const list = at.mode === 'before' && v.before ? v.before : v.pages
  const nr = Math.min(Math.max(0, at.page), list.length - 1)
  const page = list[nr]!
  const afterPage = v.pages[Math.min(nr, v.pages.length - 1)]!
  const beside = at.mode === 'both' && v.before ? v.before[Math.min(nr, v.before.length - 1)]! : undefined
  const setMode = (mode: Mode) => () =>
    update($, positions, all => ({ ...(all ?? {}), [id]: { ...(all?.[id] ?? at), mode } }))
  const turn = (step: number) => () =>
    update($, positions, all => {
      const now = all?.[id] ?? at
      return { ...(all ?? {}), [id]: { ...now, page: (now.page + step + list.length) % list.length } }
    })
  const fold = () =>
    update($, positions, all => {
      const now = all?.[id] ?? at
      return { ...(all ?? {}), [id]: { ...now, hidden: !(now.hidden ?? false) } }
    })
  const hidden = at.hidden ?? false
  const launch = (argv: string[]) => () => void runOn($, argv, 10_000)
  const openArgv = mac ? ['open', v.source] : ['xdg-open', v.source]
  const modeName = at.mode === 'before' ? words.before : at.mode === 'both' ? `${words.before} | ${words.after}` : words.after
  const heading = `${v.title}${list.length > 1 ? ` · ${page.name}${v.kind === 'pdf' ? ` ${words.of} ${v.total}` : ''}` : ''}${v.before ? ` · ${modeName}` : ''}`

  // Folded away, the row keeps its heading and the buttons that need no picture: Show, Open, Show in folder.
  const controls = (Button: any, Text: any, withOpen: boolean) => [
    !hidden && list.length > 1 && <Button key="prev" onPress={turn(-1)}>◀</Button>,
    !hidden && list.length > 1 && <Text dimColor>{`${nr + 1}/${list.length}`}</Text>,
    !hidden && list.length > 1 && <Button key="next" onPress={turn(1)}>▶</Button>,
    !hidden && v.before && <Button key="mode-before" variant={at.mode === 'before' ? 'primary' : undefined} onPress={setMode('before')}>{words.before}</Button>,
    !hidden && v.before && <Button key="mode-after" variant={at.mode === 'after' ? 'primary' : undefined} onPress={setMode('after')}>{words.after}</Button>,
    !hidden && v.before && <Button key="mode-both" variant={at.mode === 'both' ? 'primary' : undefined} onPress={setMode('both')}>{words.both}</Button>,
    withOpen && <Button key="open" onPress={launch(openArgv)}>{words.open}</Button>,
    withOpen && mac && !URL_RE.test(v.source) && <Button key="reveal" onPress={launch(['open', '-R', v.source])}>{words.reveal}</Button>,
    <Button key="fold" onPress={fold}>{hidden ? words.expand : words.collapse}</Button>,
  ]

  if (e.surface === 'terminal') {
    const { Box, Text, Button, Image } = $.ui.resolve(e)
    const { imagesOff } = await read($, screen)
    if (imagesOff) {
      // No picture can be drawn in this session: say why and how to get it, keep Open as the way to see it now.
      return (
        <Box flexDirection="column">
          <Text bold>{heading}</Text>
          <Text dimColor>{imagesOff === 'tmux' ? words.noImagesTmux : words.noImagesTerminal}</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="open" variant="primary" onPress={launch(openArgv)}>{words.open}</Button>
            {mac && !URL_RE.test(v.source) && <Button key="reveal" onPress={launch(['open', '-R', v.source])}>{words.reveal}</Button>}
          </Box>
          {v.note && <Text dimColor>{v.note}</Text>}
        </Box>
      )
    }
    const width = Math.max(20, (e.viewport?.columns ?? 100) - 4)
    const height = Math.max(8, Math.min(48, (e.viewport?.rows ?? 50) - 8))
    const picture = async (p: Page, maxColumns: number, key: string) => {
      const base64 = await bytesOf($, p.png)
      const size = fit(p.w, p.h, maxColumns, height)
      return <Image key={key} source={{ png: base64 }} columns={size.columns} rows={size.rows} alt={`${v.title}: ${p.name}`} />
    }
    if (!hidden && list.length > 1) {
      const around = [list[(nr + 1) % list.length]!, list[(nr - 1 + list.length) % list.length]!, list[(nr + 2) % list.length]!]
      preloadAround($, [...around.map(p => p.png), ...(v.before && v.before[nr] ? [v.before[nr]!.png] : [])])
    }
    const half = Math.floor((width - 2) / 2)
    const pictures = hidden
      ? null
      : beside
      ? (
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column"><Text dimColor>{words.before}</Text>{await picture(beside, half, 'before')}</Box>
          <Box flexDirection="column"><Text dimColor>{words.after}</Text>{await picture(afterPage, half, 'after')}</Box>
        </Box>
      )
      : await picture(page, width, 'picture')
    return (
      <Box flexDirection="column">
        <Text bold>{heading}</Text>
        {pictures}
        <Box flexDirection="row" gap={1}>{controls(Button, Text, true)}</Box>
        {v.note && <Text dimColor>{v.note}</Text>}
      </Box>
    )
  }

  // Claude app, desktop, VS Code: an Svg with the JPEG embedded
  const { Box, Text, Button, Svg } = $.ui.resolve(e)
  const svgOf = async (p: Page) => {
    const base64 = await bytesOf($, p.jpg)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${p.w} ${p.h}"><image href="data:image/jpeg;base64,${base64}" x="0" y="0" width="${p.w}" height="${p.h}"/></svg>`
  }
  const shown = beside ? [beside, afterPage] : [page]
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{heading}</Text>
      {!hidden && <Box flexDirection="row" gap={1}>
        {await Promise.all(shown.map(async (p, i) => (
          <Svg source={await svgOf(p)} alt={`${v.title}${beside ? (i === 0 ? ` ${words.before}` : ` ${words.after}`) : ''}`} width={beside ? 300 : 620} />
        )))}
      </Box>}
      <Box flexDirection="row" gap={1}>{controls(Button, Text, false)}</Box>
      {v.note && <Text dimColor>{v.note}</Text>}
    </Box>
  )
}

// ---------------------------------------------------------------- the "show me" button on Read rows
//
// Nothing runs until the person presses it:
//   terminal  PNG the model read → drawn from the bytes Claude Code already holds
//             JPEG/WebP/GIF      → converted once, the terminal reads the file itself
//             PDF                → the full viewer, pages to turn
//   app       the original file is sent as a file card (no conversion)

const OPEN = { plugin: 'show-me', key: 'open' } as const
const readPaths = new Map<string, string>() // tool_use_id → the path Read was given
const converted = new Map<string, { file: string; png?: string; w: number; h: number }>()

type ReadImage = { type: 'image'; file: { base64: string; type: string; dimensions?: { originalWidth?: number; originalHeight?: number; displayWidth?: number; displayHeight?: number } } }
type ReadPdf = { type: 'pdf' | 'parts'; file: { filePath: string } }

function remember(id: string, path: string) {
  readPaths.set(id, path)
  if (readPaths.size > 500) readPaths.delete(readPaths.keys().next().value!)
}

async function buttonsOff($: any): Promise<boolean> {
  return (await $.store.get('buttons').catch(() => undefined)) === 'off'
}

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

async function readSource($: any, id: string, out: ReadImage | ReadPdf): Promise<string> {
  const known = readPaths.get(id)
  if (known) return known
  if (out.type !== 'image') return out.file.filePath
  const ext = EXTENSIONS[out.file.type] ?? 'png'
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, '')
  const target = `${await privateDir($)}/read-${safeId}.${ext}`
  // noclobber: never write through a file or link that is already there
  await runOn($, ['sh', '-c', 'rm -f "$1" && set -C && (base64 -d 2>/dev/null || base64 -D) > "$1"', 'sh', target], 30_000, out.file.base64)
  return target
}

async function pressInApp($: any, id: string, out: ReadImage | ReadPdf) {
  const file = await readSource($, id, out)
  await $.tool.call({ tool: 'SendUserFile', files: [file], status: 'normal', display: 'render', caption: file.split('/').pop() })
}

async function pressInTerminal($: any, id: string, out: ReadImage | ReadPdf) {
  const { value: isOpen = false } = await $.state.get({ ...OPEN, id })
  if (!isOpen) {
    if (out.type === 'image' && out.file.type !== 'image/png' && !converted.has(id)) {
      const source = await readSource($, id, out)
      const dir = await cacheDirFor($, source)
      const page = await pageFromPicture($, source, dir, 'read', '')
      converted.set(id, { file: page.png, w: page.w, h: page.h })
    }
    if (out.type !== 'image' && !(await read($, views))[id]) {
      await createView($, id, { file: out.file.filePath, title: out.file.filePath.split('/').pop() })
    }
  }
  await update($, { ...OPEN, id }, (v: boolean | undefined) => !v)
}

async function readPicture($: any, e: any, id: string, out: ReadImage) {
  const { Image, Text } = $.ui.resolve(e)
  const { imagesOff } = await read($, screen)
  if (imagesOff) {
    const { words } = await hostOf($)
    return <Text dimColor>{imagesOff === 'tmux' ? words.noImagesTmux : words.noImagesTerminal}</Text>
  }
  const inTmux = Boolean(await $.env.get('TMUX'))
  const d = out.file.dimensions ?? {}
  let width = d.displayWidth ?? d.originalWidth ?? 1200
  let height = d.displayHeight ?? d.originalHeight ?? 800
  let source: Record<string, unknown>
  const done = converted.get(id)
  if (out.file.type === 'image/png' && out.file.base64.length * 0.75 <= 2_000_000) {
    source = { png: out.file.base64 } // already in memory: nothing read, nothing converted
  } else if (done) {
    width = done.w
    height = done.h
    if (inTmux) {
      done.png ??= (await $.fs.read(done.file, { as: 'bytes' })).base64
      source = { png: done.png }
    } else source = { file: done.file, format: 'png' } // the terminal reads the file itself
  } else return undefined
  const size = fit(width, height, Math.min(90, Math.max(20, (e.viewport?.columns ?? 100) - 6)), 24)
  return <Image key="read" source={source} columns={size.columns} rows={size.rows} alt="read image" />
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    const path = String((e as { file_path?: unknown }).file_path ?? '')
    if (IMAGE.test(path) || PDF.test(path)) remember(e.tool_use_id, path)
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolResult', props: { tool: 'Read' } }, async ($, e, next) => {
    const props = e.props as { output?: unknown; isErrored?: boolean }
    const out = props.output as ReadImage | ReadPdf | undefined
    if (props.isErrored || !out || !['image', 'pdf', 'parts'].includes(out.type)) return next(e)
    if (await buttonsOff($)) return next(e)
    const id = e.requestId
    const own = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const terminal = e.surface === 'terminal'
    const { value: isOpen = false } = terminal ? await $.state.get({ ...OPEN, id }) : { value: false }
    const { words } = await hostOf($)
    const press = terminal ? () => void pressInTerminal($, id, out) : () => void pressInApp($, id, out)
    const row = (
      <Box flexDirection="row" gap={1}>
        {own}
        <Button key="show-me" onPress={press}>{isOpen ? words.hide : 'show me'}</Button>
      </Box>
    )
    if (!isOpen) return row
    if (out.type === 'image') {
      const picture = await readPicture($, e, id, out)
      return <Box flexDirection="column">{row}{picture}</Box>
    }
    const v = (await read($, views))[id]
    return v ? <Box flexDirection="column">{row}{await drawView($, e, id, v)}</Box> : row
  })

  on('session.start', async ($, e, next) => {
    // Before readyTmux: what counts is how tmux stood when this session started
    const found = await checkScreen($).catch(() => ({}) as Screen)
    await update($, screen, () => found)
    await readyTmux($).catch(() => undefined)
    await $.tool.register({
      name: 'show',
      description: DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Absolute path (image, PDF, video, .html) or an https address.' },
          before: { type: 'string', description: 'Optional: path or address of the old version, for before/after.' },
          title: { type: 'string', description: 'Optional: a short title above the viewer.' },
          note: { type: 'string', description: 'Optional: one sentence below the viewer (what changed).' },
        },
        required: ['file'],
      },
    })
    await $.command.register({ name: 'show-me', description: 'Show a file in the chat: /show-me <path> [before=<path>]', argumentHint: '<path> [before=<path>]' })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { tool_use_id: string; file: string; before?: string; title?: string; note?: string }
    try {
      return { result: await createView($, input.tool_use_id, input) }
    } catch (error) {
      return { result: `Could not show it: ${(error as Error).message}`, isError: true }
    }
  }).catch(() => ({ result: 'show-me: the viewer failed.', isError: true }))

  on('command.run', { command: 'show-me' }, async ($, e) => {
    const { words } = await hostOf($)
    const args = String((e as any).args ?? '').trim()
    if (!args) return { text: words.usage }
    const toggle = /^buttons\s+(on|off)$/i.exec(args)
    if (toggle) {
      await $.store.set('buttons', toggle[1]!.toLowerCase())
      return { text: toggle[1]!.toLowerCase() === 'off' ? words.buttonsOff : words.buttonsOn }
    }
    const before = (/\bbefore=(\S+)/.exec(args) ?? [])[1]
    const file = args.replace(/\bbefore=\S+/, '').trim()
    const id = `cmd-${Date.now().toString(36)}`
    try {
      const sentence = await createView($, id, { file, ...(before ? { before } : {}) })
      return { text: `${sentence}\n${MARK} ${id}` }
    } catch (error) {
      return { text: `${words.failed}: ${(error as Error).message}` }
    }
  })

  on('ui.render', { component: 'ToolResult', props: { tool: TOOL } }, async ($, e, next) => {
    const props = e.props as { isErrored?: boolean; isExpanded?: boolean }
    if (props.isErrored || props.isExpanded) return next(e)
    const v = (await read($, views))[e.requestId]
    if (!v) return next(e)
    return drawView($, e, e.requestId, v)
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'show-me' } }, async ($, e, next) => {
    const text = String((e.props as { text?: string }).text ?? '')
    const line = text.split('\n').findLast(l => l.includes(MARK)) ?? ''
    const id = line.slice(line.indexOf(MARK) + MARK.length).trim()
    const v = id ? (await read($, views))[id] : undefined
    if (!v) return next(e)
    return drawView($, e, id, v)
  })
}
