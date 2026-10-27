# Anvil: Task Engine & Code-Search Agent

Anvil is a minimalist, reliable task execution engine and code-search AI agent built from scratch in TypeScript—with zero heavy agent frameworks or ORMs.

---

## Phase 1: Core Task Engine

In Phase 1, Anvil provides:
- **Strict State Machine**: Enforces legal task lifecycle transitions (`queued`, `running`, `waiting_for_human`, `completed`, `failed`).
- **Append-Only Event Diary**: Records an immutable audit log (`task_events`) of every status change and worker claim.
- **Race-Proof Worker Queue**: Uses PostgreSQL row-level locking (`SELECT ... FOR UPDATE SKIP LOCKED`) so multiple concurrent workers claim tasks without collisions.
- **REST API**: Simple Express endpoints with Zod schema validation to create, inspect, and health-check tasks.

---

## Phase 2: Agent Worker Loop & Tool Execution

In Phase 2, Anvil adds:
- **Provider-Agnostic LLM Interface**: Seamless switching between offline `MockLlm` and live `GeminiLlm` via `LLM_MODE`.
- **Sandboxed Tool Registry**: `list_files` and `read_file` with strict path traversal defense (rejecting `../` or root escapes).
- **Autonomous ReAct Agent Loop**: Iterative Reason + Act cycle with an 8-step safety circuit breaker ceiling.
- **Granular Audit Logging**: Live recording of every LLM query, tool invocation, tool output, and error into `task_events`.
- **Exponential Backoff**: Automatic retry on transient HTTP 429 rate limits and 5xx server errors up to 3 times.
- **Autonomous Worker CLI**: `npm run worker` daemon polling every 2s with graceful Ctrl+C shutdown.

---

## Phase 3: Code Search & Hybrid Embeddings Engine

In Phase 3, Anvil adds:
- **Code Chunker & Scanner**: Walks repositories, filtering binaries/noise, and generates ~40-line chunks with 10-line sliding overlap.
- **Deduplication**: Idempotent re-indexing via database transactions and uniqueness constraints.
- **Keyword Search**: Sub-millisecond Postgres Full-Text Search with `tsvector` and `GIN` index.
- **Semantic Search**: 768-dimensional vector cosine distance search (`<=>`) using `pgvector`.
- **Hybrid Search (Reciprocal Rank Fusion)**: Blends keyword and semantic candidate ranks using the standardized RRF formula: $RRF(d) = \sum \frac{1}{60 + \text{rank}}$.
- **`search_code` Tool**: Integrates directly with the autonomous agent so it can search and read relevant code snippets to answer complex code queries.

---

## Phase 4: Human-in-the-Loop Fix Proposals, Patches & Benchmarks

In Phase 4, Anvil adds:
- **`propose_fix` Tool**: Validates path containment and asserts `old_text` matches exactly once; pauses the task in `waiting_for_human` without touching disk files.
- **Human Review Endpoints**:
  - `POST /tasks/:id/approve`: Moves task to `running`, generates unified diff via `diff`, writes `./patches/<id>.patch`, applies the file edit, and marks `completed`.
  - `POST /tasks/:id/reject`: Moves task to `failed` with `"rejected by human"` and leaves files completely untouched.
- **Search Evaluation Benchmark (`npm run eval`)**: Benchmarks retrieval across keyword, semantic, and hybrid modes against `eval/golden.json`, computing Hit@1 and Hit@5 metrics.

---

## Phase 5: Production Deployment, Hardening & Web Dashboard

In Phase 5, Anvil completes production readiness:
- **Web Dashboard (`/web`)**: Built with Vite + React + TypeScript.
  - Real-time polling every 2 seconds (no fragile websockets).
  - Colored status badges (`queued`, `running`, `waiting_for_human`, `completed`, `failed`).
  - New Task form with 500-character counter, error feedback, and preset demo prompts.
  - Interactive event timeline displaying the full `task_events` audit trail.
  - Human approval panel with red/green diff review and Approve/Reject buttons.
  - Cold-start watchdog banner (*"Server is waking up from free-tier sleep..."*) for Render spin-ups (> 2.5s).
- **Production Server Hardening**:
  - Shared passcode authentication (`x-anvil-passcode` header) with bypass for `/health` and `OPTIONS`.
  - In-memory sliding-window IP rate limiter (`RATE_LIMIT_PER_MINUTE`).
  - Daily task creation cap (`DAILY_TASK_CAP = 50`) preventing unexpected billings or spam.
  - 500-character input validation on task queries via Zod.
  - Neon Cloud PostgreSQL integration with automatic SSL detection and connection retry backoff on serverless cold starts.
  - Ephemeral `DEMO_MODE=true` support: records approved diffs directly into Postgres without mutating container files.
