export function apiEnvReady(): boolean {
  const url = process.env.NEXT_PUBLIC_API_URL;
  return Boolean(url);
}

export const apiClient = {
	invoke: async (functionName: string, options: { body: any }) => {
		const baseUrl = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
		
		let endpoint = `${baseUrl}/api/${functionName}`;
		// Use GET for status if body contains only deployment_id
		let init: RequestInit = {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(options.body)
		};

		if (functionName === "deployments-status" && options.body?.deployment_id) {
			endpoint = `${baseUrl}/api/deployments-status/${options.body.deployment_id}`;
			init = { method: "GET" };
		}

		const resp = await fetch(endpoint, init);
		let data = null;
		try {
			data = await resp.json();
		} catch (e) {
			// ignore JSON error
		}

		if (!resp.ok) {
			return { data: null, error: new Error(data?.error || resp.statusText) };
		}

		return { data, error: null };
	}
};
