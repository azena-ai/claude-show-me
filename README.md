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
| a PDF | every page (up to 60), page through with ◀ ▶ |
| a video (mp4, mov, webm …) | a contact sheet of 6 frames, then each frame with its timestamp |
| a web page (https) or a local `.html` file | screenshots at desktop (1440×900) and phone (390×844) size |
| `before=<old file>` | Before / After / Side by side, one click to switch |

Every viewer has **Open** (in the default app) and, on macOS, **Show in folder**.

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

Inside tmux, pictures need `allow-passthrough` (for the pane) and `focus-events`. The plugin turns both on for the running tmux session the first time it shows something; your tmux config file is not changed. If pictures still show as text, start Claude Code with `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`.

## Privacy

Everything happens on your machine. No telemetry, no self-updating, no network requests by the plugin. Only a web page you ask it to show is loaded, by your own Chrome. Prepared pictures are cached in `$TMPDIR/show-me/`.

## Auf Deutsch

`show-me` lässt Claude Bilder, PDFs (zum Blättern), Video-Kontaktbögen, Webseiten-Screenshots und Vorher/Nachher direkt im Chat zeigen, im Terminal und in der Claude-App. Ist die Systemsprache Deutsch, sind auch die Knöpfe deutsch. Installieren mit `/plugin install show-me --marketplace azena-ai/claude-show-me`.

## Credits

Inspired by [claude-show-your-work](https://github.com/iamumeransari/claude-show-your-work) by Umer Ansari. show-me is a separate implementation that adds PDFs, web page screenshots and the Claude app preview.

Made by [azena.ai](https://azena.ai). MIT license.
