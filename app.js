(() => {
  const textDisplay = document.getElementById("textDisplay");
  const fileInput = document.getElementById("fileInput");
  const pasteBtn = document.getElementById("pasteBtn");
  const clearBtn = document.getElementById("clearBtn");
  const wordCountEl = document.getElementById("wordCount");

  const playBtn = document.getElementById("playBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const stopBtn = document.getElementById("stopBtn");

  const voiceSelect = document.getElementById("voiceSelect");
  const rateRange = document.getElementById("rateRange");
  const pitchRange = document.getElementById("pitchRange");
  const volumeRange = document.getElementById("volumeRange");
  const rateValue = document.getElementById("rateValue");
  const pitchValue = document.getElementById("pitchValue");
  const volumeValue = document.getElementById("volumeValue");

  const statusEl = document.getElementById("status");

  const STORAGE_KEYS = {
    text: "voice-reader:text",
    voice: "voice-reader:voice",
    rate: "voice-reader:rate",
    pitch: "voice-reader:pitch",
    volume: "voice-reader:volume",
  };

  const synth = window.speechSynthesis;
  const supported = !!synth;

  let voices = [];
  let chunks = [];
  let spans = [];
  let spanPointer = 0;
  let activeUtterances = [];
  let isPlaying = false;
  let isPaused = false;
  let pauseOffset = 0;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function getPlainText() {
    return textDisplay.innerText.replace(/ /g, " ");
  }

  function updateWordCount() {
    const text = getPlainText().trim();
    const words = text.length ? text.split(/\s+/).length : 0;
    wordCountEl.textContent = `${words} word${words === 1 ? "" : "s"}`;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function saveDraft() {
    try {
      localStorage.setItem(STORAGE_KEYS.text, getPlainText());
    } catch (e) {
      /* ignore storage errors (e.g. private browsing) */
    }
  }

  function loadDraft() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.text);
      if (saved) {
        textDisplay.innerText = saved;
      }
    } catch (e) {
      /* ignore */
    }
  }

  // ---------- Voices ----------

  function populateVoices() {
    const newVoices = synth.getVoices();
    if (!newVoices.length) return;

    // Preserve whatever is currently selected (it may not be saved to
    // storage yet) so a repeat "voiceschanged" firing doesn't reset the
    // user's pick back to the default voice mid-session.
    const currentlySelected = voiceSelect.selectedOptions[0];
    const preferredURI =
      (currentlySelected && currentlySelected.dataset.uri) || localStorage.getItem(STORAGE_KEYS.voice);

    voices = newVoices;
    voiceSelect.innerHTML = "";
    voices.forEach((voice, i) => {
      const option = document.createElement("option");
      // Some browsers reuse/duplicate voiceURI values across voices, so the
      // option's value is the voice's index in `voices` (always unique) —
      // the voiceURI is kept separately for persisting the choice across
      // reloads.
      option.value = String(i);
      option.dataset.uri = voice.voiceURI;
      option.textContent = `${voice.name} (${voice.lang})${voice.default ? " — default" : ""}`;
      voiceSelect.appendChild(option);
    });

    let indexToSelect = preferredURI ? voices.findIndex((v) => v.voiceURI === preferredURI) : -1;
    if (indexToSelect === -1) indexToSelect = voices.findIndex((v) => v.default);
    if (indexToSelect === -1) indexToSelect = voices.findIndex((v) => v.lang.startsWith("en"));
    if (indexToSelect === -1) indexToSelect = 0;

    voiceSelect.value = String(indexToSelect);
    playBtn.disabled = false;
  }

  if (supported) {
    populateVoices();
    if (synth.onvoiceschanged !== undefined) {
      synth.addEventListener("voiceschanged", populateVoices);
    }
  }

  function getSelectedVoice() {
    const index = Number(voiceSelect.value);
    return Number.isInteger(index) ? voices[index] || null : null;
  }

  // ---------- Text chunking & highlighting ----------

  function chunkText(text, maxLen = 180) {
    const result = [];
    let start = 0;
    const len = text.length;

    while (start < len) {
      let end = Math.min(start + maxLen, len);

      if (end < len) {
        let sentenceEnd = -1;
        for (const marker of [". ", "! ", "? ", ".\n", "!\n", "?\n"]) {
          const i = text.lastIndexOf(marker, end);
          if (i > start && i + marker.length - 1 > sentenceEnd) {
            sentenceEnd = i + marker.length - 1;
          }
        }
        if (sentenceEnd > start) {
          end = sentenceEnd;
        } else {
          const spaceBoundary = text.lastIndexOf(" ", end);
          if (spaceBoundary > start) end = spaceBoundary + 1;
        }
      }

      result.push({ text: text.slice(start, end), startOffset: start });
      start = end;
    }

    return result;
  }

  function buildWordSpans(text) {
    const wordRe = /\S+/g;
    let html = "";
    let cursor = 0;
    let match;

    while ((match = wordRe.exec(text))) {
      html += escapeHtml(text.slice(cursor, match.index));
      const start = match.index;
      const end = start + match[0].length;
      html += `<span class="word" data-start="${start}" data-end="${end}">${escapeHtml(match[0])}</span>`;
      cursor = end;
    }
    html += escapeHtml(text.slice(cursor));

    textDisplay.innerHTML = html;
    spans = Array.from(textDisplay.querySelectorAll(".word")).map((el) => ({
      el,
      start: Number(el.dataset.start),
      end: Number(el.dataset.end),
    }));
    spanPointer = 0;
  }

  function clearHighlight() {
    const current = textDisplay.querySelector(".word-highlight");
    if (current) current.classList.remove("word-highlight");
  }

  function highlightAt(globalIndex) {
    if (!spans.length) return;
    while (spanPointer < spans.length - 1 && spans[spanPointer].end <= globalIndex) {
      spanPointer++;
    }
    clearHighlight();
    const target = spans[spanPointer].el;
    target.classList.add("word-highlight");
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---------- Playback ----------

  function resetPlaybackUI() {
    isPlaying = false;
    isPaused = false;
    pauseOffset = 0;
    playBtn.disabled = false;
    playBtn.textContent = "▶ Play";
    pauseBtn.disabled = true;
    pauseBtn.textContent = "⏸ Pause";
    stopBtn.disabled = true;
    textDisplay.setAttribute("contenteditable", "true");
  }

  // fromOffset resumes playback from a character offset into the full text
  // (used after Pause) instead of starting over from the beginning. Native
  // speechSynthesis.pause()/resume() is unreliable across browsers (it can
  // silently no-op or fail to resume), so pausing fully cancels playback and
  // remembers where to pick back up instead.
  function startPlayback(fromOffset = 0) {
    const fullText = getPlainText();
    const text = fullText.trim();
    if (!text) {
      setStatus("Paste some text first.");
      return;
    }

    synth.cancel();

    if (fromOffset > 0) {
      spanPointer = spans.findIndex((s) => s.start >= fromOffset);
      if (spanPointer === -1) spanPointer = Math.max(spans.length - 1, 0);
    } else {
      buildWordSpans(fullText);
    }

    chunks = chunkText(fullText.slice(fromOffset)).map((c) => ({
      text: c.text,
      startOffset: c.startOffset + fromOffset,
    }));
    activeUtterances = [];

    const voice = getSelectedVoice();
    const rate = parseFloat(rateRange.value);
    const pitch = parseFloat(pitchRange.value);
    const volume = parseFloat(volumeRange.value);

    chunks.forEach((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk.text);
      if (voice) {
        utterance.voice = voice;
        // Some browsers (notably Safari/iOS) fall back to a default voice
        // if `lang` doesn't match the chosen voice's language.
        utterance.lang = voice.lang;
      }
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;

      utterance.onboundary = (event) => {
        if (event.name && event.name !== "word") return;
        highlightAt(chunk.startOffset + event.charIndex);
      };

      utterance.onstart = () => {
        setStatus(`Reading… (${i + 1}/${chunks.length})`);
      };

      utterance.onerror = (e) => {
        if (e.error === "interrupted" || e.error === "canceled") return;
        setStatus(`Speech error: ${e.error}`);
        resetPlaybackUI();
      };

      if (i === chunks.length - 1) {
        utterance.onend = () => {
          clearHighlight();
          setStatus("Finished reading.");
          resetPlaybackUI();
        };
      }

      activeUtterances.push(utterance);
      synth.speak(utterance);
    });

    isPlaying = true;
    playBtn.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    textDisplay.setAttribute("contenteditable", "false");
    setStatus("Reading…");
  }

  playBtn.addEventListener("click", () => {
    if (isPaused) {
      const resumeFrom = pauseOffset;
      isPaused = false;
      pauseOffset = 0;
      startPlayback(resumeFrom);
      return;
    }
    startPlayback();
  });

  pauseBtn.addEventListener("click", () => {
    if (!isPlaying) return;
    // Remember the word currently being read so Play can resume from here.
    pauseOffset = spans[spanPointer] ? spans[spanPointer].start : 0;
    synth.cancel();
    isPlaying = false;
    isPaused = true;
    playBtn.disabled = false;
    playBtn.textContent = "▶ Resume";
    pauseBtn.disabled = true;
    setStatus("Paused.");
  });

  stopBtn.addEventListener("click", () => {
    synth.cancel();
    clearHighlight();
    setStatus("Stopped.");
    resetPlaybackUI();
  });

  // ---------- Settings ----------

  rateRange.addEventListener("input", () => {
    rateValue.textContent = `${parseFloat(rateRange.value).toFixed(1)}x`;
    localStorage.setItem(STORAGE_KEYS.rate, rateRange.value);
  });

  pitchRange.addEventListener("input", () => {
    pitchValue.textContent = parseFloat(pitchRange.value).toFixed(1);
    localStorage.setItem(STORAGE_KEYS.pitch, pitchRange.value);
  });

  volumeRange.addEventListener("input", () => {
    volumeValue.textContent = `${Math.round(parseFloat(volumeRange.value) * 100)}%`;
    localStorage.setItem(STORAGE_KEYS.volume, volumeRange.value);
  });

  voiceSelect.addEventListener("change", () => {
    const voice = getSelectedVoice();
    if (voice) localStorage.setItem(STORAGE_KEYS.voice, voice.voiceURI);
  });

  function restoreSettings() {
    const rate = localStorage.getItem(STORAGE_KEYS.rate);
    const pitch = localStorage.getItem(STORAGE_KEYS.pitch);
    const volume = localStorage.getItem(STORAGE_KEYS.volume);
    if (rate) {
      rateRange.value = rate;
      rateValue.textContent = `${parseFloat(rate).toFixed(1)}x`;
    }
    if (pitch) {
      pitchRange.value = pitch;
      pitchValue.textContent = parseFloat(pitch).toFixed(1);
    }
    if (volume) {
      volumeRange.value = volume;
      volumeValue.textContent = `${Math.round(parseFloat(volume) * 100)}%`;
    }
  }

  // ---------- Text input handling ----------

  textDisplay.addEventListener("input", () => {
    updateWordCount();
    saveDraft();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      textDisplay.innerText = String(reader.result);
      updateWordCount();
      saveDraft();
      setStatus(`Loaded "${file.name}".`);
    };
    reader.readAsText(file);
    fileInput.value = "";
  });

  pasteBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        textDisplay.innerText = text;
        updateWordCount();
        saveDraft();
        setStatus("Pasted from clipboard.");
      }
    } catch (e) {
      setStatus("Clipboard access denied — try pasting directly into the text box (Ctrl/Cmd+V).");
    }
  });

  clearBtn.addEventListener("click", () => {
    synth.cancel();
    resetPlaybackUI();
    textDisplay.innerText = "";
    updateWordCount();
    saveDraft();
    setStatus("Cleared. Paste some text to get started.");
  });

  // ---------- Init ----------

  if (!supported) {
    setStatus("Sorry, your browser doesn't support the Web Speech API (speech synthesis).");
    [playBtn, pauseBtn, stopBtn, voiceSelect, rateRange, pitchRange, volumeRange].forEach(
      (el) => (el.disabled = true)
    );
  } else {
    restoreSettings();
    loadDraft();
    updateWordCount();
    resetPlaybackUI();
  }
})();
