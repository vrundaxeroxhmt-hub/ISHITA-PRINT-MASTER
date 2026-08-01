import fs from "node:fs/promises";
import path from "node:path";

const ENGINE_ENABLED = process.env.IM_AI_ENGINE_ENABLED !== "false";
const DEFAULT_ENGINE_URL = "http://127.0.0.1:8010";
const ENGINE_TIMEOUT_MS = Number(process.env.IM_AI_ENGINE_TIMEOUT_MS) || 60000;
const SUPPORTED_RASTER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);
const MIME_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
]);

function failed(reason, status = "failed") {
  return { success: false, status, reason };
}

function isInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function getEngineBaseUrl() {
  const parsed = new URL(process.env.IM_AI_ENGINE_URL || DEFAULT_ENGINE_URL);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("AI Engine URL must use HTTP or HTTPS");
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost" && parsed.hostname !== "::1") {
    throw new Error("AI Engine endpoint must use a loopback host");
  }
  if (parsed.username || parsed.password || (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
    throw new Error("IM_AI_ENGINE_URL must contain only the engine origin");
  }
  return parsed.origin;
}

function resolveSafeOutputUrl(engineBaseUrl, outputUrl) {
  if (typeof outputUrl !== "string" || !outputUrl.startsWith("/api/outputs/") || outputUrl.startsWith("//") || outputUrl.includes("\\")) {
    throw new Error("AI Engine returned an unsafe output URL");
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(outputUrl.split(/[?#]/, 1)[0]);
  } catch {
    throw new Error("AI Engine returned an invalid output URL");
  }
  if (decodedPath.split("/").some((segment) => segment === ".." || segment === ".")) {
    throw new Error("AI Engine output URL contains path traversal");
  }

  const resolved = new URL(outputUrl, `${engineBaseUrl}/`);
  const base = new URL(engineBaseUrl);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith("/api/outputs/")) {
    throw new Error("AI Engine output URL escaped the loopback engine");
  }
  return resolved;
}

async function reserveDerivativePath(sourcePath, extension) {
  const directory = path.dirname(sourcePath);
  const prefix = path.basename(sourcePath, path.extname(sourcePath));
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const discriminator = suffix === 0 ? "" : `_${suffix}`;
    const candidate = path.join(directory, `${prefix}_im_ai_corrected${discriminator}${extension}`);
    try {
      const handle = await fs.open(candidate, "wx");
      return { candidate, handle };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Unable to allocate a unique corrected-image filename");
}

export async function checkAiEngineHealth() {
  if (!ENGINE_ENABLED) return failed("Engine disabled via environment", "skipped");
  try {
    const engineBaseUrl = getEngineBaseUrl();
    const response = await fetch(`${engineBaseUrl}/api/health`, { signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS) });
    if (!response.ok) return failed(`AI Engine health check failed (${response.status})`);
    return { success: true, status: "healthy", health: await response.json() };
  } catch (error) {
    return failed(`AI Engine health check failed: ${error.message}`);
  }
}

export async function processDocumentWithAiEngine(filePath, options = {}) {
  if (!ENGINE_ENABLED) return failed("Engine disabled via environment", "skipped");

  let reserved;
  try {
    const engineBaseUrl = getEngineBaseUrl();
    const originalPath = path.resolve(filePath);
    const storageRoot = path.resolve(options.storageRoot || process.env.PRINTDESK_STORAGE_DIR || path.dirname(originalPath));
    const extension = path.extname(originalPath).toLowerCase();
    if (!SUPPORTED_RASTER_EXTENSIONS.has(extension)) return failed(`Unsupported raster image extension: ${extension || "none"}`, "skipped");
    if (!isInside(storageRoot, originalPath)) return failed("Original image is outside approved WhatsApp storage");

    const originalStat = await fs.stat(originalPath);
    if (!originalStat.isFile() || originalStat.size === 0) return failed("Original image is missing or empty");
    const originalBytes = await fs.readFile(originalPath);

    const form = new FormData();
    form.append("file", new Blob([originalBytes], { type: MIME_TYPES.get(extension) }), path.basename(originalPath));
    const correctionResponse = await fetch(`${engineBaseUrl}/api/document/correct`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    });
    if (!correctionResponse.ok) return failed(`AI Engine correction failed (${correctionResponse.status})`);

    let correction;
    try {
      correction = await correctionResponse.json();
    } catch {
      return failed("AI Engine returned invalid correction JSON");
    }
    if (correction?.status !== "success") return failed("AI Engine did not report correction success");

    const outputUrl = resolveSafeOutputUrl(engineBaseUrl, correction.output_url);
    const downloadResponse = await fetch(outputUrl, { signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS) });
    if (!downloadResponse.ok) return failed(`AI Engine output download failed (${downloadResponse.status})`);
    const correctedBytes = Buffer.from(await downloadResponse.arrayBuffer());
    if (correctedBytes.length === 0) return failed("AI Engine returned an empty corrected image");

    const outputExtension = path.extname(outputUrl.pathname).toLowerCase();
    const derivativeExtension = SUPPORTED_RASTER_EXTENSIONS.has(outputExtension) ? outputExtension : extension;
    reserved = await reserveDerivativePath(originalPath, derivativeExtension);
    if (!isInside(storageRoot, reserved.candidate) || path.resolve(reserved.candidate) === originalPath) {
      await reserved.handle.close();
      await fs.rm(reserved.candidate, { force: true });
      reserved = undefined;
      return failed("Corrected derivative path is outside approved WhatsApp storage");
    }
    await reserved.handle.writeFile(correctedBytes);
    await reserved.handle.close();
    const derivativePath = reserved.candidate;
    reserved = undefined;

    const derivativeStat = await fs.stat(derivativePath);
    if (!derivativeStat.isFile() || derivativeStat.size === 0) {
      await fs.rm(derivativePath, { force: true });
      return failed("Corrected derivative was not saved successfully");
    }

    return {
      success: true,
      status: "document_processed",
      processed_file: derivativePath,
      original_file: originalPath,
      result: correction.result,
    };
  } catch (error) {
    if (reserved) {
      await reserved.handle.close().catch(() => {});
      await fs.rm(reserved.candidate, { force: true }).catch(() => {});
    }
    return failed(`AI Engine processing failed: ${error.message}`);
  }
}
