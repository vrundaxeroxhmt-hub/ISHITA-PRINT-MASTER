import express from "express";
import cors from "cors";
import QRCode from "qrcode";
import pino from "pino";
import fs from "node:fs/promises";
import path from "node:path";
import dns from "node:dns/promises";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import makeWASocket, { Browsers, DisconnectReason, downloadMediaMessage, useMultiFileAuthState } from "@whiskeysockets/baileys";

const appRoot = path.resolve(process.env.PRINTDESK_APP_ROOT || process.cwd());
const dataDir = path.resolve(process.env.PRINTDESK_DATA_DIR || path.join(appRoot, ".whatsapp-data"));
const authDir = path.join(dataDir, "baileys-auth");
const contactsFile = path.join(dataDir, "contacts.json");
const messagesFile = path.join(dataDir, "messages.json");
const metaFile = path.join(dataDir, "meta-config.json");
const jobsFile = path.join(dataDir, "jobs.json");
const storageSettingsFile = path.join(dataDir, "storage-settings.json");
let storageSettings = {};
try { storageSettings = JSON.parse(await fs.readFile(storageSettingsFile, "utf8")); } catch {}
let filesDir = path.resolve(storageSettings.masterFolder || process.env.PRINTDESK_STORAGE_DIR || path.join(dataDir, "files"));
const legacyFilesDir = path.join(dataDir, "files");
const convertScript = path.join(appRoot, "backend", "convert-office.ps1");
const port = Number(process.env.WHATSAPP_GATEWAY_PORT || 3001);
const jobBatchWindowMs = 10 * 60 * 1000;
const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || "warn" });
await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(filesDir, { recursive: true });
if (!storageSettings.masterFolder && process.env.PRINTDESK_STORAGE_DIR) {
  storageSettings = { ...storageSettings, masterFolder: filesDir };
  await fs.writeFile(storageSettingsFile, JSON.stringify(storageSettings, null, 2), "utf8");
}
const execFileAsync = promisify(execFile);

async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { logger.error({ file, error }, "Could not read JSON data file"); return fallback; } }
async function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temporary, file);
}

let contacts = await readJson(contactsFile, {});
let messages = await readJson(messagesFile, {});
let jobs = await readJson(jobsFile, []);
const processingSourceMessages = new Set();

function mergeLegacyEditedJobs() {
  const removeJobIds = new Set();
  for (const editedJob of jobs) {
    for (const editedFile of editedJob.files || []) {
      if (!editedFile.originalFileId) continue;
      const originalJob = jobs.find((job) => job.files?.some((file) => file.id === editedFile.originalFileId && !file.originalFileId));
      if (!originalJob || originalJob.id === editedJob.id) continue;
      originalJob.files = originalJob.files.map((file) => file.id === editedFile.originalFileId ? {
        ...editedFile,
        id: file.id,
        originalFileId: file.id,
        originalFile: file,
        isEdited: true,
      } : file);
      removeJobIds.add(editedJob.id);
    }
  }
  if (removeJobIds.size) {
    jobs = jobs.filter((job) => !removeJobIds.has(job.id));
    void writeJson(jobsFile, jobs);
  }
}
mergeLegacyEditedJobs();
let metaConfig = await readJson(metaFile, {});
let socket;
let reconnectTimer;
let manuallyLoggedOut = false;
let baileys = { state: "disconnected", qr: null, user: null, error: null };
let metaConnection = { state: metaConfig.accessToken && metaConfig.phoneNumberId ? "checking" : "disconnected", error: null };

