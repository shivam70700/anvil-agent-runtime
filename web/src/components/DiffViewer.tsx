import React from "react";

interface DiffViewerProps {
  filePath?: string;
  oldText?: string;
  newText?: string;
  patch?: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  filePath,
  oldText,
  newText,
  patch,
}) => {
  if (patch) {
    const lines = patch.split("\n");
    return (
      <div
        style={{
          backgroundColor: "#090d16",
          border: "1px solid #1e293b",
          borderRadius: "8px",
          overflow: "hidden",
          fontFamily: "'Fira Code', 'JetBrains Mono', Consolas, monospace",
          fontSize: "0.85rem",
        }}
      >
        {filePath && (
          <div
            style={{
              padding: "8px 14px",
              backgroundColor: "#111827",
              borderBottom: "1px solid #1e293b",
              color: "#94a3b8",
              fontSize: "0.8rem",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span>📄</span>
            <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{filePath}</span>
            <span style={{ marginLeft: "auto", color: "#64748b" }}>Unified Diff Patch</span>
          </div>
        )}
        <div style={{ padding: "10px 0", maxHeight: "400px", overflowY: "auto" }}>
          {lines.map((line, idx) => {
            let bg = "transparent";
            let color = "#cbd5e1";

            if (line.startsWith("+") && !line.startsWith("+++")) {
              bg = "rgba(34, 197, 94, 0.15)";
              color = "#4ade80";
            } else if (line.startsWith("-") && !line.startsWith("---")) {
              bg = "rgba(239, 68, 68, 0.15)";
              color = "#f87171";
            } else if (line.startsWith("@@")) {
              bg = "rgba(59, 130, 246, 0.1)";
              color = "#93c5fd";
            }

            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  padding: "2px 14px",
                  backgroundColor: bg,
                  color,
                  lineHeight: "1.4",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                <span
                  style={{
                    width: "36px",
                    color: "#475569",
                    userSelect: "none",
                    flexShrink: 0,
                    textAlign: "right",
                    marginRight: "12px",
                  }}
                >
                  {idx + 1}
                </span>
                <span>{line}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const oldLines = (oldText || "").split("\n");
  const newLines = (newText || "").split("\n");

  return (
    <div
      style={{
        backgroundColor: "#090d16",
        border: "1px solid #1e293b",
        borderRadius: "8px",
        overflow: "hidden",
        fontFamily: "'Fira Code', 'JetBrains Mono', Consolas, monospace",
        fontSize: "0.85rem",
      }}
    >
      {filePath && (
        <div
          style={{
            padding: "8px 14px",
            backgroundColor: "#111827",
            borderBottom: "1px solid #1e293b",
            color: "#94a3b8",
            fontSize: "0.8rem",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>📄</span>
          <span style={{ fontWeight: 600, color: "#e2e8f0" }}>{filePath}</span>
          <span style={{ marginLeft: "auto", color: "#64748b" }}>Proposed Change</span>
        </div>
      )}
      <div style={{ maxHeight: "400px", overflowY: "auto" }}>
        {/* Removed lines in red */}
        <div style={{ borderBottom: "1px solid #1e293b" }}>
          <div
            style={{
              padding: "4px 14px",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              color: "#f87171",
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            - Original Code (to be removed)
          </div>
          {oldLines.map((line, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                padding: "2px 14px",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                color: "#fca5a5",
                lineHeight: "1.4",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              <span
                style={{
                  width: "20px",
                  color: "#ef4444",
                  fontWeight: "bold",
                  userSelect: "none",
                }}
              >
                -
              </span>
              <span>{line}</span>
            </div>
          ))}
        </div>

        {/* Added lines in green */}
        <div>
          <div
            style={{
              padding: "4px 14px",
              backgroundColor: "rgba(34, 197, 94, 0.1)",
              color: "#4ade80",
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            + Proposed Code (to be inserted)
          </div>
          {newLines.map((line, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                padding: "2px 14px",
                backgroundColor: "rgba(34, 197, 94, 0.15)",
                color: "#86efac",
                lineHeight: "1.4",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              <span
                style={{
                  width: "20px",
                  color: "#22c55e",
                  fontWeight: "bold",
                  userSelect: "none",
                }}
              >
                +
              </span>
              <span>{line}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