- **Autonomous Crash Recovery**:
  - Moves tasks stuck in `running` status for > 5 minutes back to `queued` with event `recovered_after_crash`.
  - Tracks recovery attempts: if a task crashes more than 2 times, transitions it permanently to `failed`.
- **Single-Process Unified Runner (`npm run start:prod`)**:
  - Combines the Express HTTP API, autonomous background worker loop, and periodic crash recovery daemon inside a single Node process—perfect for free cloud hosting (Render Free Tier 1 web service limit).

---

## System Architecture

```mermaid
flowchart TD
  User["Browser / Human Reviewer"] <-->|"Poll 2s / REST"| Web["Vite + React Dashboard (/web)"]
  Web <-->|"HTTP + x-anvil-passcode"| API["Express API Server"]
  Client["CLI / curl"] -->|"REST Requests"| API

  subgraph Security["API Security & Guardrails"]
    Auth["Passcode Auth (x-anvil-passcode)"]
    Limiter["IP Rate Limiter (60 req/min)"]
    Cap["Daily Task Cap (50 tasks/day)"]
    CharLimit["500-Char Question Ceiling"]
  end

  API --- Security

  subgraph ProdProcess["Unified Production Process (npm run start:prod)"]
    API
    Worker["Autonomous Background Worker (2s poll)"]
    Recovery["Periodic Crash Recovery Daemon (60s)"]
  end

  subgraph Database["PostgreSQL 16 + pgvector (Neon / Docker)"]
    TasksTbl["tasks Table"]
    EventsTbl["task_events (Append-Only Diary)"]
    ChunksTbl["code_chunks (tsvector + vector(768))"]
  end

  API -->|"transitionTask() (SELECT FOR UPDATE)"| TasksTbl
  API -->|"recordTaskEvent()"| EventsTbl
  Recovery -->|"Recover stuck 'running' tasks"| TasksTbl

  Worker -->|"claimNextTask() (SKIP LOCKED)"| TasksTbl
  Worker --> Agent["ReAct Agent Loop (8-step limit)"]
  Agent <-->|"Thought & Function Calls"| LLM["LLM Client (MockLlm / GeminiLlm)"]
  Agent -->|"Run Tools"| Registry["Tool Registry"]

  subgraph Tools["Sandboxed Tools"]
    T1["list_files"]
    T2["read_file"]
    T3["search_code (Keyword / Semantic / Hybrid RRF)"]
    T4["propose_fix (Path Containment & countOccurrences === 1)"]
  end

  Registry --> Tools
  T3 -->|"Hybrid RRF Query"| ChunksTbl
  T4 -->|"Move to waiting_for_human"| TasksTbl

  subgraph HumanApproval["Human-in-the-Loop Approval"]
    ApproveEndpoint["POST /tasks/:id/approve"]
    DiffEngine["Diff Engine (diff package)"]
    PatchesDir["./patches/<id>.patch"]
    ApplyDisk["Apply Edit to Disk (skipped if DEMO_MODE=true)"]
  end

  API --> ApproveEndpoint
  ApproveEndpoint --> DiffEngine
  DiffEngine --> PatchesDir
  DiffEngine --> ApplyDisk
  ApplyDisk -->|"Mark Completed"| TasksTbl
```

---

## Task Lifecycle & State Machine

```
              ┌─────────┐
              │ queued  │
              └────┬────┘
                   │
                   ▼
  ┌───────────► running ◄──────────┐
  │              │   │             │
  │     ┌────────┘   └────────┐    │
  │     ▼                     ▼    │
┌─┴────────────────┐       ┌───────┴───┐
│ waiting_for_human│       │ completed │ (terminal)
└───────┬──────────┘       └───────────┘
        │
        ▼
   ┌─────────┐
   │ failed  │ (terminal)
   └─────────┘
```

| Current Status | Allowed Next Statuses | Terminal? | Notes |
| :--- | :--- | :--- | :--- |
| `queued` | `running` | No | Waiting to be claimed by an available worker. |
| `running` | `waiting_for_human`, `completed`, `failed` | No | Actively being processed by a worker. |
| `waiting_for_human` | `running`, `failed` | No | Paused awaiting human input or approval. |
| `completed` | *(none)* | **Yes** | Successfully finished. Cannot be transitioned. |
| `failed` | *(none)* | **Yes** | Errored or aborted. Cannot be transitioned. |

---

## Quickstart

