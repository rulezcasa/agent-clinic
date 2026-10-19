"use client";

/**
 * Doctor's room tab — the queue of checked-in patients and the consult in progress.
 * The real doctor talks to the patient; Dr. Sage only listens until "Generate prescription".
 */
import { useCallback, useEffect, useState } from "react";
import ConsultRoom from "./consult-room";

interface QueueVisit {
  id: string;
  status: string;
  reason: string | null;
  slot_start: string | null;
  patient_name: string | null;
}

/** Visits still in consult. Once Pax dispenses (or no prescription is needed) the consult is done and the patient leaves the queue. */
const ACTIVE = ["CHECKED_IN", "IN_CONSULT", "RX_DRAFTED", "RX_FLAGGED", "RX_PENDING_APPROVAL", "RX_APPROVED"];

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

export default function DoctorRoom({ active }: { active: boolean }) {
  const [queue, setQueue] = useState<QueueVisit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/visits?status=${ACTIVE.join(",")}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setQueue(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section className="clinic" hidden={!active}>
      <aside className="queue">
        <div className="queue-head">
          <h1>Patients</h1>
          <button onClick={refresh} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {error && <p className="err">{error}</p>}
        {!queue.length && !error && <p className="muted">No one checked in yet.</p>}
        {queue.map((v) => (
          <button key={v.id} className={selected === v.id ? "on" : ""} onClick={() => setSelected(v.id)}>
            <strong>{v.patient_name ?? "Unknown patient"}</strong>
            <span>{v.reason ?? "—"}</span>
            <small>
              {time(v.slot_start)} · {v.status.replaceAll("_", " ").toLowerCase()}
            </small>
          </button>
        ))}
      </aside>
      {selected ? <ConsultRoom key={selected} visitId={selected} onChange={refresh} /> : <section className="room empty muted">Pick a patient to start the consult.</section>}
    </section>
  );
}
