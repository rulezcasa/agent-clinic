/** Supabase connection (service role, server only). Tables and data live in Supabase; this only reads/writes rows. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, need } from "@/lib/config";
import type { ChatSession, Drug, MemoryNote, Message, Patient, Visit, VisitStatus } from "@/lib/types";

// Survive Next.js dev hot reloads.
const g = globalThis as unknown as { __supabase?: SupabaseClient };
const db = () =>
  (g.__supabase ??= createClient(need(config.supabase.url, "SUPABASE_URL"), need(config.supabase.serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  }));

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`supabase ${what}: ${res.error.message}`);
  return res.data as T;
}

type NewVisit = Pick<Visit, "patient_id" | "visit_type"> & Partial<Omit<Visit, "id" | "created_at" | "updated_at">>;
type NewMessage = Omit<Message, "id" | "created_at">;

export const repo = {
  async getPatient(id: string) {
    return check(await db().from("patients").select("*").eq("id", id).maybeSingle(), "getPatient") as Patient | null;
  },
  async findPatientByEmail(email: string) {
    return check(await db().from("patients").select("*").ilike("email", email).limit(1).maybeSingle(), "findPatientByEmail") as Patient | null;
  },
  async findPatientByNameDob(fullName: string, dob: string) {
    return check(
      await db().from("patients").select("*").ilike("full_name", fullName.trim()).eq("dob", dob).limit(1).maybeSingle(),
      "findPatientByNameDob",
    ) as Patient | null;
  },
  async createPatient(p: Omit<Patient, "id" | "created_at">) {
    return check(await db().from("patients").insert(p).select().single(), "createPatient") as Patient;
  },
  async updatePatient(id: string, patch: Partial<Patient>) {
    const { id: _id, created_at: _c, ...rest } = patch;
    return check(await db().from("patients").update(rest).eq("id", id).select().single(), "updatePatient") as Patient;
  },

  async listDrugs() {
    return check(await db().from("drugs").select("*").order("name"), "listDrugs") as Drug[];
  },
  /** Take `qty` units with compare-and-set; false if not enough stock. */
  async takeStock(drugId: string, qty: number) {
    // optimistic compare-and-set; retry a few times on contention
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = check(await db().from("drugs").select("stock_qty").eq("id", drugId).single(), "takeStock read") as { stock_qty: number };
      if (cur.stock_qty < qty) return false;
      const res = check(
        await db().from("drugs").update({ stock_qty: cur.stock_qty - qty }).eq("id", drugId).eq("stock_qty", cur.stock_qty).select("id"),
        "takeStock write",
      ) as { id: string }[];
      if (res.length === 1) return true;
    }
    return false;
  },

  async createVisit(v: NewVisit) {
    return check(await db().from("visits").insert(v).select().single(), "createVisit") as Visit;
  },
  async getVisit(id: string) {
    return check(await db().from("visits").select("*").eq("id", id).maybeSingle(), "getVisit") as Visit | null;
  },
  async getVisitByBookingUid(uid: string) {
    return check(await db().from("visits").select("*").eq("cal_booking_uid", uid).maybeSingle(), "getVisitByBookingUid") as Visit | null;
  },
  async listVisits(filter: { status?: VisitStatus[]; patient_id?: string } = {}) {
    let q = db().from("visits").select("*").order("created_at", { ascending: false });
    if (filter.status) q = q.in("status", filter.status);
    if (filter.patient_id) q = q.eq("patient_id", filter.patient_id);
    return check(await q, "listVisits") as Visit[];
  },
  async updateVisit(id: string, patch: Partial<Visit>) {
    const { id: _id, created_at: _c, ...rest } = patch;
    return check(
      await db().from("visits").update({ ...rest, updated_at: new Date().toISOString() }).eq("id", id).select().single(),
      "updateVisit",
    ) as Visit;
  },
  /** Compare-and-set on status. Null if the visit was not in `expected`. */
  async updateVisitIfStatus(id: string, expected: VisitStatus, patch: Partial<Visit>) {
    const { id: _id, created_at: _c, ...rest } = patch;
    const rows = check(
      await db()
        .from("visits")
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", expected)
        .select(),
      "updateVisitIfStatus",
    ) as Visit[];
    return rows[0] ?? null;
  },

  async addMessage(m: NewMessage) {
    return check(await db().from("messages").insert(m).select().single(), "addMessage") as Message;
  },
  async listMessages({ visit_id, session_id, limit }: { visit_id?: string; session_id?: string; limit?: number }) {
    let q = db().from("messages").select("*").order("created_at", { ascending: true });
    if (visit_id && session_id) q = q.or(`visit_id.eq.${visit_id},session_id.eq.${session_id}`);
    else if (visit_id) q = q.eq("visit_id", visit_id);
    else if (session_id) q = q.eq("session_id", session_id);
    const rows = check(await q, "listMessages") as Message[];
    return limit ? rows.slice(-limit) : rows;
  },

  async createSession(s: Partial<ChatSession> = {}) {
    return check(await db().from("chat_sessions").insert(s).select().single(), "createSession") as ChatSession;
  },
  async getSession(id: string) {
    return check(await db().from("chat_sessions").select("*").eq("id", id).maybeSingle(), "getSession") as ChatSession | null;
  },
  async updateSession(id: string, patch: Partial<ChatSession>) {
    const { id: _id, created_at: _c, ...rest } = patch;
    return check(await db().from("chat_sessions").update(rest).eq("id", id).select().single(), "updateSession") as ChatSession;
  },

  async addMemoryNote(n: Omit<MemoryNote, "id" | "created_at">) {
    return check(await db().from("memory_notes").insert(n).select().single(), "addMemoryNote") as MemoryNote;
  },
  async listMemoryNotes(patientId: string) {
    return check(
      await db().from("memory_notes").select("*").eq("patient_id", patientId).order("created_at", { ascending: true }),
      "listMemoryNotes",
    ) as MemoryNote[];
  },
};
