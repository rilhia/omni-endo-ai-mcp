<div align="center">
  <kbd><img src="docs/images/Omni-Endo-AI-MCP.png" alt="Omni-Endo AI Header" width="100%"></kbd>
</div>

# OMNI-ENDO AI (MCP)
**Clinical Audit & Triage Tool: connect your diabetes data directly to an AI assistant**

---

## 🌟 What is Omni-Endo AI?
**Omni-Endo AI** is a bridge between your diabetes data and an AI assistant. It is an **MCP server** (Model Context Protocol), which is a standard way of giving an AI a set of tools it can use on your behalf.

Instead of copying and pasting reports, you simply *talk* to your assistant. You ask a question in plain language, and the assistant reaches into your data, pulls exactly what it needs, and analyses it for you, all within the conversation.

You ask things like:
* *"How was my time in range last month?"*
* *"Why do I keep going high in the evenings?"*
* *"Show me my worst day and tell me what happened."*

### 🚀 What does it actually do?
Omni-Endo AI exposes your diabetes history as a set of analytical tools the AI can call:

* **Summaries and trends:** time in range, GMI, variability, best and worst days and hours, basal/bolus balance, over any period you ask about.
* **High-fidelity CGM data:** every 5-minute reading is captured, so no spike or dip is missed, but the AI is guided to pull *aggregates first* and only fetch raw readings when it genuinely needs them.
* **Enriched bolus analysis:** each bolus is matched with the glucose at the time and the pump settings (ISF, carb ratio, target) that were active, so the AI can judge whether a dose made sense.
* **Omnipod 5 behaviour:** when the algorithm was suspending, running at max, or running blind after losing signal.

The assistant does all of this itself, live, by calling these tools while it talks to you.

### The "Aha!" Moment
This project started with a personal frustration. While trying to integrate my diabetes data into a **Home Assistant** dashboard, I discovered that the wealth of historical data stored in **Glooko** (especially from the **Omnipod 5**) is a goldmine. I realised that if I gave that data to an AI assistant and let it query the data directly, it could uncover patterns that months of manual logging never showed.

### Why I Built This
I built this to put the power back into the hands of the patient. We often only get 15 minutes with a consultant every few months. This tool lets you:
1. **Be Proactive:** spot trends before your next appointment.
2. **Be Private:** your data and credentials stay on your own machine.
3. **Be Flexible:** use it with Claude Desktop, or with a local AI through Open WebUI.

---

## 🔒 Privacy & Security: Your Data, Your Control
Because this involves sensitive medical credentials and data, it is designed with a **"local-first" architecture**.

* **No Middle Man:** your Glooko username and password never leave your machine. They are sent directly from your local Docker container to Glooko's servers. No third-party server ever sees them.
* **It runs on your computer:** the server, the database, and the analysis tools all run locally in Docker.
* **You choose the AI:** connect it to Claude Desktop, or to a local model through Open WebUI. With a local model, your data never leaves your machine at all.

> [!IMPORTANT]
> If you use a cloud AI assistant, most providers have a setting that allows them to "train" on your conversations. Before discussing your clinical data, consider turning off chat history / model training in that assistant's privacy settings, so your medical history stays private.

> [!TIP]
> Want to try it before connecting your own account? This repository ships with a small **example database** of real data so you can explore everything offline, with no Glooko login at all. See **"Try it with the example data"** below.

---

## 🧐 The "Tough Love" AI Persona
The tool ships with a built-in AI persona: a **"Tough Love" Endocrinologist**.

Managing Type 1 Diabetes is hard, and placating a user doesn't improve Time in Range. The persona is direct, analytical, and uncompromising. It won't sugar-coat the data; it will tell you where your bolus timing is off, where you are over-correcting, or where your basal is failing to catch a drift. It is also built to work *efficiently*, pulling summaries first and only drilling into granular data when it needs to.

When you connect the tool, this persona is available as a selectable prompt called **"Clinical auditor persona"**. Selecting it is what turns the AI into the endocrinologist.

---

> [!WARNING]
> Be aware that links in this document may take you away from this page. To open in a new tab, right-click and select **Open Link in New Tab**.

## 🛠️ Step 1: Getting Ready (Installing Docker)
To run this tool we use **Docker**. Think of Docker as a "shipping container" for software: it lets Omni-Endo AI run perfectly on your computer without you installing complicated code libraries by hand.

This may require a restart, so make sure you are ready for that before starting.

