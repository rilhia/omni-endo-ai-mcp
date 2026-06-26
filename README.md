# Omni-Endo AI

Turn your Glooko / Omnipod 5 diabetes data into something an AI can analyse for
you. One install gives you three ways to use it:

1. **With Claude Desktop** (recommended, simplest, most capable).
2. **As a chat assistant** using a local Ollama model.
3. **As a plain API** you can call yourself or explore in your browser.

All three run from a single setup. You do not need to understand Docker deeply.
Follow the steps in order.

---

## What you need first

- **Docker Desktop** installed and running. (Search "install Docker Desktop"
  for your operating system, install it, and open it once so it is running.)
- Your **Glooko login** (optional). With it, the server downloads and refreshes
  your own data. Without it, the server runs in offline mode and uses whatever
  data is already in its database (for example, the sample database shipped with
  the project), never contacting Glooko.
- About 10 minutes.

That is everything. You do not need Node, databases, or any coding tools; they
all run inside Docker.

---

## Step 1: Get the files and set your details

1. Download / clone this folder to your computer.
2. In the folder, find the file called `.env.example`. Make a copy of it and
   name the copy `.env` (just `.env`, nothing before the dot).
3. Open `.env` in any text editor and fill in:
   - `OMNI_TOKEN` — any hard-to-guess phrase. This is a password that protects
     your data endpoints. To make a strong one, run `openssl rand -hex 16`, or
     type a long random string of letters and numbers (letters and numbers
     only, avoid quotes and spaces).
   - `GLOOKO_EMAIL` and `GLOOKO_PASSWORD` — your Glooko login, IF you want the
     server to download and refresh your own data. Leave them blank to run in
     offline mode against the database the project ships with.
   - `GLOOKO_GLUCOSE_UNIT` — only if you provided a login: set this to the unit
     your Glooko account uses (`mmol` or `mgdl`) so your data is read correctly
     as it downloads. This is separate from how you choose to view it below.

   Leave everything else as it is.

That is the only file you ever need to edit.

---

## Step 2: Start everything

Open a terminal **in this folder** and run:

```
docker compose up -d --build
```

The first time, this builds the data server and downloads the other pieces, so
it may take a few minutes. When it finishes, the stack is running in the
background. The very first question you ask will take a little longer because
the server downloads your Glooko history then; after that it is fast.

To check it is alive:

```
docker compose logs omni-endo
```

You should see a line like `MCP server running on http://0.0.0.0:3033/mcp`.

To stop everything later: `docker compose down`. To start it again:
`docker compose up -d` (no `--build` needed after the first time).

---

## Option A: Use it as an API (and explore the tools)

This works the moment the stack is running. Open your browser to:

```
http://localhost:8000/docs
```

You will see every tool listed with a "Try it out" button. To actually run a
tool you will be asked for the API key — that is your `OMNI_TOKEN` from `.env`.

To call it from a script or the command line instead, for example:

```
curl -X POST http://localhost:8000/get_diabetes_summary \
  -H "Authorization: Bearer YOUR_OMNI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"start":"2026-06-01T00:00:00.000Z","end":"2026-06-08T00:00:00.000Z"}'
```

Replace `YOUR_OMNI_TOKEN` with the token you set in `.env`.

**All times are UTC.** Every timestamp you send (start, end, event times) must be
in UTC ISO 8601 (the trailing `Z`, e.g. `2026-06-01T00:00:00.000Z`), and every
timestamp the API returns is UTC. If you think in local time, convert to UTC
before calling and convert the results back afterwards. Hour-of-day figures
(such as "worst hour") are UTC clock-hours.

---

## Option B: Use it with a local Ollama model (chat)

