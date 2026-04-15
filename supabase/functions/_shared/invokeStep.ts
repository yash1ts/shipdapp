/**
 * Chain to the next Edge Function without awaiting the HTTP response.
 * The next function runs independently; we only log non-2xx or network errors.
 */
export function invokeNextStepNoWait(
  supabaseUrl: string,
  serviceKey: string,
  functionName: string,
  runId: string,
  deploymentId: string,
): void {
  const url = `${supabaseUrl}/functions/v1/${functionName}`;
  void fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ run_id: runId, deployment_id: deploymentId }),
  })
    .then((res) => {
      if (!res.ok) {
        console.error(
          `[invokeStep][${functionName}]`,
          JSON.stringify({ runId, deploymentId, status: res.status }),
        );
      }
    })
    .catch((e) => {
      console.error(
        `[invokeStep][${functionName}]`,
        JSON.stringify({
          runId,
          deploymentId,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    });
}
