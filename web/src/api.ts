import type { Task, TaskDetailResponse } from "./types.js";

const DEFAULT_API_BASE =
  import.meta.env.VITE_API_URL ||
  (window.location.hostname === "localhost" ? "http://localhost:3000" : "");

let slowServerListeners: Array<(isSlow: boolean) => void> = [];

export function subscribeSlowServer(listener: (isSlow: boolean) => void) {
  slowServerListeners.push(listener);
  return () => {
    slowServerListeners = slowServerListeners.filter((l) => l !== listener);
  };
}

function notifySlowServer(isSlow: boolean) {
  for (const listener of slowServerListeners) {
    listener(isSlow);
  }
}

export function getPasscode(): string {
  return (
    localStorage.getItem("anvil_passcode") ||
    import.meta.env.VITE_PASSCODE ||
    ""
  );
}

export function setPasscode(code: string): void {
  localStorage.setItem("anvil_passcode", code.trim());
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const passcode = getPasscode();
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (passcode) {
    headers.set("x-anvil-passcode", passcode);
  }

  const url = `${DEFAULT_API_BASE}${endpoint}`;

  // Start slow server watchdog timer (2.5 seconds)
  let timerFired = false;
  const slowTimer = setTimeout(() => {
    timerFired = true;
    notifySlowServer(true);
  }, 2500);

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });

    clearTimeout(slowTimer);
    if (timerFired) {
      // Server responded after delay
      notifySlowServer(false);
    }

    if (!res.ok) {
      let errorMsg = `Request failed: ${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body.error) {
          errorMsg = body.error;
          if (body.details) {
            errorMsg += ` - ${JSON.stringify(body.details)}`;
          }
        }
      } catch {
        // Use default errorMsg
      }
      throw new Error(errorMsg);
    }

    return (await res.json()) as T;
  } catch (err) {
    clearTimeout(slowTimer);
    throw err;
  }
}

export async function fetchHealth(): Promise<{ status: string; mode?: string; demoMode?: boolean }> {
  return apiRequest<{ status: string; mode?: string; demoMode?: boolean }>("/health");
}

export async function fetchTasks(limit = 50): Promise<Task[]> {
  return apiRequest<Task[]>(`/tasks?limit=${limit}`);
}

export async function fetchTaskDetail(id: string): Promise<TaskDetailResponse> {
  return apiRequest<TaskDetailResponse>(`/tasks/${id}`);
}

export async function createTask(input: { query: string; [key: string]: any }): Promise<Task> {
  return apiRequest<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify({
      type: "code_fix",
      input,
    }),
  });
}

export async function approveTask(id: string): Promise<any> {
  return apiRequest<any>(`/tasks/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function rejectTask(id: string, reason?: string): Promise<any> {
  return apiRequest<any>(`/tasks/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || "rejected by human" }),
  });
}
