"use client";

/**
 * Clinic demo — one tab per agent task. Riley handles booking and check-in; the doctor's room
 * is where the consult happens. Every tab stays mounted so switching keeps its state.
 */
import { useState } from "react";
import DoctorRoom from "./_components/doctor-room";
import RileyChat, { type Desk } from "./_components/riley-chat";

type Tab = Desk | "doctor";

const RILEY_TABS: { desk: Desk; label: string; title: string; intro: string }[] = [
  {
    desk: "booking",
    label: "Appointment booking",
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
  const tabs: { id: Tab; label: string }[] = [...RILEY_TABS.map((t) => ({ id: t.desk, label: t.label })), { id: "doctor", label: "Doctor" }];

  return (
    <main className={`desk${tab === "doctor" ? " wide" : ""}`}>
      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      {RILEY_TABS.map((t) => (
        <RileyChat key={t.desk} desk={t.desk} title={t.title} intro={t.intro} active={tab === t.desk} />
      ))}
      <DoctorRoom active={tab === "doctor"} />
    </main>
  );
}
