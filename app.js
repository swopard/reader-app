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
    voices = synth.getVoices();
    if (!voices.length) return;

    const savedVoiceURI = localStorage.getItem(STORAGE_KEYS.voice);
    voiceSelect.innerHTML = "";
    voices.forEach((voice, i) => {
      const option = document.createElement("option");
      option.value = voice.voiceURI;
      option.textContent = `${voice.name} (${voice.lang})${voice.default ? " — default" : ""}`;
      voiceSelect.appendChild(option);
    });

    if (savedVoiceURI && voices.some((v) => v.voiceURI === savedVoiceURI)) {
      voiceSelect.value = savedVoiceURI;
    } else {
      const englishDefault = voices.find((v) => v.default) || voices.find((v) => v.lang.startsWith("en")) || voices[0];
      voiceSelect.value = englishDefault.voiceURI;
    }

    playBtn.disabled = false;
  }

  if (supported) {
    populateVoices();
    if (synth.onvoiceschanged !== undefined) {
      synth.addEventListener("voiceschanged", populateVoices);
    }
  }

  function getSelectedVoice() {
    return voices.find((v) => v.voiceURI === voiceSelect.value) || null;
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
    playBtn.disabled = false;
    playBtn.textContent = "▶ Play";
    pauseBtn.disabled = true;
    pauseBtn.textContent = "⏸ Pause";
    stopBtn.disabled = true;
    textDisplay.setAttribute("contenteditable", "true");
  }

  function startPlayback() {
    const text = getPlainText().trim();
    if (!text) {
      setStatus("Paste some text first.");
      return;
    }

    synth.cancel();
    buildWordSpans(getPlainText());
    chunks = chunkText(getPlainText());
    activeUtterances = [];

    const voice = getSelectedVoice();
    const rate = parseFloat(rateRange.value);
    const pitch = parseFloat(pitchRange.value);
    const volume = parseFloat(volumeRange.value);

    chunks.forEach((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk.text);
      if (voice) utterance.voice = voice;
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
    if (synth.paused) {
      synth.resume();
      playBtn.disabled = true;
      pauseBtn.disabled = false;
      setStatus("Reading…");
      return;
    }
    startPlayback();
  });

  pauseBtn.addEventListener("click", () => {
    if (!isPlaying) return;
    synth.pause();
    playBtn.disabled = false;
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
    localStorage.setItem(STORAGE_KEYS.voice, voiceSelect.value);
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
