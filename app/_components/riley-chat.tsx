"use client";

/**
 * Patient chat with Riley — one per front-desk tab (booking, check-in). Each tab keeps its own session.
 * The patient talks (browser speech recognition) or types; Riley's reply plays from audio_url (Masky).
 */
import { useEffect, useRef, useState } from "react";

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

// Minimal Web Speech API types (not in TypeScript's DOM lib).
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

/** How long the patient can pause before their turn is sent. */
const SILENCE_MS = 2500;

// Empty WAV, played on the first click so the browser lets later replies play without a click.
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export default function RileyChat({ desk, title, intro, active }: { desk: Desk; title: string; intro: string; active: boolean }) {
  const [lines, setLines] = useState<Line[]>([{ from: "note", text: intro }]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState<RecognitionCtor | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const session = useRef<string | null>(null); // a ref, so hands-free turns started from old closures keep the session
  const handsFree = useRef(false); // patient used the mic last → listen again after Riley speaks
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    setVoice(() => w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null);
    audio.current = new Audio();
  }, []);

  // Leaving the tab: stop listening and talking (the chat itself stays).
  useEffect(() => {
    if (active) return;
    handsFree.current = false;
    recognition.current?.stop();
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
    a.onended = () => {
      if (handsFree.current) listen();
    };
    a.play().catch((err) => add({ from: "error", text: `Couldn't play Riley's voice: ${err.message}` }));
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

  function listen() {
    if (!voice || busy) return;
    audio.current?.pause();
    const r = new voice();
    r.lang = "en-US";
    // Keep listening through pauses; the turn ends after SILENCE_MS with no new words (or the ■ button).
    r.continuous = true;
    r.interimResults = true;
    let heard = "";
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
      if (heard.trim()) send(heard);
    };
    recognition.current = r;
    setListening(true);
    r.start();
  }

  function toggleMic() {
    unlockAudio();
    if (listening) {
      recognition.current?.stop();
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
    recognition.current?.stop();
    audio.current?.pause();
    handsFree.current = false;
    session.current = null;
    setSessionId(null);
    setLines([{ from: "note", text: "New chat started." }]);
  }

  return (
    <section className="chat" hidden={!active}>
      <header>
        <div>
          <h1>{title}</h1>
          <small>{busy ? "Riley is replying…" : listening ? "Listening…" : sessionId ? `Session ${sessionId.slice(0, 8)}` : "New chat"}</small>
        </div>
        <button onClick={newChat}>New chat</button>
      </header>

      <div className="log" ref={log}>
        {lines.map((l, i) => (
          <div key={i} className={`msg ${l.from}`}>
            {l.text}
            {l.audio && (
              <button onClick={() => play(l.audio!)} title="Play again">
                🔊
              </button>
            )}
          </div>
        ))}
        {busy && <div className="msg note">Riley is replying…</div>}
      </div>

      <form className="bar" onSubmit={submitTyped}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={listening ? "Listening…" : "Type a message"} disabled={busy} />
        {voice && (
          <button type="button" className={`mic${listening ? " on" : ""}`} onClick={toggleMic} disabled={busy} title={listening ? "Stop" : "Speak"}>
            {listening ? "■" : "🎤"}
          </button>
        )}
        <button type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
      {!voice && <small style={{ color: "var(--muted)" }}>Voice input needs Chrome or Safari. You can still type.</small>}
    </section>
  );
}
