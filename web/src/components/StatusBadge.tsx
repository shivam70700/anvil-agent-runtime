import React from "react";
import type { TaskStatus } from "../types.js";

const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; bg: string; text: string; border: string; icon: string }
> = {
  queued: {
    label: "Queued",
    bg: "#1e293b",
    text: "#94a3b8",
    border: "#334155",
    icon: "⏳",
  },
  running: {
    label: "Running",
    bg: "#172554",
    text: "#60a5fa",
    border: "#1d4ed8",
    icon: "⚙️",
  },
  waiting_for_human: {
    label: "Approval Needed",
    bg: "#451a03",
    text: "#fbbf24",
    border: "#b45309",
    icon: "👤",
  },
  completed: {
    label: "Completed",
    bg: "#052e16",
    text: "#4ade80",
    border: "#15803d",
    icon: "✓",
  },
  failed: {
    label: "Failed",
    bg: "#450a0a",
    text: "#f87171",
    border: "#b91c1c",
    icon: "✗",
  },
};

export const StatusBadge: React.FC<{ status: TaskStatus; size?: "sm" | "md" }> = ({
  status,
  size = "md",
}) => {
  const conf = STATUS_CONFIG[status] || STATUS_CONFIG.queued;
  const isSm = size === "sm";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        backgroundColor: conf.bg,
        color: conf.text,
        border: `1px solid ${conf.border}`,
        padding: isSm ? "2px 8px" : "4px 12px",
        borderRadius: "9999px",
        fontSize: isSm ? "0.75rem" : "0.85rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        boxShadow: status === "waiting_for_human" ? "0 0 10px rgba(245, 158, 11, 0.3)" : "none",
        animation: status === "running" ? "pulse 2s infinite" : "none",
      }}
    >
      <span>{conf.icon}</span>
      <span>{conf.label}</span>
    </span>
  );
};