async function validateMetaConnection() {
  if (!metaConfig.accessToken || !metaConfig.phoneNumberId) {
    metaConnection = { state: "disconnected", error: null };
    return false;
  }
  try {
    metaConnection = { state: "checking", error: null };
    const version = process.env.META_GRAPH_VERSION || "v23.0";
    const response = await fetch(`https://graph.facebook.com/${version}/${metaConfig.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, { headers: { authorization: `Bearer ${metaConfig.accessToken}` }, signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || `Meta API returned ${response.status}`);
    metaConfig = { ...metaConfig, phoneNumber: result.display_phone_number || metaConfig.phoneNumber || "", displayName: result.verified_name || metaConfig.displayName || "Meta Cloud API" };
    await writeJson(metaFile, metaConfig);
    metaConnection = { state: "connected", error: null };
    return true;
  } catch (error) {
    metaConnection = { state: "error", error: error instanceof Error ? error.message : "Meta connection failed" };
    return false;
  }
}

const status = () => ({
  baileys,
  meta: {
    state: metaConnection.state,
    error: metaConnection.error,
    phoneNumber: metaConfig.phoneNumber || "",
    displayName: metaConfig.displayName || "Meta Cloud API",
    webhookPath: "/api/meta/webhook",
  },
});
const jidToNumber = (jid = "") => jid.split("@")[0].split(":")[0];

function unwrapMessage(content) {
  let current = content;
  while (current) {
    if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
    else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
    else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
    else if (current.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
    else break;
  }
  return current || {};
}

function isPrintableBaileysMessage(content) {
  const message = unwrapMessage(content);
  if (message.imageMessage) return true;
  const document = message.documentMessage;
  return Boolean(document && allowedExtensions.has(path.extname(document.fileName || "").toLowerCase()));
}

const officeExtensions = new Set([".doc", ".docx", ".rtf", ".txt", ".odt", ".xls", ".xlsx", ".xlsm", ".csv", ".ods", ".ppt", ".pptx", ".odp"]);
const allowedExtensions = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ...officeExtensions]);
const maxDownloadBytes = 25 * 1024 * 1024;
const safeName = (name = "document") => name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "document";

function isPrivateIp(address) {
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc|fd|fe80)/i.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

async function validateRemoteUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("Unsafe document URL");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error("Private/local document URLs are blocked");
  return url;
}

async function downloadUrl(rawUrl, headers = {}) {
  let url = await validateRemoteUrl(rawUrl);
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(30000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Invalid redirect");
      url = await validateRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > maxDownloadBytes) throw new Error("Document exceeds 25 MB");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxDownloadBytes) throw new Error("Document exceeds 25 MB");
    return { buffer, contentType: response.headers.get("content-type") || "", finalUrl: url };
  }
  throw new Error("Too many redirects");
}

async function addPrintableJob({ contactId, buffer, fileName, mimeType, timestamp = Date.now(), subfolder, originalFileId, sourceMessageId }) {
  if (sourceMessageId && (processingSourceMessages.has(sourceMessageId) || jobs.some((job) => job.files?.some((file) => file.sourceMessageId === sourceMessageId)))) return false;
  if (sourceMessageId) processingSourceMessages.add(sourceMessageId);
  try {
  const originalName = safeName(fileName);
  let extension = path.extname(originalName).toLowerCase();
  if (!extension && mimeType === "application/pdf") extension = ".pdf";
  if (!allowedExtensions.has(extension)) throw new Error(`Unsupported printable file: ${extension || mimeType}`);
  const token = crypto.randomUUID();
  const receivedDate = new Date(timestamp);
  const year = String(receivedDate.getFullYear());
  const month = String(receivedDate.getMonth() + 1).padStart(2, "0");
  const day = String(receivedDate.getDate()).padStart(2, "0");
  const customerNumber = contactId.split(":").slice(1).join(":").replace(/\D/g, "") || "unknown";
  const customerFolder = path.join(filesDir, year, month, day, customerNumber);
  const targetFolder = subfolder ? path.join(customerFolder, safeName(subfolder)) : customerFolder;
  await fs.mkdir(targetFolder, { recursive: true });
  const sourcePath = path.join(targetFolder, `${token}_${originalName}`);
  await fs.writeFile(sourcePath, buffer);
  let outputName = originalName;
  let outputPath = sourcePath;
  let kind = "image";
  if (officeExtensions.has(extension)) {
    outputName = `${path.basename(originalName, extension)}.pdf`;
    outputPath = path.join(targetFolder, `${token}_${path.basename(originalName, extension)}.pdf`);
    await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", convertScript, "-InputPath", sourcePath, "-OutputPath", outputPath], { timeout: 120000, windowsHide: true });
    kind = "pdf";
  } else if (extension === ".pdf") kind = "pdf";
  const relativeFile = path.relative(filesDir, outputPath).split(path.sep).map(encodeURIComponent).join("/");
  const publicFile = `http://127.0.0.1:${port}/api/files/${relativeFile}`;
  const printFile = { id: token, kind, name: outputName, thumbUrl: "", receivedAt: timestamp, status: "in_review", src: publicFile, originalFileId: originalFileId || undefined, sourceMessageId: sourceMessageId || undefined };
  const activeBatch = jobs
    .filter((job) => job.customerId === contactId && job.status === "in_review" && !job.files?.some((file) => file.layoutType))
    .sort((a, b) => b.lastAt - a.lastAt)
    .find((job) => timestamp >= job.lastAt && timestamp - job.lastAt <= jobBatchWindowMs);
  if (activeBatch) {
    activeBatch.files.push(printFile);
    activeBatch.lastAt = timestamp;
  } else {
    jobs.unshift({ id: `job_${token}`, customerId: contactId, receivedAt: timestamp, lastAt: timestamp, files: [printFile], status: "in_review" });
  }
  jobs = jobs.slice(0, 1000);
  await writeJson(jobsFile, jobs);
  return true;
  } finally {
    if (sourceMessageId) processingSourceMessages.delete(sourceMessageId);
  }
}

function extractDocumentLinks(text = "") {
  return [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((match) => match[0].replace(/[),.;]+$/, "")).filter((url) => allowedExtensions.has(path.extname(new URL(url).pathname).toLowerCase()));
}

async function processDocumentLinks(contactId, text, timestamp) {
  for (const link of extractDocumentLinks(text)) {
    try {
      const { buffer, contentType, finalUrl } = await downloadUrl(link);
      const fileName = decodeURIComponent(path.basename(finalUrl.pathname)) || "document";
      await addPrintableJob({ contactId, buffer, fileName, mimeType: contentType, timestamp });
    } catch (error) { logger.warn({ error, link }, "document link processing failed"); }
  }
}

async function upsertContact({ id, name, avatarUrl, source, timestamp = Date.now() }) {
  if (!id) return;
  const key = `${source}:${id}`;
  contacts[key] = {
    id: key,
    name: name || contacts[key]?.name || `+${id}`,
    mobile: id.startsWith("+") ? id : `+${id}`,
    avatarUrl: avatarUrl || contacts[key]?.avatarUrl,
    source,
    lastMessageAt: timestamp,
    unread: (contacts[key]?.unread || 0) + 1,
    avatarHue: [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360,
  };
  await writeJson(contactsFile, contacts);
}

async function addMessage(contactId, text, direction, timestamp = Date.now()) {
  if (!contactId || !text) return;
  messages[contactId] = [...(messages[contactId] || []), { id: `${timestamp}-${Math.random().toString(36).slice(2)}`, text, direction, timestamp }].slice(-200);
  await writeJson(messagesFile, messages);
}

function baileysText(content) {
  const message = unwrapMessage(content);
  return message.conversation || message.extendedTextMessage?.text || message.imageMessage?.caption || message.documentMessage?.caption || "";
}

async function startBaileys(force = false) {
  if (!force && ["connecting", "connected", "qr"].includes(baileys.state)) return;
  clearTimeout(reconnectTimer);
  manuallyLoggedOut = false;
  baileys = { ...baileys, state: "connecting", qr: null, error: null };
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  socket = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.windows("PrintDesk"),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    getMessage: async () => undefined,
  });
  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) baileys = { ...baileys, state: "qr", qr: await QRCode.toDataURL(qr), error: null };
    if (connection === "open") {
      const id = jidToNumber(socket.user?.id);
      let avatarUrl;
      try { avatarUrl = await socket.profilePictureUrl(socket.user.id, "image"); } catch {}
      baileys = { state: "connected", qr: null, error: null, user: { name: socket.user?.name || "WhatsApp", number: id ? `+${id}` : "", avatarUrl } };
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      baileys = { ...baileys, state: loggedOut ? "logged_out" : "disconnected", qr: null, error: lastDisconnect?.error?.message || null };
      if (!loggedOut && !manuallyLoggedOut) reconnectTimer = setTimeout(() => startBaileys(true), 3000);
    }
  });
  socket.ev.on("messages.upsert", async ({ messages }) => {
    for (const message of messages) {
      const primaryJid = message.key.remoteJid;
      const alternateJid = message.key.remoteJidAlt;
      if (!primaryJid || message.key.fromMe || (!primaryJid.endsWith("@s.whatsapp.net") && !primaryJid.endsWith("@lid"))) continue;
      const phoneJid = [primaryJid, alternateJid].find((jid) => jid?.endsWith("@s.whatsapp.net"));
      const number = jidToNumber(phoneJid || primaryJid);
      const contactId = `baileys:${number}`;
      const text = baileysText(message.message);
      const documentLinks = extractDocumentLinks(text);
      const timestamp = Number(message.messageTimestamp || Date.now() / 1000) * 1000;
      if (text) {
        await addMessage(contactId, text, "incoming", timestamp);
        void processDocumentLinks(contactId, text, timestamp);
      }
      const isPrintable = isPrintableBaileysMessage(message.message);
      if (!text && !isPrintable && documentLinks.length === 0) continue;
      // Make the new customer visible immediately. Profile-picture lookup is a
      // network request and can take several seconds (or time out entirely).
      await upsertContact({ id: number, name: message.pushName, source: "baileys", timestamp });
      void socket.profilePictureUrl(phoneJid || primaryJid, "preview").then(async (avatarUrl) => {
        const contact = contacts[contactId];
        if (!contact || !avatarUrl || contact.avatarUrl === avatarUrl) return;
        contact.avatarUrl = avatarUrl;
        await writeJson(contactsFile, contacts);
      }).catch(() => {});
      if (!isPrintable) continue;
      try {
        const content = unwrapMessage(message.message);
        const media = content.imageMessage || content.documentMessage;
        if (media) {
          const buffer = await downloadMediaMessage(message, "buffer", {}, { logger, reuploadRequest: socket.updateMediaMessage });
          const extension = content.imageMessage ? `.${(media.mimetype || "image/jpeg").split("/")[1].replace("jpeg", "jpg")}` : path.extname(media.fileName || "") || ".pdf";
          await addPrintableJob({ contactId, buffer, fileName: media.fileName || `WhatsApp_${Date.now()}${extension}`, mimeType: media.mimetype || "", timestamp, sourceMessageId: `baileys:${message.key.id}` });
        }
      } catch (error) { logger.warn({ error }, "Baileys printable media processing failed"); }
    }
  });
}

