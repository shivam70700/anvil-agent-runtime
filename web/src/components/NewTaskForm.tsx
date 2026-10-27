import React, { useState } from "react";
import { createTask } from "../api.js";
import type { Task } from "../types.js";

interface NewTaskFormProps {
  onTaskCreated: (task: Task) => void;
}

const PRESETS = [
  "Fix subtraction bug in demo-repo/math.ts where add() performs subtraction",
  "Add a new helper function formatCurrency(amount: number) to demo-repo/utils.ts",
  "Inspect demo-repo/greeting.ts and fix the case-sensitive greeting typo",
];

export const NewTaskForm: React.FC<NewTaskFormProps> = ({ onTaskCreated }) => {
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charCount = query.length;
  const isOverLimit = charCount > 500;
  const isValid = query.trim().length > 0 && !isOverLimit;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const task = await createTask({ query: query.trim() });
      setQuery("");
      onTaskCreated(task);
    } catch (err: any) {
      setError(err.message || "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: "#1e293b",
        border: "1px solid #334155",
        borderRadius: "10px",
        padding: "16px",
        marginBottom: "20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "#f8fafc", margin: 0 }}>
          ⚡ Submit New Agent Task
        </h2>
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: isOverLimit ? "#ef4444" : charCount > 400 ? "#f59e0b" : "#64748b",
          }}
        >
          {charCount} / 500 chars
        </span>
      </div>

      <form onSubmit={handleSubmit}>
        <textarea
          rows={3}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Describe code question or fix (e.g., 'Fix the bug in math.ts where add() does subtraction')..."
          disabled={submitting}
          style={{
            width: "100%",
            padding: "10px 12px",
            backgroundColor: "#0f172a",
            border: `1px solid ${isOverLimit ? "#ef4444" : "#475569"}`,
            borderRadius: "6px",
            color: "#f1f5f9",
            fontSize: "0.85rem",
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box",
            outline: "none",
          }}
        />

        {/* Quick demo presets */}
        <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
          <span style={{ fontSize: "0.7rem", color: "#64748b", alignSelf: "center" }}>
            Demo Presets:
          </span>
          {PRESETS.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setQuery(preset)}
              style={{
                backgroundColor: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "4px",
                color: "#94a3b8",
                padding: "2px 8px",
                fontSize: "0.7rem",
                cursor: "pointer",
                maxWidth: "240px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={preset}
            >
              {preset}
            </button>
          ))}
        </div>

        {error && (
          <div
            style={{
              marginTop: "10px",
              padding: "8px 12px",
              backgroundColor: "rgba(239, 68, 68, 0.2)",
              border: "1px solid #ef4444",
              borderRadius: "6px",
              color: "#fca5a5",
              fontSize: "0.8rem",
            }}
          >
            ⚠ {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
          <button
            type="submit"
            disabled={!isValid || submitting}
            style={{
              padding: "8px 20px",
              backgroundColor: isValid && !submitting ? "#3b82f6" : "#334155",
              color: isValid && !submitting ? "#ffffff" : "#64748b",
              border: "none",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: isValid && !submitting ? "pointer" : "not-allowed",
              boxShadow: isValid && !submitting ? "0 2px 8px rgba(59, 130, 246, 0.3)" : "none",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {submitting ? (
              <>
                <span>⏳</span>
                <span>Enqueuing...</span>
              </>
            ) : (
              <>
                <span>🚀</span>
                <span>Queue Task</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
