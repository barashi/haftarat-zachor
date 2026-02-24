let currentAudio = null;
let currentBox = null;

const AUDIO_DIR = "audio/";

function setStatus(msg) {
  const el = document.getElementById("status");
  if (el) el.textContent = msg;
  console.log("[STATUS]", msg);
}

function clearHighlight() {
  if (currentBox) {
    currentBox.classList.remove("playing");
    currentBox = null;
  }
}

function setHighlightById(boxId) {
  clearHighlight();
  const box = document.getElementById(boxId);
  if (box) {
    box.classList.add("playing");
    currentBox = box;
  }
}

function stopAudio() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch (e) {
      console.error("stopAudio error:", e);
    }
    currentAudio = null;
  }
  clearHighlight();
  setStatus("⏹ נעצר.");
}

function fullPath(fileName) {
  return encodeURI(AUDIO_DIR + fileName);
}

function wireCommonAudioEvents(audio, label) {
  audio.addEventListener("playing", () => setStatus("▶ מנגן: " + label));
  audio.addEventListener("ended", () => {
    setStatus("✅ הסתיים: " + label);
    clearHighlight();
  });
  audio.addEventListener("error", () => {
    setStatus("❌ שגיאת טעינה/ניגון: " + label);
    console.error("Audio error object:", audio.error);
    clearHighlight();
  });
}

async function playAudio(fileName, boxId = null, speed = 1.0) {
  const url = fullPath(fileName);
  const label = fileName;

  try {
    // עצירת ניגון קודם
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }

    // Highlight
    if (boxId) setHighlightById(boxId);
    else clearHighlight();

    setStatus("טוען: " + label + (speed !== 1 ? ` (מהירות ×${speed})` : ""));

    const audio = new Audio(url);
    currentAudio = audio;

    wireCommonAudioEvents(audio, label);

    // מהירות
    audio.playbackRate = speed;

    await audio.play();
  } catch (err) {
    setStatus("❌ play() נכשל: " + (err?.message || err));
    console.error("playAudio failed:", err);
    clearHighlight();
  }
}

function playLoop(fileName, times, boxId = null, speed = 1.0) {
  const url = fullPath(fileName);
  const label = fileName;

  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }

    if (boxId) setHighlightById(boxId);
    else clearHighlight();

    let count = 0;
    setStatus(`🔁 לופ ${times}x: ${label}` + (speed !== 1 ? ` (×${speed})` : ""));

    const audio = new Audio(url);
    currentAudio = audio;

    audio.playbackRate = speed;

    audio.addEventListener("playing", () => {
      setStatus(`🔁 מנגן (${count + 1}/${times}): ${label}` + (speed !== 1 ? ` (×${speed})` : ""));
    });

    audio.addEventListener("ended", async () => {
      if (currentAudio !== audio) return;

      count++;
      if (count < times) {
        audio.currentTime = 0;
        try {
          audio.playbackRate = speed;
          await audio.play();
        } catch (e) {
          setStatus("❌ play() נכשל בלופ: " + (e?.message || e));
          clearHighlight();
        }
      } else {
        setStatus("✅ סיום לופ: " + label);
        clearHighlight();
      }
    });

    audio.addEventListener("error", () => {
      setStatus("❌ שגיאת טעינה/ניגון בלופ: " + label);
      console.error("Audio error object:", audio.error);
      clearHighlight();
    });

    audio.play().catch(e => {
      setStatus("❌ play() נחסם/נכשל: " + (e?.message || e));
      clearHighlight();
    });
  } catch (err) {
    setStatus("❌ playLoop נכשל: " + (err?.message || err));
    console.error("playLoop failed:", err);
    clearHighlight();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setStatus("מוכן.");
});