const app = express();
app.use(cors({ origin: [/^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/localhost:\d+$/] }));
app.use(express.json({ limit: "50mb" }));
app.use((req, res, next) => {
  const forwarded = req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"];
  if (forwarded && !["/api/meta/webhook", "/webhook/meta"].includes(req.path)) return res.sendStatus(404);
  next();
});
app.get("/api/status", (_req, res) => res.json(status()));
app.get("/api/contacts", (_req, res) => res.json(Object.values(contacts).sort((a, b) => b.lastMessageAt - a.lastMessageAt)));
app.post("/api/contacts/:contactId/read", async (req, res) => {
  const contact = contacts[req.params.contactId];
  if (!contact) return res.sendStatus(404);
  contact.unread = 0;
  await writeJson(contactsFile, contacts);
  res.json(contact);
});
const localFileStaticOptions = (fallthrough) => ({
  fallthrough,
  etag: false,
  maxAge: 0,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-store"),
});
app.use("/api/files", (req, res, next) => express.static(filesDir, localFileStaticOptions(true))(req, res, next));
app.use("/api/files", express.static(legacyFilesDir, localFileStaticOptions(false)));

app.get("/api/settings/storage", (_req, res) => res.json({ masterFolder: filesDir }));
app.post("/api/settings/storage/pick", async (_req, res, next) => {
  try {
    const script = "$shell=New-Object -ComObject Shell.Application;$folder=$shell.BrowseForFolder(0,'Select PrintDesk Master Save Folder',0,0);if($folder){$folder.Self.Path}";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { windowsHide: false });
    const selected = stdout.trim();
    if (!selected) return res.json({ cancelled: true, masterFolder: filesDir });
    const resolved = path.resolve(selected);
    await fs.mkdir(resolved, { recursive: true });
    filesDir = resolved;
    storageSettings = { ...storageSettings, masterFolder: resolved };
    await fs.writeFile(storageSettingsFile, JSON.stringify(storageSettings, null, 2), "utf8");
    res.json({ ok: true, masterFolder: filesDir });
  } catch (error) { next(error); }
});

