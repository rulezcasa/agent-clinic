"use client";

/**
 * One consult. The doctor and patient talk; the browser transcribes one unlabeled transcript
 * (Dr. Sage is listening, never replying, and works out who said what).
 * "Generate prescription" sends the transcript to Dr. Sage → draft + code warnings → the doctor edits and saves it
 * (saving = approving) → BAND handoff to Pax, who checks formulary + stock and dispenses
 * (or flags it back to the doctor to edit and save again).
 */
import { useEffect, useRef, useState } from "react";
import { speechRecognition, type Recognition, type RecognitionCtor } from "./speech";

interface RxItem {
  drug: string;
  dose: string;
  frequency: string;
  days: number;
  quantity: number;
}
interface RxIssue {
  kind: string;
  drug: string;
  detail: string;
  alternatives: string[];
}
/** A prescription row as the doctor types it; numbers stay strings until saved. Blank qty = derived. */
type EditItem = { drug: string; dose: string; frequency: string; days: string; quantity: string };
const toEdit = (items: RxItem[]): EditItem[] => items.map((i) => ({ ...i, days: String(i.days), quantity: String(i.quantity) }));
const BLANK: EditItem = { drug: "", dose: "", frequency: "", days: "", quantity: "" };
interface Visit {
  id: string;
  status: string;
  reason: string | null;
  rx: { items: RxItem[]; notes: string; summary: string; revision: number } | null;
  rx_safety: { status: string; issues: RxIssue[]; source: string; explanation?: string; recommendation?: string } | null;
  rx_approved_by: string | null;
  dispensed: { name: string; quantity: number }[] | null;
}
interface Patient {
  full_name: string;
  dob: string;
  allergies: { substance: string; severity: string; reaction?: string }[];
}

