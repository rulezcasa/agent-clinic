/** Route-handler helpers: JSON in/out, error → status code, staff + n8n auth. */
import { ZodError, type z } from "zod";
import { config } from "@/lib/config";
import { TransitionError } from "@/lib/visit/status";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const text = await req.text();
  return schema.parse(text ? JSON.parse(text) : {});
}

export function requireStaff(req: Request) {
  if (!config.staffToken) return;
  if (req.headers.get("authorization") !== `Bearer ${config.staffToken}`) throw new HttpError(401, "staff token required");
}

export function requireN8n(req: Request) {
  if (!config.n8n.sharedSecret) return;
  if (req.headers.get("x-clinic-secret") !== config.n8n.sharedSecret) throw new HttpError(401, "bad x-clinic-secret");
}

/** Wrap a handler so thrown errors become JSON responses. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A): Promise<Response> => {
    try {
      return Response.json(await fn(...args));
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      if (err instanceof TransitionError) return Response.json({ error: err.message }, { status: 409 });
      if (err instanceof ZodError) return Response.json({ error: "invalid request", issues: err.issues }, { status: 400 });
      if (err instanceof SyntaxError) return Response.json({ error: "invalid JSON" }, { status: 400 });
      console.error(err);
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  };
}
