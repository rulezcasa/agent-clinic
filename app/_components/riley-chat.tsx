"use client";

/**
 * Patient chat with Riley — one per front-desk tab (booking, check-in). Each tab keeps its own session.
 * The patient talks (browser speech recognition) or types; Riley's reply plays from audio_url (Masky).
 */
import { useEffect, useRef, useState } from "react";
import { speechRecognition, type Recognition, type RecognitionCtor } from "./speech";

export type Desk = "booking" | "checkin";

type Line = { from: "patient" | "riley" | "note" | "error"; text: string; audio?: string | null };

interface ChatResponse {
  session_id: string;
  reply: string;
  audio_url: string | null;
  action: string;
  visit: { id: string; status: string; slot_start: string } | null;
  checked_in: boolean;
  error?: string;
}

/** How long the patient can pause before their turn is sent. */
const SILENCE_MS = 1200;

// Empty WAV, played on the first click so the browser lets later replies play without a click.
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export default function RileyChat({ desk, title, intro, active, avatar }: { desk: Desk; title: string; intro: string; active: boolean; avatar: string | null }) {
  const [lines, setLines] = useState<Line[]>([{ from: "note", text: intro }]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false); // Riley's voice is playing
  const [voice, setVoice] = useState<RecognitionCtor | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  const recognition = useRef<{ cancel(): void } | null>(null); // the open mic, if any
  const session = useRef<string | null>(null); // a ref, so hands-free turns started from old closures keep the session
  const handsFree = useRef(false); // patient used the mic last → listen again after Riley speaks
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVoice(() => speechRecognition());
    audio.current = new Audio();
  }, []);

  // Leaving the tab: stop listening and talking (the chat itself stays).
  useEffect(() => {
    if (active) return;
    stopListening();
    audio.current?.pause();
  }, [active]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [lines, busy]);

  const add = (line: Line) => setLines((l) => [...l, line]);

  function unlockAudio() {
    const a = audio.current;
    if (a && !a.src) {
      a.src = SILENT;
      a.play().catch(() => {});
    }
  }

  function play(url: string) {
    const a = audio.current;
    if (!a) return;
    a.src = url;
    a.onpause = () => setSpeaking(false); // also fires when stopped early
    a.onended = () => {
      setSpeaking(false);
      if (handsFree.current) listen();
    };
    setSpeaking(true);
    a.play().catch((err) => {
      setSpeaking(false);
      add({ from: "error", text: `Couldn't play Riley's voice: ${err.message}` });
    });
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    add({ from: "patient", text: message });
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, desk, ...(session.current ? { session_id: session.current } : {}) }),
      });
      const data = (await res.json()) as ChatResponse;
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      session.current = data.session_id;
      setSessionId(data.session_id);
      add({ from: "riley", text: data.reply, audio: data.audio_url });
      if (data.action === "book") add({ from: "note", text: "Booking sent to the calendar." });
      if (data.checked_in) add({ from: "note", text: "Checked in ✓" });
      if (data.audio_url) play(data.audio_url);
    } catch (err) {
      add({ from: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  /** Patient took over (■, new chat, left the tab): close the mic, keep what was heard in the box, don't send or re-listen. */
  function stopListening() {
    handsFree.current = false;
    recognition.current?.cancel();
  }

  function listen() {
    if (!voice || busy) return;
    audio.current?.pause();
    const r = new voice();
    r.lang = "en-US";
    // Keep listening through pauses; the turn ends after SILENCE_MS with no new words (or the ■ button).
    r.continuous = true;
    r.interimResults = true;
    let heard = "";
    let cancelled = false;
    let silence: ReturnType<typeof setTimeout> | undefined;
    r.onresult = (e) => {
      heard = Array.from(e.results).map((res) => res[0].transcript).join("");
      setDraft(heard);
      clearTimeout(silence);
      silence = setTimeout(() => r.stop(), SILENCE_MS);
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") add({ from: "error", text: `Mic: ${e.error}` });
    };
    r.onend = () => {
      clearTimeout(silence);
      setListening(false);
      recognition.current = null;
      if (!cancelled && heard.trim()) send(heard);
    };
    recognition.current = {
      cancel() {
        cancelled = true;
        r.abort();
      },
    };
    setListening(true);
    r.start();
  }

  function toggleMic() {
    unlockAudio();
    if (listening || speaking) {
      // ■ stops the mic and Riley's voice; then the patient can type.
      stopListening();
      audio.current?.pause();
      return;
    }
    handsFree.current = true;
    listen();
  }

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    unlockAudio();
    handsFree.current = false;
    send(draft);
  }

  function newChat() {
    stopListening();
    audio.current?.pause();
    setDraft("");
    session.current = null;
    setSessionId(null);
    setLines([{ from: "note", text: "New chat started." }]);
  }

  return (
    <section className="chat" hidden={!active}>
      <header>
        <div className="who">
          {avatar && <img className={`face${speaking ? " talking" : ""}`} src={avatar} alt="Riley" />}
          <div>
            <h1>{title}</h1>
            <small>{listening ? "Listening…" : speaking ? "Speaking…" : "Front desk"}</small>
          </div>
        </div>
        {sessionId && (
          <button className="ghost" onClick={newChat}>
            New chat
          </button>
        )}
      </header>

      <div className="log" ref={log}>
        {lines.map((l, i) => (
          <div key={i} className={`msg ${l.from}`}>
            {l.text}
            {l.audio && (
              <button className="replay" onClick={() => play(l.audio!)} title="Play again" aria-label="Play again">
                ▶
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div className="msg riley typing" aria-label="Riley is replying">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <form className="bar" onSubmit={submitTyped}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={listening ? "Listening…" : speaking ? "Riley is speaking…" : "Type a message"}
          disabled={busy || listening || speaking}
        />
        {voice && (
          <button type="button" className={`icon mic${listening || speaking ? " on" : ""}`} onClick={toggleMic} disabled={busy} title={listening || speaking ? "Stop" : "Speak"}>
            {listening || speaking ? "■" : "🎤"}
          </button>
        )}
        <button type="submit" className="icon send" disabled={busy || listening || speaking || !draft.trim()} title="Send" aria-label="Send">
          ↑
        </button>
      </form>
      {!voice && <small className="hint">Voice input needs Chrome or Safari. You can still type.</small>}
    </section>
  );
}