This lets a local AI model chat with you and pull your diabetes data when
relevant. You need [Ollama](https://ollama.com) installed and running on your
computer, with a model that supports tools (for example `qwen2.5`).

1. Open Open WebUI in your browser:

   ```
   http://localhost:8083
   ```

2. Create the local account it asks for (it stays on your machine).
3. Connect the data tools: go to **Settings → Tools** (or **Admin Settings →
   External Tools**, depending on your version) and add a tool server:
   - URL: `http://mcpo:8000`
   - API key / Bearer token: your `OMNI_TOKEN`.
4. Start a chat, pick a tools-capable model (e.g. `qwen2.5`), make sure the
   tool is enabled for the chat, and ask something like "how was my time in
   range last week?"

Note: local models vary a lot in how well they use tools. If a model ignores
the data, try `qwen2.5`; smaller models are less reliable at this.

---

## Option C: Use it with Claude Desktop (recommended)

Claude talks to the data server directly, in its own simple way. You do **not**
need the API or Ollama pieces for this; Claude launches its own copy of the
server on demand.

In Claude Desktop, open **Settings → Developer → Edit Config** (this opens a
file called `claude_desktop_config.json`) and add an entry like this, then
restart Claude:

```json
{
  "mcpServers": {
    "omni-endo": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--env-file", "/full/path/to/this/folder/.env",
        "-v", "/full/path/to/this/folder/data:/data",
        "omni-endo-ai-mcp:latest"
      ]
    }
  }
}
```

Replace `/full/path/to/this/folder` with the real path to this folder on your
computer. This uses the same image and the same data the stack already built,
so your history is shared. Claude runs its own short-lived copy each time, which
does not interfere with the API/Ollama stack running in the background.

(Claude needs the server in "stdio" mode, which is the image's default, so no
extra setting is required for this to work. The background stack overrides it to
network mode only for its own copy.)

---

## Running Claude AND the API/Ollama at the same time

You can. The background stack (Option A/B) runs the data server in network mode;
Claude (Option C) launches its own copy in stdio mode. They share the same
downloaded history in the `data` folder. The first time data is downloaded it is
best to let one of them finish before hammering the other, after that they
coexist happily.

---

## A note on your data and the token

This tool handles your personal health data and your Glooko login.

- Keep your `.env` private. Never commit it to a public repository or share it.
- The `OMNI_TOKEN` protects the network endpoints on your machine. Use a strong
  one if anything other than you can reach your computer's ports.
- Nothing is sent anywhere except between these pieces on your own machine and
  Glooko's own servers (to download your data).

---

## How the code is organised

If you are reading the source rather than just running it, here is the map. The
flow of data is: Glooko → sync → store → range → analytics → tools → client.

- **`src/server.js`** — The MCP server and the eleven tool definitions. This is
  what Claude Desktop launches (over stdio). Each tool is a thin wrapper: it
  validates inputs, resolves the glucose unit/boundaries, asks the range layer
  for the window's data, hands that to the analytics functions, and returns the
  shaped result. No clinical maths lives here.

- **`src/http.js`** — An alternative front door to the same tools over HTTP/SSE
  (used by the bridge and Open WebUI). Stateful and multi-client safe. Run
  instead of stdio via `OMNI_TRANSPORT=http`.

- **`src/analytics.js`** — The heart: all the clinical maths and data shaping,
  written as pure functions (data in, plain objects out). Summaries, trends,
  the enriched bolus log, hourly/day rankings, unit conversion and ingest
  normalisation all live here. Start here to understand what the numbers mean.

- **`src/store.js`** — The SQLite archive. Holds normalised rows (CGM, bolus,
  daily insulin, basal states, settings, device events), not raw Glooko blobs.
  Owns the schema and the read/write queries.

- **`src/range.js`** — The layer the tools actually call. Answers every question
  from the local archive, topping it up from Glooko only when the window is not
  already covered. This is also where offline mode is gated: with no
  credentials, it never contacts Glooko.

- **`src/sync.js`** — The engine that pulls from Glooko into the archive:
  cold-start (first run), top-up (recent days), and the startup warm-up. Shared
  by both transports so the fetch logic exists once.

- **`src/glooko.js`** — The Glooko API client: authentication and fetching, with
  a deliberate retry/re-login failure model.

- **`src/prompt.js`** — The clinical-auditor persona, exposed as a selectable
  MCP prompt. Pure instruction text; enforces nothing on its own.

A few invariants hold across the whole codebase and explain choices that would
otherwise look odd: glucose is stored internally in one canonical unit (mmol/L)
and only converted to the display unit on the way out; bolus is always summed
from individual events while basal comes only from Glooko's daily totals; all
times are UTC end to end; and per-day rates use the real observed span of data
rather than a calendar day count.

## Ports used (change in docker-compose.yml only if they clash)

| What                         | Address                      |
|------------------------------|------------------------------|
| Data server (MCP / SSE)      | http://localhost:3033/mcp    |
| API explorer + API endpoints | http://localhost:8000/docs   |
| Chat UI (Open WebUI)         | http://localhost:8083        |
