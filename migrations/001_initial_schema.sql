-- Enable pgvector extension for future vector operations
CREATE EXTENSION IF NOT EXISTS vector;

-- Table 1: tasks
-- Tracks the current state, input, and output of every task in the engine
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued', 'running', 'waiting_for_human', 'completed', 'failed')
    ),
    input JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB,
    error TEXT,
    locked_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for worker claiming queued tasks
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Table 2: task_events (Append-only diary)
-- Records every state transition, LLM call, and tool execution for full auditability
CREATE TABLE IF NOT EXISTS task_events (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup of a task's diary / event timeline
CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id, created_at ASC);