### Prerequisites
- Node.js 20+
- Docker and Docker Compose

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Configuration
Ensure `.env` exists (copied from `.env.example`):
```bash
cp .env.example .env
```
Default connection string:
```env
DATABASE_URL=postgresql://anvil_user:anvil_password@localhost:5432/anvil_db
PORT=3000
```

> **Note on Port Conflicts**: If you already have PostgreSQL running on your host machine on port `5432`, you can update `docker-compose.yml` to `"5433:5432"` and update `DATABASE_URL` in `.env` to point to port `5433`.

### 3. Start PostgreSQL with pgvector
```bash
docker compose up -d
```

### 4. Run SQL Migrations
Apply the initial schema (`tasks` table, `task_events` diary, and `pgvector` extension):
```bash
npm run migrate
```

### 5. Run the Test Suite
Run Vitest to verify all legal and illegal transitions and execute the 3-worker concurrency test:
```bash
npm test
```

### 6. Start the API Server
Start the development server with live reload:
```bash
npm run dev
```

### 7. Start the Autonomous Worker
In a second terminal window, start the background worker:
```bash
# Runs in mock mode by default:
npm run worker

# Or to run with real Gemini API:
LLM_MODE=gemini GEMINI_API_KEY="your-key" npm run worker
```

---

## API Usage & Verification via curl

### 1. Health Check
```bash
curl -s http://localhost:3000/health
```
**Response (200 OK)**:
```json
{
  "status": "ok",
  "timestamp": "2026-10-25T12:00:00.000Z",
  "database": "connected"
}
```

### 2. Create a New Task
```bash
curl -s -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "code_search",
    "input": {
      "query": "How does transitionTask lock rows?"
    }
  }'
```
**Response (201 Created)**:
```json
{
  "id": "e67b2fc7-7892-4217-a068-d63640ce9764",
  "type": "code_search",
  "status": "queued",
  "input": {
    "query": "How does transitionTask lock rows?"
  },
  "result": null,
  "error": null,
  "locked_by": null,
  "created_at": "2026-10-25T12:01:00.000Z",
  "updated_at": "2026-10-25T12:01:00.000Z"
}
```

### 3. Fetch Task and Its Audit Events Diary
```bash
curl -s http://localhost:3000/tasks/<TASK_ID>
```
**Response (200 OK)**:
```json
{
  "task": {
    "id": "e67b2fc7-7892-4217-a068-d63640ce9764",
    "type": "code_search",
    "status": "queued",
    "input": {
      "query": "How does transitionTask lock rows?"
    },
    "result": null,
    "error": null,
    "locked_by": null,
    "created_at": "2026-10-25T12:01:00.000Z",
    "updated_at": "2026-10-25T12:01:00.000Z"
  },
  "events": [
    {
      "id": 1,
      "task_id": "e67b2fc7-7892-4217-a068-d63640ce9764",
      "from_status": null,
      "to_status": "queued",
      "event_type": "created",
      "payload": {
        "input": {
          "query": "How does transitionTask lock rows?"
        }
      },
      "created_at": "2026-10-25T12:01:00.000Z"
    }
  ]
}
```

---

## Code Indexing & Search Commands

### 1. Index the Repository
Recursively scans files, splits into ~40-line chunks with 10-line overlap, and stores them in PostgreSQL with full-text and vector capabilities:
```bash
npm run index -- .
```

### 2. Search Modes in the Terminal
Compare the three search modes side by side:

**Keyword Search (PostgreSQL full-text search with `tsvector` + GIN index):**
```bash
npm run search -- "transitionTask" --mode keyword
```

**Semantic Search (pgvector cosine similarity with 768-dim embeddings):**
```bash
npm run search -- "how does the task engine lock rows" --mode semantic
```

**Hybrid Search (Reciprocal Rank Fusion blending keyword + semantic):**
```bash
npm run search -- "how does transitionTask validate moves" --mode hybrid
```

---

## Human-in-the-Loop Fix Proposal & Approval

When an agent needs to fix a bug or modify code, it calls `propose_fix(file_path, old_text, new_text, explanation)`.
- **Validation**: Enforces that `file_path` is within `REPO_PATH` and `old_text` appears **exactly once**.
- **Safe Pause**: The task automatically moves to `waiting_for_human` status. Zero files are touched on disk.

