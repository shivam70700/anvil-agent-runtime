import React, { useEffect, useState } from "react";
import {
  fetchHealth,
  fetchTaskDetail,
  fetchTasks,
  getPasscode,
  setPasscode,
  subscribeSlowServer,
} from "./api.js";
import { ApprovalPanel } from "./components/ApprovalPanel.js";
import { DiffViewer } from "./components/DiffViewer.js";
import { NewTaskForm } from "./components/NewTaskForm.js";
import { StatusBadge } from "./components/StatusBadge.js";
import { Timeline } from "./components/Timeline.js";
import type { Task, TaskEvent } from "./types.js";

export const App: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverWakingUp, setServerWakingUp] = useState(false);
  const [passcodeVal, setPasscodeVal] = useState(getPasscode());
  const [showSettings, setShowSettings] = useState(false);
  const [healthInfo, setHealthInfo] = useState<{ status: string; mode?: string; demoMode?: boolean } | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "approval" | "completed">("all");

  // Subscribe to slow server watchdog (shows waking up banner if response > 2.5s)
  useEffect(() => {
    return subscribeSlowServer((isSlow) => {
      setServerWakingUp(isSlow);
    });
  }, []);

  // Check health on mount
  useEffect(() => {
    fetchHealth()
      .then((data) => setHealthInfo(data))
      .catch(() => setHealthInfo({ status: "disconnected" }));
  }, [passcodeVal]);

  // Main polling loop: every 2000ms (no websockets)
  useEffect(() => {
    let isMounted = true;

    const poll = async () => {
      try {
        const latestTasks = await fetchTasks();
        if (!isMounted) return;
        setTasks(latestTasks);

        // Auto-select first task if none selected yet
        if (!selectedTaskId && latestTasks.length > 0) {
          setSelectedTaskId(latestTasks[0]!.id);
        }
      } catch (err) {
        console.warn("Polling error:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedTaskId, passcodeVal]);

  // Fetch selected task detail & event diary
  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTask(null);
      setTaskEvents([]);
      return;
    }

    let isMounted = true;
    const fetchDetail = async () => {
      try {
        const res = await fetchTaskDetail(selectedTaskId);
        if (!isMounted) return;
        setSelectedTask(res.task);
        setTaskEvents(res.events);
      } catch (err) {
        console.warn(`Error fetching task ${selectedTaskId} detail:`, err);
      }
    };

    fetchDetail();
    // Poll detail every 2s
    const detailInterval = setInterval(fetchDetail, 2000);
    return () => {
      isMounted = false;
      clearInterval(detailInterval);
    };
  }, [selectedTaskId, passcodeVal]);

  const handleSavePasscode = () => {
    setPasscode(passcodeVal);
    setShowSettings(false);
  };

  const filteredTasks = tasks.filter((t) => {
    if (filter === "active") return t.status === "queued" || t.status === "running";
    if (filter === "approval") return t.status === "waiting_for_human";
    if (filter === "completed") return t.status === "completed" || t.status === "failed";
    return true;
  });

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "16px 20px" }}>
      {/* Top Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: "16px",
          borderBottom: "1px solid #334155",
          marginBottom: "16px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "8px",
              backgroundColor: "#2563eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "20px",
              boxShadow: "0 0 15px rgba(37, 99, 235, 0.5)",
            }}
          >
            ⚡
          </div>
          <div>
            <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "#f8fafc", margin: 0 }}>
              Anvil Agent Runtime
            </h1>
            <p style={{ fontSize: "0.8rem", color: "#94a3b8", margin: 0 }}>
              Autonomous Task Engine & Hybrid Search Agent
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {healthInfo && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                backgroundColor: "#1e293b",
                border: "1px solid #334155",
                borderRadius: "6px",
                padding: "4px 10px",
                fontSize: "0.75rem",
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: healthInfo.status === "ok" ? "#22c55e" : "#ef4444",
                }}
              />
              <span style={{ color: "#cbd5e1" }}>
                {healthInfo.status === "ok" ? "Backend Online" : "Degraded"}
              </span>
              {healthInfo.demoMode && (
                <span
                  style={{
                    backgroundColor: "#0369a1",
                    color: "#e0f2fe",
                    padding: "1px 6px",
                    borderRadius: "4px",
                    fontWeight: 600,
                  }}
                >
                  DEMO MODE
                </span>
              )}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "6px",
              padding: "4px 10px",
              fontSize: "0.75rem",
              color: "#94a3b8",
            }}
          >
            <span style={{ color: "#22c55e" }}>●</span>
            <span>Polling: 2s</span>
          </div>

          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              backgroundColor: passcodeVal ? "#1e293b" : "#334155",
              border: `1px solid ${passcodeVal ? "#3b82f6" : "#475569"}`,
              color: passcodeVal ? "#60a5fa" : "#f1f5f9",
              borderRadius: "6px",
              padding: "4px 10px",
              fontSize: "0.75rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>🔑</span>
            <span>{passcodeVal ? "Passcode Configured" : "Set Passcode"}</span>
          </button>
        </div>
      </header>

      {/* Passcode modal/drawer */}
      {showSettings && (
        <div
          style={{
            backgroundColor: "#1e293b",
            border: "1px solid #3b82f6",
            borderRadius: "8px",
            padding: "14px",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: "240px" }}>
            <label style={{ fontSize: "0.75rem", color: "#94a3b8", display: "block", marginBottom: "4px" }}>
              Shared API Passcode (sent via <code>x-anvil-passcode</code> header):
            </label>
            <input
              type="password"
              placeholder="Enter server passcode..."
              value={passcodeVal}
              onChange={(e) => setPasscodeVal(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 10px",
                backgroundColor: "#0f172a",
                border: "1px solid #475569",
                borderRadius: "4px",
                color: "#f1f5f9",
                fontSize: "0.85rem",
                boxSizing: "border-box",
              }}
            />
          </div>
          <button
            onClick={handleSavePasscode}
            style={{
              padding: "7px 16px",
              backgroundColor: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
              alignSelf: "flex-end",
            }}
          >
            Save Passcode
          </button>
        </div>
      )}

      {/* "Server is waking up..." Banner (Render free tier helper) */}
      {serverWakingUp && (
        <div
          style={{
            backgroundColor: "#78350f",
            border: "1px solid #f59e0b",
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            color: "#fef3c7",
            boxShadow: "0 4px 15px rgba(245, 158, 11, 0.2)",
            animation: "pulse 2s infinite",
          }}
        >
          <span style={{ fontSize: "1.4rem" }}>☕</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
              Server is waking up...
            </div>
            <div style={{ fontSize: "0.8rem", color: "#fde68a" }}>
              The Render free-tier container is spinning up from cold sleep (usually takes 30–50 seconds). Requests will resume automatically.
            </div>
          </div>
        </div>
      )}

      {/* Main Grid: Left Tasks, Right Detail */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(340px, 420px) 1fr",
          gap: "20px",
          alignItems: "start",
        }}
      >
        {/* Left Column: New Task Form & Task List */}
        <div>
          <NewTaskForm
            onTaskCreated={(newTask) => {
              setTasks((prev) => [newTask, ...prev]);
              setSelectedTaskId(newTask.id);
            }}
          />

          {/* Filter Pills */}
          <div
            style={{
              display: "flex",
              gap: "6px",
              marginBottom: "12px",
              paddingBottom: "8px",
              borderBottom: "1px solid #1e293b",
            }}
          >
            {(["all", "active", "approval", "completed"] as const).map((mode) => {
              const count = tasks.filter((t) => {
                if (mode === "active") return t.status === "queued" || t.status === "running";
                if (mode === "approval") return t.status === "waiting_for_human";
                if (mode === "completed") return t.status === "completed" || t.status === "failed";
                return true;
              }).length;

              const isSelected = filter === mode;
              const labels = {
                all: "All",
                active: "Active",
                approval: "Needs Approval",
                completed: "Done",
              };

              return (
                <button
                  key={mode}
                  onClick={() => setFilter(mode)}
                  style={{
                    backgroundColor: isSelected ? "#3b82f6" : "#1e293b",
                    color: isSelected ? "#ffffff" : "#94a3b8",
                    border: `1px solid ${isSelected ? "#3b82f6" : "#334155"}`,
                    borderRadius: "9999px",
                    padding: "3px 10px",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>{labels[mode]}</span>
                  <span
                    style={{
                      backgroundColor: isSelected ? "rgba(255,255,255,0.2)" : "#0f172a",
                      padding: "1px 6px",
                      borderRadius: "9999px",
                      fontSize: "0.7rem",
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Task List */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "650px", overflowY: "auto" }}>
            {loading && tasks.length === 0 && (
              <div style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>
                Loading tasks...
              </div>
            )}

            {!loading && filteredTasks.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  backgroundColor: "#1e293b",
                  borderRadius: "8px",
                  border: "1px dashed #334155",
                  color: "#64748b",
                  fontSize: "0.85rem",
                }}
              >
                No tasks found in this view. Submit a task above to begin.
              </div>
            )}

            {filteredTasks.map((t) => {
              const isSelected = t.id === selectedTaskId;
              const query = (t.input as any)?.query || (t.input as any)?.question || "Task";
              const timeStr = new Date(t.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <div
                  key={t.id}
                  onClick={() => setSelectedTaskId(t.id)}
                  style={{
                    backgroundColor: isSelected ? "#1e293b" : "#0f172a",
                    border: `1px solid ${isSelected ? "#3b82f6" : "#334155"}`,
                    borderRadius: "8px",
                    padding: "12px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                    boxShadow: isSelected ? "0 0 12px rgba(59, 130, 246, 0.25)" : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "6px",
                    }}
                  >
                    <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#64748b" }}>
                      {t.id.length > 20 ? `${t.id.substring(0, 18)}...` : t.id}
                    </span>
                    <StatusBadge status={t.status} size="sm" />
                  </div>

                  <div
                    style={{
                      color: "#f1f5f9",
                      fontSize: "0.85rem",
                      fontWeight: 500,
                      lineHeight: 1.4,
                      marginBottom: "6px",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {query}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#64748b" }}>
                    <span>{t.type}</span>
                    <span>{timeStr}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Task Details */}
        <div
          style={{
            backgroundColor: "#1e293b",
            border: "1px solid #334155",
            borderRadius: "10px",
            padding: "20px",
            minHeight: "500px",
          }}
        >
          {!selectedTask ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "400px",
                color: "#64748b",
              }}
            >
              <span style={{ fontSize: "2.5rem", marginBottom: "12px" }}>📋</span>
              <p style={{ margin: 0, fontSize: "0.95rem" }}>Select a task from the list to view its timeline and details.</p>
            </div>
          ) : (
            <div>
              {/* Task Detail Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  paddingBottom: "16px",
                  borderBottom: "1px solid #334155",
                  marginBottom: "16px",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f8fafc", margin: 0 }}>
                      Task {selectedTask.id}
                    </h2>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                    Created: {new Date(selectedTask.created_at).toLocaleString()} • Updated: {new Date(selectedTask.updated_at).toLocaleTimeString()}
                    {selectedTask.locked_by && (
                      <span style={{ marginLeft: "8px", color: "#60a5fa" }}>
                        • Worker: <code>{selectedTask.locked_by}</code>
                      </span>
                    )}
                  </div>
                </div>

                <StatusBadge status={selectedTask.status} />
              </div>

              {/* Task Input Prompt */}
              <div
                style={{
                  backgroundColor: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "6px",
                  padding: "12px",
                  marginBottom: "16px",
                }}
              >
                <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 600, textTransform: "uppercase", marginBottom: "4px" }}>
                  Input Prompt
                </div>
                <div style={{ color: "#e2e8f0", fontSize: "0.9rem", lineHeight: 1.5 }}>
                  {(selectedTask.input as any)?.query || (selectedTask.input as any)?.question || JSON.stringify(selectedTask.input)}
                </div>
              </div>

              {/* Approval Panel (if status === 'waiting_for_human') */}
              {selectedTask.status === "waiting_for_human" && (
                <ApprovalPanel
                  task={selectedTask}
                  onActionComplete={async () => {
                    const res = await fetchTaskDetail(selectedTask.id);
                    setSelectedTask(res.task);
                    setTaskEvents(res.events);
                    const allTasks = await fetchTasks();
                    setTasks(allTasks);
                  }}
                />
              )}

              {/* Task Result / Patch Display (if completed) */}
              {selectedTask.result && (
                <div
                  style={{
                    backgroundColor: "#052e16",
                    border: "1px solid #166534",
                    borderRadius: "8px",
                    padding: "16px",
                    marginTop: "16px",
                    marginBottom: "16px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "10px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#4ade80", fontWeight: 600, fontSize: "0.95rem" }}>
                      <span>✓</span>
                      <span>Task Completed</span>
                    </div>
                    {(selectedTask.result as any)?.patchFile && (
                      <span style={{ fontSize: "0.75rem", color: "#86efac", fontFamily: "monospace" }}>
                        {(selectedTask.result as any).patchFile}
                      </span>
                    )}
                  </div>

                  {(selectedTask.result as any)?.patch && (
                    <DiffViewer
                      filePath={(selectedTask.result as any)?.filePath}
                      patch={(selectedTask.result as any)?.patch}
                    />
                  )}

                  {!(selectedTask.result as any)?.patch && (
                    <pre
                      style={{
                        margin: 0,
                        padding: "10px",
                        backgroundColor: "#022c22",
                        borderRadius: "6px",
                        color: "#86efac",
                        fontSize: "0.8rem",
                        overflowX: "auto",
                      }}
                    >
                      {JSON.stringify(selectedTask.result, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {/* Error Display (if failed) */}
              {selectedTask.status === "failed" && (
                <div
                  style={{
                    backgroundColor: "#450a0a",
                    border: "1px solid #991b1b",
                    borderRadius: "8px",
                    padding: "14px",
                    marginTop: "16px",
                    marginBottom: "16px",
                    color: "#fca5a5",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>✗</span>
                    <span>Task Failed</span>
                  </div>
                  <div style={{ fontSize: "0.85rem", lineHeight: 1.4 }}>
                    {selectedTask.error || "Unknown task error"}
                  </div>
                </div>
              )}

              {/* Event Log Diary Timeline */}
              <div style={{ marginTop: "24px" }}>
                <h3
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    color: "#cbd5e1",
                    marginBottom: "14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span>📜</span>
                  <span>Execution Event Timeline</span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      backgroundColor: "#0f172a",
                      color: "#94a3b8",
                      padding: "1px 8px",
                      borderRadius: "9999px",
                    }}
                  >
                    {taskEvents.length} events
                  </span>
                </h3>

                <Timeline events={taskEvents} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