### **For Windows Users**
1. **Download:** Go to the [Docker installation instructions for Windows](https://docs.docker.com/desktop/setup/install/windows-install/), read the options, and download the one that suits your machine. For most users this is **Docker Desktop for Windows - x86_64**.
2. **Install:** Run the `.exe`. **Important:** during installation, ensure **"Use WSL 2 instead of Hyper-V"** is checked.
3. **Restart:** Your computer will likely ask to restart.
4. **Start:** Open "Docker Desktop" from the Start Menu and accept the terms.

> [!WARNING]
> If you see a WSL version issue, see [this guide](https://docs.docker.com/desktop/setup/install/windows-install/#option-1-install-or-update-wsl-via-the-terminal) to resolve it.

### **For Mac Users**
1. **Download:** Go to the [Docker installation instructions for Mac](https://docs.docker.com/desktop/setup/install/mac-install/).
   - Choose **"Apple Chip"** for a newer Mac (M1, M2, M3, M4).
   - Choose **"Intel Chip"** for an older Mac.
2. **Install:** Open the `.dmg` and drag Docker into your **Applications** folder.
3. **Start:** Open Docker from Applications. You may need to enter your Mac password to grant permission.

> [!NOTE]
> Make sure Docker Desktop is actually *running* (you'll see its whale icon in your menu bar or system tray) before continuing.

---

## 📂 Step 2: Getting the Files
1. **Download the Code:** On [this GitHub page](https://github.com/rilhia/omni-endo-ai-mcp), click the green **"<> Code"** button, then **"Download ZIP"**.
2. **Extract:** Open your Downloads folder, right-click the zip, and choose **"Extract All"**.
3. **Move:** Move the extracted folder somewhere easy to find and remember, this location matters for the steps below. For example:
   `/Users/richard/Development/Docker/agents/omni-endo-mcp`

Inside, you should see:
* `src/` (the application code)
* `examples/` (the example database)
* `docker-compose.yml`
* `Dockerfile`
* `.env.example`
* ...and a few other small files.

---

## ⚙️ Step 3: Configure Your Settings (`.env`)
The tool reads its settings from a file called `.env`. The repository includes a template called `.env.example`, you make your own copy and fill it in.

1. **Copy the template:** Make a copy of `.env.example` and rename the copy to exactly `.env` (just `.env`, nothing before the dot).
2. **Open `.env`** in any text editor and set the following.

**To use your own Glooko data, fill these in:**
* `GLOOKO_EMAIL` and `GLOOKO_PASSWORD`, your normal Glooko login. (Sent only to Glooko, never anywhere else.)
* `GLOOKO_GLUCOSE_UNIT`, the unit your **Glooko account** is set to: `mmol` or `mgdl`. This tells the tool how to read your incoming data correctly, so it matters. (This is separate from how you want to *view* it.)

**To just explore the example data instead, leave the Glooko fields blank.** With no credentials, the tool never contacts Glooko and simply serves the example database (see the next section).

**These control how you want to *see* your data (optional):**
* `OMNI_UNITS`, your preferred display unit: `mmol` (default) or `mgdl`.
* `OMNI_LOWER` / `OMNI_UPPER`, your target range boundaries, in the unit above (e.g. `3.9` and `10.0` for mmol, or `70` and `180` for mgdl).

**One security setting:**
* `OMNI_TOKEN`, a password that protects the local network endpoints (used by Open WebUI). Set it to any long random string of letters and numbers. On Mac/Linux you can generate one with `openssl rand -hex 16`.

Leave anything else at its default.

---

## 🧪 Try it with the example data (optional, no login needed)
This repo ships with a real example database so you can try everything before connecting your own account.

1. In the project folder, **create a folder called `data`** if it isn't already there.
2. **Copy** the file `examples/omni-endo.db` **into** that `data` folder.
3. Make sure your `.env` has the **Glooko fields left blank** (this puts the tool in offline mode, so it will only ever read the example database and will never try to download anything).

That's it, when you run the tool and connect your AI, it will analyse the example data exactly as if it were your own.

> [!NOTE]
> The example data is my own real diabetes data, shared on purpose so people have something genuine to explore. When you later switch to your own account, your data lives in the same `data` folder and stays on your machine.

---

## ▶️ Step 4: Build the Tool
Now we build the Docker image that both Claude and Open WebUI will use.

1. **Open a Terminal:**
   - **Windows:** open "PowerShell" from the Start Menu.
   - **Mac:** open "Terminal" (Cmd + Space, type Terminal).
2. **Go to the folder:** type `cd` then a space, then drag your project folder into the terminal window so the path fills in, and press Enter. For example:
   `cd /Users/richard/Development/Docker/agents/omni-endo-mcp`
3. **Build it:** run this command and press Enter:
   ```bash
   docker compose build --no-cache
   ```
   The first time, Docker downloads what it needs and builds the image; this can take a few minutes.

> [!IMPORTANT]
> If you ever download a newer version of this tool, always rebuild with `docker compose build --no-cache`. A plain start can reuse an old cached image and run outdated code.

You now have everything built. There are two ways to use it: **Claude Desktop** (Section A) or **Open WebUI with a local model** (Section B). You can set up either or both.

---

## 🅰️ Section A: Use it with Claude Desktop

With Claude Desktop, Claude launches its own copy of the tool on demand and reads your data directly. You do **not** need to keep anything running in the terminal for this, Claude starts and stops the container itself.

### A1. Find your Claude config file
Claude Desktop is configured by a file called `claude_desktop_config.json`.

* **Mac:** `/Users/<yourname>/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

The easiest way to open it: in Claude Desktop go to **Settings → Developer → Edit Config**. That opens the right file for you.

### A2. Add the omni-endo server
Add an `mcpServers` entry like the one below. If the file already has an `mcpServers` section, add the `"omni-endo"` block inside it.

```json
{
  "mcpServers": {
    "omni-endo": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--env-file",
        "/Users/richard/Development/Docker/agents/omni-endo-mcp/.env",
        "-v",
        "/Users/richard/Development/Docker/agents/omni-endo-mcp/data:/data",
        "omni-endo-ai-mcp"
      ]
    }
  }
}
```

**You must change the two paths** to point at *your* project folder:
* The `--env-file` path must point to your `.env` file.
* The `-v` path before `:/data` must point to your `data` folder (the part after the colon, `/data`, stays exactly as it is).

What this does, in plain terms: it tells Claude to run the `omni-endo-ai-mcp` image, hand it your settings (`--env-file`), and share your data folder with it (`-v ... :/data`) so it can read your database.

> [!NOTE]
> Use the full path. On Mac it will start with `/Users/yourname/...`; on Windows it will look like `C:\\Users\\YourName\\...` (note the double backslashes in JSON).

### A3. Restart Claude Desktop
Fully quit Claude Desktop (on Mac, Cmd + Q, not just closing the window) and open it again, so it picks up the new config.

### A4. Make sure the tools are loaded
In a chat, open the connector / tools menu. You should see **omni-endo** with its tools.

> [!IMPORTANT]
> Claude Desktop has a setting for how it loads tools. If it is set to **"Load tools when needed"**, it may not show the summary and trend tools straight away. For the best experience, set it to **"Tools already loaded"** so every tool is available immediately. This is the single most common setup snag.

<kbd><img src="images/claude-tool-access.png" width="700"></kbd>

*(Image: the Claude Desktop connector menu showing "Tool access" set to "Tools already loaded".)*

### A5. Select the persona and ask away
From the same menu, choose the **"Clinical auditor persona"** prompt, then ask your question. A good first one:

> *"Check what date ranges you have in my diabetes data, then give me an overview of how I'm doing."*

<kbd><img src="images/claude-conversation.png" width="900"></kbd>

*(Image: Claude using the tools to answer a question about your data.)*

---

## 🅱️ Section B: Use it with Open WebUI (local AI)

This path lets a **local** AI model (running on your own machine via [Ollama](https://ollama.com)) analyse your data, so nothing leaves your computer at all. It uses the full Docker stack, which also includes a bridge that turns the tools into a normal web API.

### B1. Start the stack
In your terminal, in the project folder, run:
```bash
docker compose up -d
```
This starts three things: the data server, a bridge (so web tools can reach it), and Open WebUI. The first question you ask may take a little longer while it loads your data.

To check it is running:
```bash
docker compose logs omni-endo
```

### B2. Install Ollama and a model
Install [Ollama](https://ollama.com), then pull a model that supports tools, for example:
```bash
ollama pull qwen2.5
```

> [!NOTE]
> Local models vary a lot in how well they use tools. `qwen2.5` is a reliable starting point; very small models often struggle to call tools correctly.

### B3. Open Open WebUI and connect the tools
1. In your browser, go to **http://localhost:8083**
2. Create the local account it asks for (this stays on your machine).
3. Go to the tool/connector settings (in current versions this is under **Settings → Tools**, or **Admin Settings → External Tools**) and add a tool server:
   * **URL:** `http://mcpo:8000`
   * **API key / Bearer token:** the `OMNI_TOKEN` you set in `.env`.

<kbd><img src="images/openwebui-tools.png" width="900"></kbd>

*(Image: adding the omni-endo tool server in Open WebUI's settings.)*

### B4. Chat
Start a new chat, pick your tools-capable model, make sure the omni-endo tool is enabled for the chat, and ask the same kind of questions as above.

### B5. Explore the raw API (optional)
The bridge also gives you a browsable API. Open **http://localhost:8000/docs** to see every tool, read what it does, and even try it out (you'll be asked for your `OMNI_TOKEN`).

> [!NOTE]
> All dates in the API are **UTC**. If you call it directly, send UTC times and expect UTC back.

---

## 🛑 How to Stop
* **Claude Desktop path:** nothing to stop, Claude shuts the container down itself when it's done.
* **Open WebUI path:** in your terminal, in the project folder, run:
  ```bash
  docker compose down
  ```

---

## 🛠️ Troubleshooting
> [!NOTE]
> This section will grow over time. If you hit something not covered here, please open an issue and I'll help.

**Only some tools show up in Claude (e.g. just two).**
Set Claude's tool loading to **"Tools already loaded"** (Section A4). In "Load tools when needed" mode Claude may not surface the summary/trend tools for a given question.

**Claude seems to be running old behaviour after an update.**
Rebuild the image: `docker compose build --no-cache`. A cached image can keep running old code.

**"Port already in use".**
Another app is using a port (3033, 8000, or 8083). Open `docker-compose.yml` and change the first number in the relevant `"XXXX:YYYY"` mapping (e.g. `"8083:8080"` to `"8090:8080"`), then start again and use the new port.

**Open WebUI can't reach the tools.**
Check the URL is `http://mcpo:8000` (not `localhost`) and that the API key matches your `OMNI_TOKEN` exactly.

**I asked about a date and got nothing back.**
If you're using the **example data** (offline mode), only the example's date range is available. Ask the assistant what date range it holds first.

---

## 📬 Get in Touch

Whether you're stuck on Docker or want to share how the audit improved your Time in Range, I'm happy to help.

### **Technical Help**
If something isn't working, please **[Open an Issue](https://github.com/rilhia/omni-endo-ai-mcp/issues)** so others can benefit from the solution too.

### **Personal & Professional**
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-blue?style=for-the-badge&logo=linkedin)](https://www.linkedin.com/in/rilhia/)

> [!NOTE]
> **Privacy Reminder:** if you send me a screenshot for support, please blur out any private medical information or Glooko credentials first.

---

## How the code is organised
*(For developers reading the source. If you just want to use the tool, you can ignore this.)*

The data flows: Glooko -> sync -> store -> range -> analytics -> tools -> your AI.

* **`src/server.js`**, the MCP server and the tool definitions (what Claude launches over stdio). Thin wrappers around the analytics.
* **`src/http.js`**, an alternative HTTP/SSE front door to the same tools (used by Open WebUI via the bridge).
* **`src/analytics.js`**, the heart: all the clinical maths and data shaping, written as pure functions.
* **`src/store.js`**, the SQLite archive (normalised rows, not raw Glooko blobs).
* **`src/range.js`**, the layer the tools call; answers from the local archive and tops up from Glooko only when needed. Offline mode is gated here.
* **`src/sync.js`**, the engine that pulls Glooko data into the archive (cold start, top-up, startup warm-up).
* **`src/glooko.js`**, the Glooko API client (auth and fetching).
* **`src/prompt.js`**, the clinical-auditor persona.

A few invariants hold throughout: glucose is stored internally in one canonical unit (mmol/L) and only converted on output; bolus is summed from individual events while basal comes from Glooko's daily totals; all times are UTC; and per-day rates use the real observed span of data.

---

### Disclaimer
*This tool is for informational and educational purposes only. It is not a medical device and is not a substitute for professional medical advice, diagnosis, or treatment. Always seek the advice of your physician or other qualified health provider with any questions regarding a medical condition. Any analysis produced with the help of this tool, including AI-generated suggestions, must be reviewed with a qualified clinical professional before making any changes to your insulin therapy or medical regimen.*
