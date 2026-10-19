"use client";

/**
 * Patient front desk — one tab per agent task. Riley handles both booking and check-in;
 * both chats stay mounted so switching tabs keeps each conversation.
 */
import { useState } from "react";
import RileyChat, { type Desk } from "./_components/riley-chat";

const TABS: { desk: Desk; label: string; title: string; intro: string }[] = [
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
  const [tab, setTab] = useState<Desk>("booking");

  return (
    <main className="desk">
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.desk} role="tab" aria-selected={tab === t.desk} className={tab === t.desk ? "on" : ""} onClick={() => setTab(t.desk)}>
            {t.label}
          </button>
        ))}
      </nav>
      {TABS.map((t) => (
        <RileyChat key={t.desk} desk={t.desk} title={t.title} intro={t.intro} active={tab === t.desk} />
      ))}
    </main>
  );
}
