"use client";

/**
 * Clinic demo — one tab per agent task. Riley handles booking and check-in; the doctor's room
 * is where the consult happens. Every tab stays mounted so switching keeps its state.
 */
import { useEffect, useState } from "react";
import DoctorRoom from "./_components/doctor-room";
import RileyChat, { type Desk } from "./_components/riley-chat";

type Tab = Desk | "doctor";

const RILEY_TABS: { desk: Desk; label: string; title: string; intro: string }[] = [
  {
    desk: "booking",
    label: "Book",
    title: "Riley · Booking",
    intro: "Book an appointment with Riley. Tap 🎤 and speak, or type.",
  },
  {
    desk: "checkin",
    label: "Check-in",
    title: "Riley · Check-in",
    intro: "Here for your appointment? Check in with Riley — have your full name and date of birth ready.",
  },
];

export default function FrontDesk() {
  const [tab, setTab] = useState<Tab>("booking");
  const [rileyFace, setRileyFace] = useState<string | null>(null);

  // Riley's face is her Masky avatar's still image.
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => (r.ok ? r.json() : []))
      .then((agents: { name: string; avatar_url: string | null }[]) => setRileyFace(agents.find((a) => a.name === "riley")?.avatar_url ?? null))
      .catch(() => {});
  }, []);
  const tabs: { id: Tab; label: string }[] = [...RILEY_TABS.map((t) => ({ id: t.desk, label: t.label })), { id: "doctor", label: "Doctor" }];

  return (
    <main className={`desk${tab === "doctor" ? " wide" : ""}`}>
      <div className="top">
        <span className="brand">Agent Clinic</span>
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {RILEY_TABS.map((t) => (
        <RileyChat key={t.desk} desk={t.desk} title={t.title} intro={t.intro} active={tab === t.desk} avatar={rileyFace} />
      ))}
      <DoctorRoom active={tab === "doctor"} />
    </main>
  );
}
