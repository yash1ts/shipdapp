import { API_BASE } from "./auth";

export function apiEnvReady(): boolean {
  const url = process.env.NEXT_PUBLIC_API_URL;
  return Boolean(url);
}

type InvokeOptions = {
  body?: any;
  method?: "GET" | "POST";
  // Optional SIWS session token. Routes that require auth must receive this.
  token?: string | null;
};

export const apiClient = {
  invoke: async (functionName: string, options: InvokeOptions = {}) => {
    let endpoint = `${API_BASE}/api/${functionName}`;
    let method = options.method ?? "POST";
    let body: string | undefined = options.body
      ? JSON.stringify(options.body)
      : undefined;

    // Preserve the legacy ergonomics of passing `{body: {deployment_id}}` for status checks.
    if (
      functionName === "deployments-status" &&
      options.body?.deployment_id
    ) {
      endpoint = `${API_BASE}/api/deployments-status/${options.body.deployment_id}`;
      method = "GET";
      body = undefined;
    }

    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;

    const resp = await fetch(endpoint, init);
    let data: any = null;
    try {
      data = await resp.json();
    } catch {
      // non-JSON response (e.g. 204); leave data null
    }

    if (!resp.ok) {
      return {
        data: null,
        error: new Error(data?.error || resp.statusText || "Request failed"),
      };
    }

    return { data, error: null };
  },
};
