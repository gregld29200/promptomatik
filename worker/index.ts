import { Hono } from "hono";
import type { Env } from "./env";
import { health } from "./routes/health";
import { auth } from "./routes/auth";
import { interview } from "./routes/interview";
import { prompts } from "./routes/prompts";
import { admin } from "./routes/admin";
import { profile } from "./routes/profile";
import { templates } from "./routes/templates";

const app = new Hono<{ Bindings: Env }>();

app.route("/api/health", health);
app.route("/api/auth", auth);
app.route("/api/interview", interview);
app.route("/api/prompts", prompts);
app.route("/api/profile", profile);
app.route("/api/admin", admin);
app.route("/api/templates", templates);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default app;