// Per-browser convenience: keep the transcript if the page reloads mid-consult.
const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage blocked: the transcript just won't survive a reload */
    }
  },
};

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export default function ConsultRoom({ visitId, onChange }: { visitId: string; onChange: () => void }) {
  const [visit, setVisit] = useState<Visit | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState<RecognitionCtor | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doctorName, setDoctorName] = useState("");
  const [edit, setEdit] = useState<EditItem[]>([]);

  const recognition = useRef<Recognition | null>(null);
  const keepListening = useRef(false); // browsers end recognition after a pause; restart while this is on
  const log = useRef<HTMLDivElement>(null);
  const storeKey = `consult:${visitId}`;

  useEffect(() => {
    setVoice(() => speechRecognition());
    // Older saved transcripts had {speaker, text} lines.
    setLines(store.get<(string | { text: string })[]>(storeKey, []).map((l) => (typeof l === "string" ? l : l.text)));
    setDoctorName(store.get("doctor_name", ""));
    call<{ visit: Visit; patient: Patient }>(`/api/visits/${visitId}`)
      .then((d) => {
        setVisit(d.visit);
        setPatient(d.patient);
      })
      .catch((err) => setError(err.message));
    return () => {
      keepListening.current = false;
      recognition.current?.stop();
    };
  }, [visitId, storeKey]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [lines, interim]);
  // A new draft or saved prescription: show it in the editor.
  const rx = visit?.rx;
  useEffect(() => {
    setEdit(rx ? toEdit(rx.items) : []);
  }, [rx]);

  const updateLines = (fn: (l: string[]) => string[]) =>
    setLines((l) => {
      const next = fn(l);
      store.set(storeKey, next);
      return next;
    });

  const addLine = (text: string) => {
    if (text.trim()) updateLines((l) => [...l, text.trim()]);
  };

  function startListening() {
    if (!voice) return;
    const r = new voice();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) addLine(e.results[i][0].transcript);
        else pending += e.results[i][0].transcript;
      }
      setInterim(pending);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") keepListening.current = false;
      if (e.error !== "no-speech" && e.error !== "aborted") setError(`Mic: ${e.error}`);
    };
    r.onend = () => {
      setInterim("");
      if (keepListening.current) return r.start();
      recognition.current = null;
      setListening(false);
    };
    recognition.current = r;
    keepListening.current = true;
    setListening(true);
    r.start();
  }

  function stopListening() {
    keepListening.current = false;
    recognition.current?.stop();
  }

  async function act(label: string, fn: () => Promise<Visit>) {
    setBusy(label);
    setError(null);
    try {
      setVisit(await fn());
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const generate = () => {
    stopListening();
    const transcript = lines.join("\n");
    act("Dr. Sage is drafting the prescription…", () => call(`/api/visits/${visitId}/consult`, { transcript }));
  };

  /** Saving the prescription as edited is the doctor's approval. */
  const save = () => {
    store.set("doctor_name", doctorName);
    act("Pax is checking the formulary and stock…", () =>
      call(`/api/visits/${visitId}/rx/approve`, {
        approved_by: doctorName.trim(),
        items: edit
          .filter((i) => i.drug.trim())
          .map((i) => ({ drug: i.drug.trim(), dose: i.dose.trim(), frequency: i.frequency.trim(), days: Number(i.days), quantity: i.quantity.trim() ? Number(i.quantity) : null })),
      }),
    );
  };

  const setCell = (row: number, field: keyof EditItem, value: string) => setEdit((e) => e.map((r, i) => (i === row ? { ...r, [field]: value } : r)));

  if (!visit || !patient) return <section className="room">{error ? <p className="err">{error}</p> : <p className="muted">Loading…</p>}</section>;

  const s = visit.status;
  const canGenerate = (s === "CHECKED_IN" || s === "IN_CONSULT") && lines.length > 0 && !busy;
  const editable = s === "RX_PENDING_APPROVAL" || s === "RX_FLAGGED";
  const dirty = !!visit.rx && JSON.stringify(edit) !== JSON.stringify(toEdit(visit.rx.items));
  const rowsValid = edit.some((i) => i.drug.trim()) && edit.every((i) => !i.drug.trim() || (i.frequency.trim() && Number(i.days) > 0 && (!i.quantity.trim() || Number(i.quantity) > 0)));
  const pax = visit.rx_safety?.source === "pax" ? visit.rx_safety : null; // Pax's formulary/stock flags

  return (
    <section className="room">
      <header>
        <div>
          <h1>{patient.full_name}</h1>
          <small>
            DOB {patient.dob} · {visit.reason ?? "no reason given"} · <b>{s.replaceAll("_", " ").toLowerCase()}</b>
          </small>
        </div>
      </header>

      <div className="panel">
        <div className="panel-head">
          <h2>Conversation</h2>
          <span className={`listen${listening ? " on" : ""}`}>{listening ? "● Dr. Sage is listening" : "Dr. Sage is not listening"}</span>
        </div>
        <div className="log" ref={log}>
          {!lines.length && !interim && <div className="msg note">Start listening and talk with the patient. Dr. Sage won't say anything.</div>}
          {lines.map((l, i) => (
            <div key={i} className="line">
              {l}
            </div>
          ))}
          {interim && <div className="line interim">{interim}</div>}
        </div>
        <div className="bar">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addLine(draft);
              setDraft("");
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type what was said" />
          </form>
          {voice && (
            <button className={`mic${listening ? " on" : ""}`} onClick={listening ? stopListening : startListening}>
              {listening ? "■ Stop" : "🎤 Listen"}
            </button>
          )}
        </div>
        {!voice && <small className="muted">Live transcription needs Chrome or Safari. You can still type the conversation.</small>}
        <div className="actions">
          {lines.length > 0 && (s === "CHECKED_IN" || s === "IN_CONSULT") && (
            <button className="link" onClick={() => updateLines(() => [])} disabled={!!busy}>
              Clear transcript
            </button>
          )}
          <button className="primary" onClick={generate} disabled={!canGenerate}>
            Generate prescription
          </button>
        </div>
      </div>

      {busy && <p className="muted">{busy}</p>}
      {error && <p className="err">{error}</p>}

      {visit.rx && s !== "CHECKED_IN" && s !== "IN_CONSULT" && (
        <div className="panel">
          <div className="panel-head">
            <h2>Prescription{visit.rx.revision > 0 ? ` · revision ${visit.rx.revision}` : ""}</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Drug</th>
                <th>Dose</th>
                <th>Frequency</th>
                <th>Days</th>
                <th>Qty</th>
                {editable && <th />}
              </tr>
            </thead>
            <tbody>
              {editable
                ? edit.map((i, row) => (
                    <tr key={row}>
                      {(["drug", "dose", "frequency", "days", "quantity"] as const).map((f) => (
                        <td key={f}>
                          <input
                            value={i[f]}
                            onChange={(e) => setCell(row, f, e.target.value)}
                            inputMode={f === "days" || f === "quantity" ? "numeric" : undefined}
                            placeholder={f === "quantity" ? "auto" : ""}
                          />
                        </td>
                      ))}
                      <td>
                        <button className="link" onClick={() => setEdit((e) => e.filter((_, j) => j !== row))} title="Remove">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))
                : visit.rx.items.map((i, row) => (
                    <tr key={row}>
                      <td>{i.drug}</td>
                      <td>{i.dose}</td>
                      <td>{i.frequency}</td>
                      <td>{i.days}</td>
                      <td>{i.quantity}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {editable && (
            <div className="actions">
              <button className="link" onClick={() => setEdit((e) => [...e, BLANK])}>
                + Add drug
              </button>
              {dirty && (
                <button className="link" onClick={() => setEdit(toEdit(visit.rx!.items))}>
                  Undo changes
                </button>
              )}
            </div>
          )}
          {visit.rx.summary && <p>{visit.rx.summary}</p>}
          {/* Reference only: not checked against the drugs. */}
          <p className="issues">
            ⚠️ <b>Allergies:</b>{" "}
            {patient.allergies.length ? patient.allergies.map((a) => `${a.substance} (${a.severity}${a.reaction ? `, ${a.reaction}` : ""})`).join(", ") : "none recorded"}
          </p>
          {pax && (
            <p className="err">
              Pax (pharmacy) flagged this prescription. {pax.explanation} {pax.recommendation && `Suggestion: ${pax.recommendation}`} Edit it and save again.
            </p>
          )}
          {pax && pax.issues.length > 0 && (
            <ul className="issues">
              {pax.issues.map((i, n) => (
                <li key={n}>⚠️ {i.detail}</li>
              ))}
            </ul>
          )}

          {editable && (
            <div className="approve row">
              <input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} placeholder="Doctor's name" />
              <button className="primary" onClick={save} disabled={!rowsValid || !doctorName.trim() || !!busy}>
                Save & send to pharmacy
              </button>
            </div>
          )}
          {visit.rx_approved_by && !editable && <p className="muted">Approved by {visit.rx_approved_by}.</p>}
        </div>
      )}

      {visit.dispensed && (
        <div className="panel">
          <h2>Pharmacy</h2>
          {visit.dispensed.length ? (
            <p>Pax dispensed: {visit.dispensed.map((d) => `${d.name} × ${d.quantity}`).join(", ")}.</p>
          ) : (
            <p className="muted">No prescription for this visit.</p>
          )}
        </div>
      )}
    </section>
  );
}
