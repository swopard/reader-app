# Voice Reader

A simple browser app for listening to pasted text. Paste or type an article, hit
Play, and it's read aloud using your browser's built-in text-to-speech engine
(the Web Speech API). Nothing is uploaded anywhere — everything runs locally
in the browser.

## Features

- Paste, type, or load a `.txt` file into the text box
- Play / Pause / Stop controls
- Voice, speed, pitch, and volume controls
- Live word highlighting as it's read
- Draft text and settings are remembered between visits (via `localStorage`)

## Running it

No build step or dependencies required — it's a static site.

```bash
# from the project directory
python3 -m http.server 8000
# or: npx serve .
```

Then open http://localhost:8000 in a modern browser (Chrome, Edge, or Safari
have the best Web Speech API support; Firefox support varies by platform).

You can also just open `index.html` directly in a browser, though some
browsers restrict clipboard access (the "Paste from clipboard" button) on
`file://` pages — pasting directly into the text box with Ctrl/Cmd+V always
works.

## Notes

- Available voices depend on your OS/browser. The voice list populates once
  the browser reports its installed voices (this can take a moment on first
  load).
- Long articles are automatically split into smaller chunks for the speech
  engine, which avoids a known Chrome bug where speech can stop unexpectedly
  on very long text.
