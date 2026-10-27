<p align="center"><img src=".claude-plugin/icon.png" width="96" alt="show-me icon"></p>

<h1 align="center">claude-show-me</h1>

<p align="center">Say “show me”. Claude shows its work right in the chat:<br>images, PDFs you can page through, video contact sheets, web page screenshots and before/after.<br>In the terminal and in the Claude app.</p>

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install show-me --marketplace azena-ai/claude-show-me
```

Answer `y` to add the marketplace, then pick a scope. The plugin is active right away.

From a shell:

```
claude plugin install show-me --marketplace azena-ai/claude-show-me
```

## The “show me” button

Whenever Claude reads an image or a PDF, Claude Code shows a line like `Read image (45KB)`. show-me puts a button right next to it:

```
  ⎿  Read image (45KB)   [ show me ]
```

Nothing runs until you press it, so it never slows the session down:

- **In the terminal** the picture unfolds below the line (press again to fold it). A PNG is drawn straight from the bytes Claude Code already holds; other formats are converted once and the terminal reads the file itself. A PDF opens in the viewer, pages to turn.
- **In the Claude app** the original file is sent to you as a file card, at full resolution.

Turn the button off or on with `/show-me buttons off` and `/show-me buttons on`.

## What it does

Besides the button, Claude gets a tool, `show`, and you get a command, `/show-me <path>`.

| You give it | You see in the chat |
|---|---|
| an image (png, jpg, webp, gif, heic, tiff …) | the image |
| a PDF | every page (up to 60): page through with ◀ ▶ or jump with the page numbers below the picture |
| a video (mp4, mov, webm …) | a contact sheet of 6 frames, then each frame with its timestamp |
| a web page (https) or a local `.html` file | screenshots at desktop (1440×900) and phone (390×844) size |
| `before=<old file>` | Before / After / Side by side, one click to switch |

Every viewer has **Hide** (folds the picture away, **Show** brings it back), **Open** (in the default app) and, on macOS, **Show in folder**.

**Paging fast:** click the page numbers under the picture (`1 2 3 … 12`). Claude Code reads two quick clicks on the same spot, such as ▶ twice, as a double-click and drops the second, so the numbers are the quick way through a file. The page number moves at once; the picture follows as soon as you stop clicking. Outside tmux the terminal reads the picture file itself, and large PDF pages are reduced to 256 colours, so a page turn sends little.

Ask for it in plain words:

- “Render the invoice as a PDF and show me.”
- “Fix the header and show me before and after.”
- “Cut the teaser and show me the frames.”

Or type it yourself:

```
/show-me ~/Desktop/offer.pdf
/show-me ~/site/new.png before=~/site/old.png
/show-me https://example.com
```

## How it works

```
  Claude calls show (file, before?, title?, note?)
     └─ the plugin prepares the file on your machine
          image  → PNG (≤ 1600 px)            pdf   → pdftoppm, one PNG per page
          video  → ffmpeg, 6 frames + sheet   web   → headless Chrome screenshots
     └─ the chat row draws it
          terminal       → the picture itself (kitty graphics protocol)
          Claude app,    → a small preview (JPEG inside an SVG)
          desktop, VS Code
```

The picture never goes to the model, so showing it costs no tokens. Claude only reads one line saying what was shown.

Following a session from the Claude app (Remote Control) or a background session? There is no terminal to draw in, so the plugin hands Claude the prepared pictures and asks it to send them as files, which arrive in the app.

## Requirements

- Claude Code 2.1.311 or later.
- **Terminal pictures:** Ghostty or kitty (iTerm2 3.5+ in fullscreen mode). Other terminals show a one-line placeholder; the Claude app, desktop and VS Code show the preview.
- **macOS:** works out of the box for images (uses `sips`). Linux uses `ffmpeg` for images.
- **PDF:** `pdftoppm` and `pdfinfo` from poppler (`brew install poppler`, `apt install poppler-utils`).
- **Video:** `ffmpeg` (`brew install ffmpeg`).
- **Web pages:** Google Chrome or Chromium.

### tmux

Inside tmux, pictures need `allow-passthrough` and `focus-events`, and Claude Code checks them **once, when the session starts**: a session started while they were off draws no pictures at all, whatever is switched on later.

- Best: put both in `~/.tmux.conf`, then every new session shows pictures:
  ```
  set -g allow-passthrough on
  set -g focus-events on
  ```
- Without that, the plugin turns both on for its own pane when a session starts (your config file is not changed). A session that started without them says so in the viewer, with an **Open** button; restart Claude Code in that window (`/exit`, then `claude --resume`) and the pictures show.

## Privacy

Everything happens on your machine. No telemetry, no self-updating, no network requests by the plugin. Only a web page you ask it to show is loaded, by your own Chrome. Prepared pictures are cached in a folder only you can read: `$TMPDIR/show-me/` when `TMPDIR` belongs to you alone (as on macOS), else `$XDG_RUNTIME_DIR/show-me/` or `~/.cache/show-me/`. The plugin checks owner and permissions before writing and never uses a shared `/tmp`.

## Auf Deutsch

`show-me` lässt Claude Bilder, PDFs (zum Blättern), Video-Kontaktbögen, Webseiten-Screenshots und Vorher/Nachher direkt im Chat zeigen, im Terminal und in der Claude-App. Ist die Systemsprache Deutsch, sind auch die Knöpfe deutsch. Installieren mit `/plugin install show-me --marketplace azena-ai/claude-show-me`.

## Credits

Inspired by [claude-show-your-work](https://github.com/iamumeransari/claude-show-your-work) by Umer Ansari. show-me is a separate implementation that adds PDFs, web page screenshots and the Claude app preview.

Made by [azena.ai](https://azena.ai). MIT license.
