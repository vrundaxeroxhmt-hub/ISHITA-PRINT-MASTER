import http from "node:http";

const ENGINE_ENABLED = process.env.IM_AI_ENGINE_ENABLED !== "false";
const DEFAULT_ENGINE_URL = "http://127.0.0.1:5000";
const ENGINE_TIMEOUT_MS = Number(process.env.IM_AI_ENGINE_TIMEOUT_MS) || 10000;

export async function processDocumentWithAiEngine(filePath, options = {}) {
  if (!ENGINE_ENABLED) {
    return { success: false, status: "skipped", reason: "Engine disabled via environment" };
  }

  const rawUrl = process.env.IM_AI_ENGINE_URL || DEFAULT_ENGINE_URL;
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { success: false, status: "failed", reason: "Invalid engine URL configuration" };
  }

  if (parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost") {
    return { success: false, status: "failed", reason: "AI Engine endpoint must use loopback (127.0.0.1)" };
  }

  const payloadString = JSON.stringify({
    file_path: filePath,
    options
  });

  return new Promise((resolve) => {
    const req = http.request(
      `${parsedUrl.origin}/api/v1/process-document`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payloadString),
        },
        timeout: ENGINE_TIMEOUT_MS,
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => { responseBody += chunk; });
        res.on("end", () => {
          try {
            const data = JSON.parse(responseBody);
            resolve({
              success: Boolean(data && data.success),
              status: data?.status || (data?.success ? "completed" : "failed"),
              processed_file: data?.processed_file || undefined,
              error: data?.error || undefined,
              raw: data
            });
          } catch {
            resolve({ success: false, status: "failed", reason: "Invalid JSON response from AI Engine" });
          }
        });
      }
    );

    req.on("error", (err) => {
      resolve({ success: false, status: "failed", reason: `AI Engine connection error: ${err.message}` });
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ success: false, status: "failed", reason: "AI Engine processing timeout" });
    });

    req.write(payloadString);
    req.end();
  });
}