### 1. Approve a Proposed Fix
Generates a `.patch` file in `./patches/<task-id>.patch`, applies the change to disk, and transitions the task to `completed`:
```bash
curl -s -X POST http://localhost:3000/tasks/<TASK_ID>/approve
```
**Response**:
```json
{
  "status": "completed",
  "patchFile": "./patches/e67b2fc7-7892-4217-a068-d63640ce9764.patch",
  "task": {
    "id": "e67b2fc7-7892-4217-a068-d63640ce9764",
    "status": "completed",
    "result": {
      "filePath": "src/calculator.ts",
      "oldText": "return a - b;",
      "newText": "return a + b;",
      "patchFile": "./patches/e67b2fc7-7892-4217-a068-d63640ce9764.patch",
      "status": "applied"
    }
  }
}
```

### 2. Reject a Proposed Fix
Transitions the task to `failed` and leaves the codebase completely untouched:
```bash
curl -s -X POST http://localhost:3000/tasks/<TASK_ID>/reject \
  -H "Content-Type: application/json" \
  -d '{"reason": "rejected by human"}'
```

---

## Code Search Evaluation Benchmark (`npm run eval`)

Run the benchmark across 10 evaluation questions in `eval/golden.json`:
```bash
npm run eval
```

### Benchmark Results (`eval/results.md`)

| Search Mode | Queries | Hit@1 | Hit@1 Rate | Hit@5 | Hit@5 Rate |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Keyword** (Postgres FTS) | 10 | 0 | 0.0% | 3 | 30.0% |
| **Semantic** (pgvector cosine) | 10 | 1 | 10.0% | 6 | **60.0%** |
| **Hybrid** (Reciprocal Rank Fusion) | 10 | 1 | 10.0% | 4 | 40.0% |

- **Keyword Search**: Excels when precise technical identifiers (e.g., `transitionTask`) appear verbatim.
- **Semantic Search**: Excels at conceptual questions where vocabulary differs from the code comments.
- **Hybrid Search (RRF)**: Balances both worlds without tuning arbitrary score weights.

---

## Design Decisions

1. **Pure TypeScript & Plain SQL (`pg`) over ORMs**:
   - ORMs obscure transaction boundaries and lack first-class support for advanced locking like `SELECT ... FOR UPDATE SKIP LOCKED` and pgvector cosine distance operators (`<=>`).
   - Plain SQL keeps queries transparent, performant, and completely explainable.
2. **Zero Heavy Agent Frameworks (No LangChain / LlamaIndex)**:
   - Built from first principles using direct HTTP/SDK calls and a clean Reason+Act loop.
   - Eliminates hundreds of unpredictable sub-dependencies and abstraction leaks.
3. **Append-Only Event Diary (`task_events`)**:
   - Rather than just storing the "current" task status, every LLM query, response, tool call, observation, and status transition is immutably appended to `task_events`.
   - Enables full observability, step-by-step replay, and auditability.
4. **Offline Mock Mode (`MockLlm` & `MockEmbedder`) by Default**:
   - The Gemini free tier has strict rate limits.
   - All tests and local development can run 100% offline at $0 cost and execute in milliseconds.
5. **Two-Stage Human-in-the-Loop Fix Application**:
   - Hallucinated or erroneous code proposals are never automatically applied to disk.
   - Enforcing unique-occurrence checks (`countOccurrences === 1`), diff patch generation, and explicit HTTP approval keeps production code safe.

---

## What I'd Build Next (v2 Roadmap)

1. **AST-Aware Syntax Chunking**:
   - Replace fixed ~40-line sliding windows with Tree-Sitter AST chunking to ensure chunk boundaries respect function, class, and interface syntax scopes.
2. **Multi-File Patch Transactions**:
   - Support proposing fixes that span multiple files atomically using a Git branch or worktree staging area.
3. **Pre-Approval Test Execution**:
   - Have the agent automatically run `vitest` in an isolated sandbox before proposing a fix to verify that the proposed patch actually resolves the bug without breaking existing tests.
4. **Distributed Worker Orchestration & Dead-Letter Queues**:
   - Add worker heartbeat timeouts to automatically release tasks locked by crashed workers and route repeatedly failing jobs to a dead-letter queue.

---

## Production Deployment Checklist (100% Free Tier)

Follow this step-by-step checklist to deploy Anvil end-to-end on free cloud infrastructure:

