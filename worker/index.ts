import { Hono } from "hono";
import type { Env } from "./env";
import { health } from "./routes/health";
import { auth } from "./routes/auth";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/health", health);
app.route("/api/auth", auth);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default app;
