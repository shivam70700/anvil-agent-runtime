import React, { useState } from "react";
import { approveTask, rejectTask } from "../api.js";
import type { Task } from "../types.js";
import { DiffViewer } from "./DiffViewer.js";

interface ApprovalPanelProps {
  task: Task;
  onActionComplete: () => void;
}

export const ApprovalPanel: React.FC<ApprovalPanelProps> = ({
  task,
  onActionComplete,
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const proposal = (task.result as any)?.proposal;

  if (task.status !== "waiting_for_human" || !proposal) {
    return null;
  }

  const handleApprove = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await approveTask(task.id);
      onActionComplete();
    } catch (err: any) {
      setError(err.message || "Failed to approve fix proposal");
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await rejectTask(task.id, rejectReason || "rejected by human");
      onActionComplete();
    } catch (err: any) {
      setError(err.message || "Failed to reject fix proposal");
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: "#1e1b4b",
        border: "2px solid #6366f1",
        borderRadius: "10px",
        padding: "16px",
        marginTop: "16px",
        boxShadow: "0 4px 20px rgba(99, 102, 241, 0.2)",
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
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "1.25rem" }}>🛡️</span>
          <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#e0e7ff" }}>
            Human Approval Required
          </h3>
        </div>
        <span
          style={{
            backgroundColor: "#4338ca",
            color: "#c7d2fe",
            padding: "2px 8px",
            borderRadius: "6px",
            fontSize: "0.75rem",
            fontWeight: 600,
          }}
        >
          Gate: Step 4
        </span>
      </div>

      {proposal.explanation && (
        <div
          style={{
            backgroundColor: "rgba(15, 23, 42, 0.6)",
            border: "1px solid #3730a3",
            borderRadius: "6px",
            padding: "10px 14px",
            marginBottom: "14px",
            color: "#cbd5e1",
            fontSize: "0.9rem",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "#a5b4fc" }}>Agent Explanation: </strong>
          {proposal.explanation}
        </div>
      )}

      {/* Red/Green Diff View */}
      <DiffViewer
        filePath={proposal.filePath}
        oldText={proposal.oldText}
        newText={proposal.newText}
      />

      {error && (
        <div
          style={{
            marginTop: "12px",
            padding: "8px 12px",
            backgroundColor: "rgba(239, 68, 68, 0.2)",
            border: "1px solid #ef4444",
            borderRadius: "6px",
            color: "#fca5a5",
            fontSize: "0.85rem",
          }}
        >
          ⚠ {error}
        </div>
      )}

      {showRejectInput && (
        <div style={{ marginTop: "12px" }}>
          <input
            type="text"
            placeholder="Reason for rejection (optional)..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            disabled={submitting}
            style={{
              width: "100%",
              padding: "8px 12px",
              backgroundColor: "#0f172a",
              border: "1px solid #475569",
              borderRadius: "6px",
              color: "#f1f5f9",
              fontSize: "0.85rem",
              boxSizing: "border-box",
            }}
          />
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: "12px",
          marginTop: "16px",
          justifyContent: "flex-end",
        }}
      >
        {!showRejectInput ? (
          <button
            onClick={() => setShowRejectInput(true)}
            disabled={submitting}
            style={{
              padding: "8px 16px",
              backgroundColor: "transparent",
              color: "#f87171",
              border: "1px solid #ef4444",
              borderRadius: "6px",
              cursor: submitting ? "not-allowed" : "pointer",
              fontWeight: 600,
              fontSize: "0.85rem",
            }}
          >
            Reject Fix...
          </button>
        ) : (
          <button
            onClick={handleReject}
            disabled={submitting}
            style={{
              padding: "8px 16px",
              backgroundColor: "#ef4444",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              cursor: submitting ? "not-allowed" : "pointer",
              fontWeight: 600,
              fontSize: "0.85rem",
            }}
          >
            {submitting ? "Rejecting..." : "Confirm Reject"}
          </button>
        )}

        <button
          onClick={handleApprove}
          disabled={submitting}
          style={{
            padding: "8px 20px",
            backgroundColor: "#22c55e",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            cursor: submitting ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: "0.85rem",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            boxShadow: "0 2px 10px rgba(34, 197, 94, 0.4)",
          }}
        >
          <span>✓</span>
          <span>{submitting ? "Applying Fix..." : "Approve & Apply"}</span>
        </button>
      </div>
    </div>
  );
};
