import React, { useState } from "react";
import type { TaskEvent } from "../types.js";

const EVENT_ICONS: Record<string, { icon: string; color: string; label: string }> = {
  created: { icon: "✨", color: "#94a3b8", label: "Task Created" },
  claimed: { icon: "🔒", color: "#60a5fa", label: "Worker Claimed Task" },
  llm_call: { icon: "🧠", color: "#c084fc", label: "LLM Thought / Step" },
  tool_call: { icon: "🛠️", color: "#38bdf8", label: "Tool Executed" },
  proposal_created: { icon: "💡", color: "#fbbf24", label: "Fix Proposal Created" },
  human_approved: { icon: "👍", color: "#4ade80", label: "Approved by Human" },
  human_rejected: { icon: "👎", color: "#f87171", label: "Rejected by Human" },
  fix_applied: { icon: "📝", color: "#34d399", label: "Patch Created & Applied" },
  recovered_after_crash: { icon: "🔄", color: "#fb923c", label: "Recovered from Crash" },
  completed: { icon: "🎉", color: "#22c55e", label: "Task Completed" },
  failed: { icon: "💥", color: "#ef4444", label: "Task Failed" },
};

export const Timeline: React.FC<{ events: TaskEvent[] }> = ({ events }) => {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (!events || events.length === 0) {
    return <div style={{ color: "#64748b", padding: "12px 0" }}>No diary events recorded yet.</div>;
  }

  return (
    <div style={{ position: "relative", paddingLeft: "24px" }}>
      {/* Vertical timeline spine */}
      <div
        style={{
          position: "absolute",
          top: "12px",
          bottom: "12px",
          left: "11px",
          width: "2px",
          backgroundColor: "#334155",
        }}
      />

      {events.map((evt) => {
        const conf = EVENT_ICONS[evt.event_type] || {
          icon: "📌",
          color: "#94a3b8",
          label: evt.event_type,
        };
        const isExpanded = expandedId === evt.id;
        const timeStr = new Date(evt.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        return (
          <div
            key={evt.id}
            style={{
              position: "relative",
              marginBottom: "16px",
            }}
          >
            {/* Timeline node icon */}
            <div
              style={{
                position: "absolute",
                left: "-24px",
                top: "2px",
                width: "22px",
                height: "22px",
                borderRadius: "50%",
                backgroundColor: "#1e293b",
                border: `2px solid ${conf.color}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
                zIndex: 2,
              }}
            >
              {conf.icon}
            </div>

            {/* Event content box */}
            <div
              style={{
                backgroundColor: "#1e293b",
                border: "1px solid #334155",
                borderRadius: "6px",
                padding: "8px 12px",
                fontSize: "0.85rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: evt.payload && Object.keys(evt.payload).length > 0 ? "pointer" : "default",
                }}
                onClick={() => setExpandedId(isExpanded ? null : evt.id)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontWeight: 600, color: conf.color }}>{conf.label}</span>
                  {evt.from_status && evt.to_status && evt.from_status !== evt.to_status && (
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "#94a3b8",
                        backgroundColor: "#0f172a",
                        padding: "1px 6px",
                        borderRadius: "4px",
                      }}
                    >
                      {evt.from_status} → {evt.to_status}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ color: "#64748b", fontSize: "0.75rem" }}>{timeStr}</span>
                  {evt.payload && Object.keys(evt.payload).length > 0 && (
                    <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  )}
                </div>
              </div>

              {/* Expandable payload details */}
              {isExpanded && evt.payload && Object.keys(evt.payload).length > 0 && (
                <div
                  style={{
                    marginTop: "8px",
                    paddingTop: "8px",
                    borderTop: "1px solid #334155",
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      padding: "8px",
                      backgroundColor: "#0f172a",
                      borderRadius: "4px",
                      color: "#94a3b8",
                      fontSize: "0.75rem",
                      overflowX: "auto",
                      maxHeight: "200px",
                    }}
                  >
                    {JSON.stringify(evt.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