### Architecture at a Glance
- **Database**: [Neon Serverless Postgres](https://neon.tech) with `pgvector` extension (Free Tier: 0.5 GB storage, serverless autoscaling).
- **Backend Service**: [Render Web Service](https://render.com) running `npm run start:prod` (Combines API + Worker + Crash Recovery in 1 process, Free Tier: 512 MB RAM, spins down on idle).
- **Frontend Dashboard**: [Render Static Site](https://render.com) built from `/web` (Free Tier: Global CDN).

---

### Step 1: Provision Neon Cloud Database

1. Sign up for a free account at [neon.tech](https://neon.tech).
2. Create a new project (e.g., `anvil-production`).
3. Open the **SQL Editor** in the Neon console and enable the `pgvector` extension:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
4. Copy your pooled connection string from the Neon dashboard. It looks like:
   ```
   postgresql://neondb_owner:YOUR_PASSWORD@ep-xyz-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   *(Note: Ensure `sslmode=require` is included; Anvil automatically activates SSL and retry handling for Neon URLs).*
5. Run schema migrations against your Neon database from your local machine:
   ```bash
   DATABASE_URL="<your-neon-url>" npm run migrate
   ```
6. Index the demo repository into your Neon database:
   ```bash
   DATABASE_URL="<your-neon-url>" npm run index -- demo-repo
   ```

---

### Step 2: Deploy Backend Web Service to Render

Render's free tier allows 1 active web service. Anvil bundles the HTTP API, background task worker, and periodic crash recovery daemon into a single process (`npm run start:prod`).

1. Sign up or log into [render.com](https://render.com).
2. Click **New +** -> **Web Service**.
3. Connect your Git repository.
4. Configure the service settings:
   - **Name**: `anvil-api`
   - **Region**: Choose the region closest to your Neon database (e.g. Ohio / Oregon / Frankfurt)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start:prod`
   - **Instance Type**: `Free`
5. Configure Environment Variables (click **Add Environment Variable**):
   | Variable | Value | Description |
   | :--- | :--- | :--- |
   | `NODE_ENV` | `production` | Enables production mode |
   | `PORT` | `10000` | Port assigned by Render |
   | `DATABASE_URL` | `<your-neon-connection-string>` | Neon connection string with `sslmode=require` |
   | `FRONTEND_ORIGIN` | `https://anvil-web.onrender.com` | Allowed CORS origin (or `*` during initial setup) |
   | `AUTH_PASSCODE` | `anvil-secret-2026` | Shared secret for `x-anvil-passcode` authentication |
   | `DEMO_MODE` | `true` | Approvals store diffs in Postgres without editing container files |
   | `REPO_PATH` | `./demo-repo` | Path to sample code repository |
   | `LLM_MODE` | `gemini` *(or `mock`)* | Set `mock` for $0 offline testing, `gemini` for live AI |
   | `GEMINI_API_KEY` | `<your-api-key>` | Free tier Google AI Studio API key (if using `gemini`) |
   | `DAILY_TASK_CAP` | `50` | Maximum tasks allowed per day |
6. Click **Deploy Web Service**.
7. Once deployed, verify health via terminal:
   ```bash
   curl https://anvil-api.onrender.com/health
   ```
   Expected response: `{"status":"ok","database":"connected","demoMode":true}`.

---

### Step 3: Deploy Frontend Dashboard to Render Static Site

1. In Render, click **New +** -> **Static Site**.
2. Connect your Git repository.
3. Configure the static site settings:
   - **Name**: `anvil-web`
   - **Branch**: `main`
   - **Root Directory**: `web`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
4. Configure Environment Variables:
   | Variable | Value | Description |
   | :--- | :--- | :--- |
   | `VITE_API_URL` | `https://anvil-api.onrender.com` | URL of your deployed backend service |
   | `VITE_PASSCODE` | `anvil-secret-2026` | Pre-fills the passcode in the dashboard |
5. Click **Create Static Site**.
6. Once deployed, copy your static site URL (e.g. `https://anvil-web.onrender.com`) and verify that it matches `FRONTEND_ORIGIN` in your backend service settings.

---

### Step 4: Verification & Smoke Test

1. Open your frontend dashboard URL in your browser: `https://anvil-web.onrender.com`.
2. Notice the status indicator: `Backend Online`, `DEMO MODE`, `Polling: 2s`.
3. Submit a new task from the New Task Form (e.g. *"Fix subtraction bug in demo-repo/math.ts"*).
4. Watch the status transition in real time:
   - `queued` ➔ `running` ➔ `waiting_for_human`
5. Click on the task in the list to inspect the **Event Timeline**.
6. Review the **Human Approval Panel** with the red/green diff.
7. Click **Approve & Apply**; watch the task complete and view the patch output.

---

### Running Full Stack Locally

To run the exact production stack locally:
```bash
# 1. Start Postgres with pgvector
docker compose up -d

# 2. Run schema migrations
npm run migrate

# 3. Index sample repo
npm run index -- demo-repo

# 4. Start combined API + worker + crash recovery process
npm run start:prod

# 5. In a second terminal, start the web dashboard
npm run --prefix web dev
```
Open `http://localhost:5173` to interact with the full dashboard.