app.post("/api/jobs/manual-upload", async (req, res, next) => {
  try {
    const { contactId, fileName, mimeType, dataUrl } = req.body || {};
    if (!contactId || !fileName || !dataUrl) return res.status(400).json({ error: "contactId, fileName and data are required." });
    const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return res.status(400).json({ error: "Invalid uploaded file." });
    const type = mimeType || match[1];
    if (!(type.startsWith("image/") || type === "application/pdf")) return res.status(400).json({ error: "Only images and PDF files are supported." });
    const now = new Date(), year=String(now.getFullYear()), month=String(now.getMonth()+1).padStart(2,"0"), day=String(now.getDate()).padStart(2,"0");
    const number=contactId.split(":").slice(1).join(":").replace(/\D/g,"")||"unknown";
    const folder=path.join(filesDir,year,month,day,number); await fs.mkdir(folder,{recursive:true});
    const fileId=crypto.randomUUID(), safeFile=safeName(fileName), outputPath=path.join(folder,`${fileId}_${safeFile}`);
    await fs.writeFile(outputPath,Buffer.from(match[2],"base64"));
    const relative=path.relative(filesDir,outputPath).split(path.sep).map(encodeURIComponent).join("/");
    const file={id:fileId,kind:type === "application/pdf" ? "pdf" : "image",name:fileName,thumbUrl:"",receivedAt:Date.now(),status:"in_review",src:`http://127.0.0.1:${port}/api/files/${relative}`};
    const job={id:`job_manual_${fileId}`,customerId:contactId,receivedAt:Date.now(),lastAt:Date.now(),files:[file],status:"in_review"}; jobs.unshift(job);
    await writeJson(jobsFile,jobs); res.json({ok:true,file,jobs});
  } catch(error){next(error);}
});
app.get("/api/jobs", (_req, res) => res.json(jobs));
app.post("/api/jobs/:jobId/status", async (req, res, next) => {
  try {
    const allowed = new Set(["in_review", "in_process", "print_ready", "printed"]);
    const status = String(req.body?.status || "");
    if (!allowed.has(status)) return res.status(400).json({ error: "Invalid job status." });
    const job = jobs.find((item) => item.id === req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job was not found." });
    job.status = status;
    job.files = (job.files || []).map((file) => ({ ...file, status }));
    await writeJson(jobsFile, jobs);
    res.json({ ok: true, job, jobs });
  } catch (error) { next(error); }
});
app.post("/api/jobs/files/:fileId/status", async (req, res, next) => {
  try {
    const allowed = new Set(["in_review", "in_process", "print_ready", "printed"]);
    const status = String(req.body?.status || "");
    if (!allowed.has(status)) return res.status(400).json({ error: "Invalid job status." });
    const job = jobs.find((item) => item.files?.some((file) => file.id === req.params.fileId));
    if (!job) return res.status(404).json({ error: "Job file was not found." });
    job.status = status;
    job.files = job.files.map((file) => ({ ...file, status }));
    await writeJson(jobsFile, jobs);
    res.json({ ok: true, job, jobs });
  } catch (error) { next(error); }
});
app.post("/api/jobs/working-preview", async (req, res, next) => {
  try {
    const { contactId, fileId, dataUrl, edit, appliedCropDataUrl } = req.body || {};
    if (!contactId || !fileId || !dataUrl || !edit) return res.status(400).json({ error: "contactId, fileId, dataUrl and edit are required." });
    const match = String(dataUrl).match(/^data:image\/jpeg;base64,(.+)$/s);
    if (!match) return res.status(400).json({ error: "Invalid working preview image." });
    const job = jobs.find((item) => item.customerId === contactId && item.files?.some((file) => file.id === fileId));
    const file = job?.files.find((item) => item.id === fileId);
    if (!job || !file) return res.status(404).json({ error: "Job file was not found." });
    const baseFile = file.originalFile || file;
    const receivedDate = new Date(baseFile.receivedAt || job.receivedAt || Date.now());
    const year = String(receivedDate.getFullYear()), month = String(receivedDate.getMonth() + 1).padStart(2, "0"), day = String(receivedDate.getDate()).padStart(2, "0");
    const number = contactId.split(":").slice(1).join(":").replace(/\D/g, "") || "unknown";
    const workingDir = path.join(filesDir, year, month, day, number, "Working"); await fs.mkdir(workingDir, { recursive: true });
    const outputPath = path.join(workingDir, `${baseFile.id}_working.jpg`); await fs.writeFile(outputPath, Buffer.from(match[1], "base64"));
    const relativeFile = path.relative(filesDir, outputPath).split(path.sep).map(encodeURIComponent).join("/");
    file.workingSrc = `http://127.0.0.1:${port}/api/files/${relativeFile}?v=${Date.now()}`;
    file.workingEdit = edit;
    if (appliedCropDataUrl) {
      const cropMatch = String(appliedCropDataUrl).match(/^data:image\/jpeg;base64,(.+)$/s);
      if (!cropMatch) return res.status(400).json({ error: "Invalid applied crop image." });
      const cropPath = path.join(workingDir, `${baseFile.id}_applied_crop.jpg`);
      await fs.writeFile(cropPath, Buffer.from(cropMatch[1], "base64"));
      const relativeCrop = path.relative(filesDir, cropPath).split(path.sep).map(encodeURIComponent).join("/");
      file.appliedCropSrc = `http://127.0.0.1:${port}/api/files/${relativeCrop}?v=${Date.now()}`;
    }
    await writeJson(jobsFile, jobs);
    res.json({ ok: true, file, jobs });
  } catch (error) { next(error); }
});
app.post("/api/jobs/processed", async (req, res, next) => {
  try {
    const { contactId, fileName, mimeType, dataUrl, originalFileId } = req.body || {};
    if (!contactId || !fileName || !dataUrl) return res.status(400).json({ error: "contactId, fileName and dataUrl are required." });
    const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return res.status(400).json({ error: "Invalid processed file data." });
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 40 * 1024 * 1024) return res.status(413).json({ error: "Processed file exceeds 40 MB." });
    const sourceJob = jobs.find((job) => job.customerId === contactId && job.files?.some((file) => file.id === originalFileId || file.originalFileId === originalFileId));
    if (!sourceJob) return res.status(404).json({ error: "Original job file was not found." });
    const currentFile = sourceJob.files.find((file) => file.id === originalFileId || file.originalFileId === originalFileId);
    const originalFile = { ...(currentFile.originalFile || currentFile) };
    delete originalFile.workingSrc;
    delete originalFile.workingEdit;
    delete originalFile.livePreview;
    const receivedDate = new Date(originalFile.receivedAt || sourceJob.receivedAt || Date.now());
    const year = String(receivedDate.getFullYear());
    const month = String(receivedDate.getMonth() + 1).padStart(2, "0");
    const day = String(receivedDate.getDate()).padStart(2, "0");
    const number = contactId.split(":").slice(1).join(":").replace(/\D/g, "") || "unknown";
    const editedDir = path.join(filesDir, year, month, day, number, "Edited");
    await fs.mkdir(editedDir, { recursive: true });
    const extension = path.extname(fileName).toLowerCase() || (match[1] === "application/pdf" ? ".pdf" : ".jpg");
    const editedName = `${originalFile.id}_edited${extension}`;
    const editedPath = path.join(editedDir, editedName);
    await fs.writeFile(editedPath, buffer);
    if (currentFile.workingSrc) {
      const workingPath = await storedPathFromUrl(currentFile.workingSrc);
      if (workingPath) await fs.rm(workingPath, { force: true }).catch(() => {});
    }
    const relativeFile = path.relative(filesDir, editedPath).split(path.sep).map(encodeURIComponent).join("/");
    const editedFile = {
      ...originalFile,
      id: originalFile.id,
      name: fileName,
      kind: match[1] === "application/pdf" || extension === ".pdf" ? "pdf" : "image",
      src: `http://127.0.0.1:${port}/api/files/${relativeFile}?v=${Date.now()}`,
      thumbUrl: "",
      livePreview: undefined,
      workingSrc: undefined,
      workingEdit: undefined,
      originalFileId: originalFile.id,
      originalFile,
      isEdited: true,
      receivedAt: Date.now(),
    };
    sourceJob.files = sourceJob.files.map((file) => file === currentFile ? editedFile : file);
    sourceJob.lastAt = Date.now();
    sourceJob.status = "print_ready";
    sourceJob.files = sourceJob.files.map((file) => ({ ...file, status: "print_ready" }));
    await writeJson(jobsFile, jobs);
    res.json({ ok: true, jobs });
  } catch (error) { next(error); }
});
app.post("/api/jobs/aadhaar-layout", async (req, res, next) => {
  try {
    const { contactId, dataUrl, layout } = req.body || {};
    if (!contactId || !dataUrl || !layout) return res.status(400).json({ error: "contactId, dataUrl and layout are required." });
    const match = String(dataUrl).match(/^data:image\/png;base64,(.+)$/s);
    if (!match) return res.status(400).json({ error: "Invalid Aadhaar layout image." });
    const buffer = Buffer.from(match[1], "base64");
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const number = contactId.split(":").slice(1).join(":").replace(/\D/g, "") || "unknown";
    const folder = path.join(filesDir, year, month, day, number, "Aadhaar");
    await fs.mkdir(folder, { recursive: true });
    const fileId = `aadhaar_${contactId.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const outputPath = path.join(folder, `${fileId}_130.png`);
    await fs.writeFile(outputPath, buffer);
    const relativeFile = path.relative(filesDir, outputPath).split(path.sep).map(encodeURIComponent).join("/");
    const savedFile = {
      id: fileId,
      kind: "image",
      name: "Aadhaar_130_Layout.png",
      thumbUrl: "",
      receivedAt: Date.now(),
      status: "print_ready",
      src: `http://127.0.0.1:${port}/api/files/${relativeFile}?v=${Date.now()}`,
      layoutType: "aadhaar130",
      aadhaarLayout: layout,
    };
    let layoutJob = jobs.find((job) => job.customerId === contactId && job.files?.some((file) => file.layoutType === "aadhaar130"));
    if (layoutJob) {
      layoutJob.files = [savedFile];
      layoutJob.lastAt = Date.now();
      layoutJob.status = "print_ready";
    } else {
      layoutJob = { id: `job_${fileId}`, customerId: contactId, receivedAt: Date.now(), lastAt: Date.now(), files: [savedFile], status: "print_ready" };
      jobs.unshift(layoutJob);
    }
    await writeJson(jobsFile, jobs);
    res.json({ ok: true, file: savedFile, jobs });
  } catch (error) { next(error); }
});
app.post("/api/jobs/multi-layout", async (req, res, next) => {
  try {
    const { contactId, pages, layout } = req.body || {};
    if (!contactId || !Array.isArray(pages) || !pages.length || !layout) return res.status(400).json({ error: "contactId, pages and layout are required." });
    const now = new Date(), year = String(now.getFullYear()), month = String(now.getMonth() + 1).padStart(2, "0"), day = String(now.getDate()).padStart(2, "0");
    const number = contactId.split(":").slice(1).join(":").replace(/\D/g, "") || "unknown";
    const folder = path.join(filesDir, year, month, day, number, "MultiLayout"); await fs.mkdir(folder, { recursive: true });
    const layoutId = `multi_${contactId.replace(/[^a-zA-Z0-9]/g, "_")}`; const savedFiles = [];
    for (let index = 0; index < pages.length; index++) {
      const match = String(pages[index]).match(/^data:image\/(?:jpeg|jpg);base64,(.+)$/s); if (!match) throw new Error(`Invalid generated page ${index + 1}.`);
      const fileId = `${layoutId}_${index + 1}`, outputPath = path.join(folder, `${fileId}.jpg`); await fs.writeFile(outputPath, Buffer.from(match[1], "base64"));
      const relativeFile = path.relative(filesDir, outputPath).split(path.sep).map(encodeURIComponent).join("/");
      savedFiles.push({ id: fileId, kind: "image", name: `Multi_Layout_Page_${index + 1}.jpg`, thumbUrl: "", receivedAt: Date.now(), status: "print_ready", src: `http://127.0.0.1:${port}/api/files/${relativeFile}?v=${Date.now()}`, layoutType: "multiPage", multiLayout: layout });
    }
    let layoutJob = jobs.find((job) => job.customerId === contactId && job.files?.some((file) => file.layoutType === "multiPage"));
    if (layoutJob) { layoutJob.files = savedFiles; layoutJob.lastAt = Date.now(); layoutJob.status = "print_ready"; }
    else { layoutJob = { id: `job_${layoutId}`, customerId: contactId, receivedAt: Date.now(), lastAt: Date.now(), files: savedFiles, status: "print_ready" }; jobs.unshift(layoutJob); }
    await writeJson(jobsFile, jobs); res.json({ ok: true, files: savedFiles, jobs });
  } catch (error) { next(error); }
});
app.post("/api/jobs/passport-layout", async (req, res, next) => {
  try {
    const { contactId, page, layout, singles = [] } = req.body || {};
    if (!contactId || !page || !layout) return res.status(400).json({ error: "contactId, page and layout are required." });
    const match = String(page).match(/^data:image\/jpeg;base64,(.+)$/s); if (!match) return res.status(400).json({ error: "Invalid passport sheet image." });
    const now = new Date(), year = String(now.getFullYear()), month = String(now.getMonth() + 1).padStart(2, "0"), day = String(now.getDate()).padStart(2, "0");
    const number = contactId.split(":").slice(1).join(":").replace(/\D/g, "") || "unknown"; const folder = path.join(filesDir, year, month, day, number, "Passport"); await fs.mkdir(folder, { recursive: true });
    const fileId = `passport_${contactId.replace(/[^a-zA-Z0-9]/g, "_")}`, outputPath = path.join(folder, `${fileId}_${layout.preset}.jpg`); await fs.writeFile(outputPath, Buffer.from(match[1], "base64"));
    const relativeFile = path.relative(filesDir, outputPath).split(path.sep).map(encodeURIComponent).join("/");
    const storedLayout = { ...layout, configs: Object.fromEntries(Object.entries(layout.configs || {}).map(([id, config]) => { const { removedSrc, croppedSrc, ...rest } = config; return [id, rest]; })) };
    const savedFile = { id: fileId, kind: "image", name: `Passport_${layout.preset}.jpg`, thumbUrl: "", receivedAt: Date.now(), status: "print_ready", src: `http://127.0.0.1:${port}/api/files/${relativeFile}?v=${Date.now()}`, layoutType: "passport", passportLayout: storedLayout };
    const savedFiles = [savedFile];
    for (let index = 0; index < singles.length; index++) {
      const singleMatch = String(singles[index]?.dataUrl || "").match(/^data:image\/jpeg;base64,(.+)$/s); if (!singleMatch) continue;
      const singleId = `${fileId}_single_${index + 1}`, singlePath = path.join(folder, `${singleId}.jpg`); await fs.writeFile(singlePath, Buffer.from(singleMatch[1], "base64"));
      const singleRelative = path.relative(filesDir, singlePath).split(path.sep).map(encodeURIComponent).join("/"); savedFiles.push({ id: singleId, kind: "image", name: `Prepared_Passport_${index + 1}.jpg`, thumbUrl: "", receivedAt: Date.now(), status: "print_ready", src: `http://127.0.0.1:${port}/api/files/${singleRelative}?v=${Date.now()}`, passportPrepared: true });
    }
    let layoutJob = jobs.find((job) => job.customerId === contactId && job.files?.some((file) => file.layoutType === "passport"));
    if (layoutJob) { layoutJob.files = savedFiles; layoutJob.lastAt = Date.now(); layoutJob.status = "print_ready"; }
    else { layoutJob = { id: `job_${fileId}`, customerId: contactId, receivedAt: Date.now(), lastAt: Date.now(), files: savedFiles, status: "print_ready" }; jobs.unshift(layoutJob); }
    await writeJson(jobsFile, jobs); res.json({ ok: true, file: savedFile, jobs });
  } catch (error) { next(error); }
});
async function storedPathFromUrl(src) {
  try {
    const encoded = new URL(src).pathname.split("/api/files/")[1];
    if (!encoded) return null;
    const relative = encoded.split("/").map(decodeURIComponent).join(path.sep);
    for (const rootDir of [filesDir, legacyFilesDir]) {
      const candidate = path.resolve(rootDir, relative);
      if (candidate.startsWith(rootDir + path.sep)) {
        try { await fs.access(candidate); return candidate; } catch {}
      }
    }
  } catch {}
  return null;
}
app.post("/api/jobs/files/:fileId/open-default", async (req, res, next) => {
  try {
    const file = jobs.flatMap((job) => job.files || []).find((item) => item.id === req.params.fileId);
    if (!file?.src) return res.status(404).json({ error: "File was not found." });
    const localPath = await storedPathFromUrl(file.src);
    if (!localPath) return res.status(404).json({ error: "Local file was not found." });
    await fs.access(localPath);
    const script = "param([string]$p);$info=New-Object System.Diagnostics.ProcessStartInfo;$info.FileName=$p;$info.UseShellExecute=$true;[System.Diagnostics.Process]::Start($info)|Out-Null";
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script, localPath], { windowsHide: true });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.post("/api/batches", async (req, res, next) => {
  try {
    const { contactId, mode, combinedPdf, liveFiles = [], fileIds = [] } = req.body || {};
    if (!contactId || !["separate", "combined", "both"].includes(mode)) return res.status(400).json({ error: "Valid contactId and batch mode are required." });
    const customerJobs = jobs.filter((job) => job.customerId === contactId);
    const requestedIds = new Set(fileIds);
    const files = customerJobs.flatMap((job) => job.files || []).filter((file) => !requestedIds.size || requestedIds.has(file.id));
    if (!files.length) return res.status(400).json({ error: "No files are available for this batch." });
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((value) => String(value).padStart(2, "0")).join("-");
    const number = contactId.split(":").slice(1).join(":").replace(/\D/g, "") || "unknown";
    const batchDir = path.join(filesDir, year, month, day, number, `Batch_${time}`);
    await fs.mkdir(batchDir, { recursive: true });
    if (mode === "separate" || mode === "both") {
      const originalDir = path.join(batchDir, "Original");
      const editedDir = path.join(batchDir, "Edited");
      await Promise.all([fs.mkdir(originalDir, { recursive: true }), fs.mkdir(editedDir, { recursive: true })]);
      const liveMap = new Map(liveFiles.map((item) => [item.id, item.dataUrl]));
      for (const file of files) {
        const original = file.originalFile || file;
        const originalPath = await storedPathFromUrl(original.src);
        if (originalPath) await fs.copyFile(originalPath, path.join(originalDir, `${original.id}_${safeName(original.name)}`)).catch(() => {});
        const live = liveMap.get(file.id);
        if (live) {
          const match = String(live).match(/^data:([^;]+);base64,(.+)$/s);
          if (match) await fs.writeFile(path.join(editedDir, `${file.id}_edited.jpg`), Buffer.from(match[2], "base64"));
        } else {
          const currentPath = await storedPathFromUrl(file.src);
          if (currentPath) await fs.copyFile(currentPath, path.join(editedDir, `${file.id}_${safeName(file.name)}`)).catch(() => {});
        }
      }
    }
    if (mode === "combined" || mode === "both") {
      const match = String(combinedPdf || "").match(/^data:application\/pdf;base64,(.+)$/s);
      if (!match) return res.status(400).json({ error: "Combined printable PDF is required." });
      await fs.writeFile(path.join(batchDir, "Batch_Printable.pdf"), Buffer.from(match[1], "base64"));
    }
    res.json({ ok: true, folder: batchDir });
  } catch (error) { next(error); }
});
app.post("/api/jobs/files/:fileId/unbind-layout", async (req, res, next) => {
  try {
    const layoutJob = jobs.find((job) => job.files?.some((file) => file.id === req.params.fileId && (["multiPage", "aadhaar130"].includes(file.layoutType) || /^Unbound_(?:Multi|Aadhaar)/.test(file.name || ""))));
    if (!layoutJob) return res.status(404).json({ error: "Generated layout was not found." });
    const sourceIds = new Set(layoutJob.files.flatMap((file) => file.multiLayout?.sourceFileIds || file.aadhaarLayout?.slots?.map((slot) => slot.imageId).filter(Boolean) || []));
    for (const file of layoutJob.files) {
      const target = await storedPathFromUrl(file.src);
      if (target) await fs.rm(target, { force: true }).catch(() => {});
      const working = await storedPathFromUrl(file.workingSrc);
      if (working) await fs.rm(working, { force: true }).catch(() => {});
    }
    jobs = jobs.filter((job) => job !== layoutJob);
    for (const sourceJob of jobs) {
      if (!sourceIds.size || sourceJob.files?.some((file) => sourceIds.has(file.id))) {
        sourceJob.files = sourceJob.files.map((file) => sourceIds.has(file.id) ? { ...file, status: "in_review" } : file);
        if (sourceJob.files?.some((file) => sourceIds.has(file.id))) sourceJob.status = "in_review";
      }
    }
    await writeJson(jobsFile, jobs);
    res.json({ ok: true, jobs });
  } catch (error) { next(error); }
});

app.post("/api/jobs/files/:fileId/reset", async (req, res, next) => {
  try {
    const multiJob = jobs.find((item) => item.files?.some((file) => file.id === req.params.fileId && (file.layoutType === "multiPage" || file.layoutType === "passport")));
    if (multiJob) {
      const sourceIds = new Set(multiJob.files.flatMap((file) => file.multiLayout?.sourceFileIds || file.passportLayout?.sourceFileIds || []));
      for (const file of multiJob.files) {
        const target = await storedPathFromUrl(file.src);
        if (target) await fs.rm(target, { force: true }).catch(() => {});
      }
      jobs = jobs.filter((item) => item !== multiJob);
      for (const sourceJob of jobs) {
        if (sourceJob.files?.some((file) => sourceIds.has(file.id))) {
          sourceJob.status = "in_review";
          sourceJob.files = sourceJob.files.map((file) => ({ ...file, status: "in_review" }));
        }
      }
      await writeJson(jobsFile, jobs);
      return res.json({ ok: true, jobs });
    }
    const workingJob = jobs.find((item) => item.files?.some((file) => file.id === req.params.fileId && file.workingSrc));
    const workingFile = workingJob?.files.find((file) => file.id === req.params.fileId && file.workingSrc);
    if (workingFile) {
      const workingPath = await storedPathFromUrl(workingFile.workingSrc);
      if (workingPath) await fs.rm(workingPath, { force: true }).catch(() => {});
      const appliedCropPath = await storedPathFromUrl(workingFile.appliedCropSrc);
      if (appliedCropPath) await fs.rm(appliedCropPath, { force: true }).catch(() => {});
      delete workingFile.workingSrc;
      delete workingFile.workingEdit;
      delete workingFile.appliedCropSrc;
      if (!workingFile.isEdited) {
        workingJob.status = "in_review";
        workingJob.files = workingJob.files.map((file) => ({ ...file, status: "in_review" }));
        await writeJson(jobsFile, jobs);
        return res.json({ ok: true, jobs });
      }
    }
    const job = jobs.find((item) => item.files?.some((file) => file.id === req.params.fileId && file.isEdited));
    const edited = job?.files.find((file) => file.id === req.params.fileId && file.isEdited);
    if (!job || !edited?.originalFile) return res.status(404).json({ error: "Edited file was not found." });
    try {
      const urlPath = new URL(edited.src).pathname.split("/api/files/")[1];
      const relative = urlPath.split("/").map(decodeURIComponent).join(path.sep);
      const target = path.resolve(filesDir, relative);
      if (target.startsWith(filesDir + path.sep)) await fs.rm(target, { force: true });
    } catch {}
    job.files = job.files.map((file) => file === edited ? edited.originalFile : file);
    job.status = "in_review";
    job.files = job.files.map((file) => ({ ...file, status: "in_review" }));
    await writeJson(jobsFile, jobs);
    res.json({ ok: true, jobs });
  } catch (error) { next(error); }
});
app.delete("/api/jobs/:jobId", async (req, res) => { jobs = jobs.filter((job) => job.id !== req.params.jobId); await writeJson(jobsFile, jobs); res.sendStatus(204); });
app.delete("/api/jobs/files/:fileId", async (req, res, next) => {
  try {
    const job = jobs.find((item) => item.files?.some((file) => file.id === req.params.fileId));
    const file = job?.files.find((item) => item.id === req.params.fileId);
    if (!job || !file) return res.status(404).json({ error: "Job file was not found." });
    const paths = new Set();
    for (const candidate of [file.src, file.workingSrc, file.appliedCropSrc, file.originalFile?.src, file.originalFile?.workingSrc, file.originalFile?.appliedCropSrc]) {
      const stored = await storedPathFromUrl(candidate);
      if (stored) paths.add(stored);
    }
    for (const stored of paths) await fs.rm(stored, { force: true }).catch(() => {});
    job.files = job.files.filter((item) => item.id !== req.params.fileId);
    if (!job.files.length) jobs = jobs.filter((item) => item !== job);
    else {
      job.receivedAt = Math.min(...job.files.map((item) => item.receivedAt || job.receivedAt));
      job.lastAt = Math.max(...job.files.map((item) => item.receivedAt || job.lastAt));
    }
    await writeJson(jobsFile, jobs);
    res.json({ ok: true, jobs, removedJob: !job.files.length });
  } catch (error) { next(error); }
});
app.post("/api/data/reset", async (_req, res, next) => {
  try {
    contacts = {};
    messages = {};
    jobs = [];
    await Promise.all([writeJson(contactsFile, contacts), writeJson(messagesFile, messages), writeJson(jobsFile, jobs), fs.rm(filesDir, { recursive: true, force: true })]);
    await fs.mkdir(filesDir, { recursive: true });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.get("/api/messages/:contactId", (req, res) => res.json(messages[req.params.contactId] || []));
app.post("/api/messages/:contactId", async (req, res, next) => {
  try {
    const contactId = req.params.contactId;
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Message is required." });
    const [source, ...numberParts] = contactId.split(":");
    const number = numberParts.join(":").replace(/\D/g, "");
    if (source === "baileys") {
      if (baileys.state !== "connected" || !socket) return res.status(409).json({ error: "Baileys WhatsApp is not connected." });
      await socket.sendMessage(`${number}@s.whatsapp.net`, { text });
    } else if (source === "meta") {
      if (!metaConfig.accessToken || !metaConfig.phoneNumberId) return res.status(409).json({ error: "Meta Cloud API is not configured." });
      const version = process.env.META_GRAPH_VERSION || "v23.0";
      const response = await fetch(`https://graph.facebook.com/${version}/${metaConfig.phoneNumberId}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${metaConfig.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: number, type: "text", text: { preview_url: false, body: text } }),
      });
      if (!response.ok) { const detail = await response.text(); throw new Error(`Meta send failed: ${detail}`); }
    } else return res.status(400).json({ error: "Unknown WhatsApp source." });
    await addMessage(contactId, text, "outgoing");
    res.json(messages[contactId]);
  } catch (error) { next(error); }
});
app.post("/api/baileys/connect", async (_req, res, next) => { try { await startBaileys(true); res.json(status()); } catch (error) { next(error); } });
app.post("/api/baileys/reconnect", async (_req, res, next) => { try { socket?.end?.(undefined); await startBaileys(true); res.json(status()); } catch (error) { next(error); } });
app.post("/api/baileys/logout", async (_req, res, next) => {
  try {
    manuallyLoggedOut = true;
    clearTimeout(reconnectTimer);
    await socket?.logout?.().catch(() => {});
    socket = undefined;
    await fs.rm(authDir, { recursive: true, force: true });
    baileys = { state: "disconnected", qr: null, user: null, error: null };
    res.json(status());
  } catch (error) { next(error); }
});
app.post("/api/meta/config", async (req, res) => {
  const { accessToken, phoneNumberId, phoneNumber, displayName, verifyToken } = req.body || {};
  if (!accessToken || !phoneNumberId || !verifyToken) return res.status(400).json({ error: "Access token, Phone Number ID and Verify Token are required." });
  metaConfig = { accessToken, phoneNumberId, phoneNumber: phoneNumber || "", displayName: displayName || "Meta Cloud API", verifyToken };
  await writeJson(metaFile, metaConfig);
  await validateMetaConnection();
  res.json(status());
});
app.post("/api/meta/check", async (_req, res) => { await validateMetaConnection(); res.json(status()); });
app.post("/api/meta/logout", async (_req, res) => { metaConfig = {}; metaConnection = { state: "disconnected", error: null }; await fs.rm(metaFile, { force: true }); res.json(status()); });
app.get(["/api/meta/webhook", "/webhook/meta"], (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === metaConfig.verifyToken) return res.status(200).send(req.query["hub.challenge"]);
  res.sendStatus(403);
});
app.post(["/api/meta/webhook", "/webhook/meta"], async (req, res) => {
  res.sendStatus(200);
  for (const entry of req.body?.entry || []) for (const change of entry.changes || []) {
    const value = change.value || {};
    const names = new Map((value.contacts || []).map((contact) => [contact.wa_id, contact.profile?.name]));
    for (const message of value.messages || []) {
      const contactId = `meta:${message.from}`;
      const incomingText = message.text?.body || message.image?.caption || message.document?.caption || "";
      const timestamp = Number(message.timestamp || Date.now() / 1000) * 1000;
      const documentLinks = extractDocumentLinks(incomingText);
      if (incomingText) {
        await addMessage(contactId, incomingText, "incoming", timestamp);
        if (documentLinks.length) void processDocumentLinks(contactId, incomingText, timestamp);
      }
      const printableImage = message.type === "image";
      const printableDocument = message.type === "document" && allowedExtensions.has(path.extname(message.document?.filename || "").toLowerCase());
      if (!printableImage && !printableDocument && documentLinks.length === 0) continue;
      await upsertContact({ id: message.from, name: names.get(message.from), source: "meta", timestamp });
      if (!printableImage && !printableDocument) continue;
      try {
        const media = message.image || message.document;
        const infoResponse = await fetch(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}/${media.id}`, { headers: { authorization: `Bearer ${metaConfig.accessToken}` } });
        if (!infoResponse.ok) throw new Error(`Meta media lookup failed (${infoResponse.status})`);
        const info = await infoResponse.json();
        const downloaded = await downloadUrl(info.url, { authorization: `Bearer ${metaConfig.accessToken}` });
        const extension = printableImage ? `.${(media.mime_type || "image/jpeg").split("/")[1].replace("jpeg", "jpg")}` : path.extname(media.filename || "") || ".pdf";
        await addPrintableJob({ contactId, buffer: downloaded.buffer, fileName: media.filename || `Meta_${Date.now()}${extension}`, mimeType: media.mime_type || downloaded.contentType, timestamp, sourceMessageId: `meta:${message.id}` });
      } catch (error) { logger.warn({ error }, "Meta printable media processing failed"); }
    }
  }
});
app.use((error, _req, res, _next) => { logger.error(error); res.status(500).json({ error: error.message || "Gateway error" }); });
app.listen(port, "127.0.0.1", () => console.log(`WhatsApp gateway: http://127.0.0.1:${port}`));
if (metaConfig.accessToken && metaConfig.phoneNumberId) void validateMetaConnection();
fs.access(path.join(authDir, "creds.json")).then(() => startBaileys()).catch(() => {});
