const { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

// Preserve existing WhatsApp session, jobs and licence after the visible rename.
app.setPath("userData", path.join(app.getPath("appData"), "PrintDesk"));

let mainWindow;
let gatewayProcess;

function appRoot() { return app.getAppPath(); }
function userDataDir() { return path.join(app.getPath("userData"), "data"); }

function copyDirectory(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, errorOnExist: false });
}

function migrateLegacyData() {
  const target = userDataDir();
  if (fs.existsSync(target)) return;
  const candidates = [
    path.join(process.cwd(), ".whatsapp-data"),
    path.join(path.dirname(process.execPath), ".whatsapp-data"),
    path.join(appRoot(), ".whatsapp-data"),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (source) copyDirectory(source, target);
  else fs.mkdirSync(target, { recursive: true });
}

function startGateway() {
  const runtimeRoot = app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : appRoot();
  const gateway = path.join(appRoot(), "backend", "whatsapp-gateway.mjs");
  gatewayProcess = utilityProcess.fork(gateway, [], {
    serviceName: "ISHTA PRINT MASTER WhatsApp Gateway",
    env: { ...process.env, PRINTDESK_APP_ROOT: runtimeRoot, PRINTDESK_DATA_DIR: userDataDir(), WHATSAPP_GATEWAY_PORT: "3001" },
  });
  gatewayProcess.on("exit", (code) => {
    if (!app.isQuitting && code !== 0) dialog.showErrorBox("ISHTA PRINT MASTER Gateway", `The local gateway stopped (code ${code}). Restart ISHTA PRINT MASTER.`);
  });
}

function machineCode() {
  let seed = `${process.platform}|${process.arch}|${require("node:os").hostname()}`;
  if (process.platform === "win32") {
    try {
      seed = execFileSync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", windowsHide: true }).match(/MachineGuid\s+REG_SZ\s+(.+)/i)?.[1]?.trim() || seed;
    } catch {}
  }
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 20).toUpperCase();
}

function licensePath() { return path.join(app.getPath("userData"), "license.key"); }
const defaultPrintSettings = { printerName: "", paperSize: "A4", copies: 1, landscape: false, color: true, duplexMode: "simplex", pagesPerSheet: 1, scaleFactor: 100 };
function printSettingsPath() { return path.join(app.getPath("userData"), "print-settings.json"); }
function readPrintSettings() { try { return { ...defaultPrintSettings, ...JSON.parse(fs.readFileSync(printSettingsPath(), "utf8")) }; } catch { return { ...defaultPrintSettings }; } }
function validateLicense(key) {
  try {
    const [prefix, encoded, signature] = String(key).replace(/\s+/g, "").split(".");
    if (prefix !== "PD1" || !encoded || !signature) throw new Error("Invalid licence format.");
    const publicKey = fs.readFileSync(path.join(__dirname, "license-public.pem"), "utf8");
    if (!crypto.verify(null, Buffer.from(encoded), publicKey, Buffer.from(signature, "base64url"))) throw new Error("Licence signature is invalid.");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!["PrintDesk", "ISHTA PRINT MASTER"].includes(payload.product) || payload.machine !== machineCode()) throw new Error("This licence belongs to another computer.");
    if (payload.expiresAt && Date.now() > new Date(payload.expiresAt).getTime()) throw new Error("This licence has expired.");
    return payload;
  } catch (error) { return { error: error.message || "Invalid licence." }; }
}
function readLicense() {
  try {
    const key = fs.readFileSync(licensePath(), "utf8").trim(), validation = validateLicense(key);
    return validation.error ? { active: false, error: validation.error, machineCode: machineCode() } : { active: true, key, machineCode: machineCode(), licence: validation };
  }
  catch { return { active: false, machineCode: machineCode() }; }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1200, minHeight: 720, show: false,
    backgroundColor: "#0c1117", title: "ISHTA PRINT MASTER",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(appRoot(), "desktop-dist", "desktop.html"));
  mainWindow.once("ready-to-show", () => { mainWindow.maximize(); mainWindow.show(); });
}

ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("license:machine-code", () => machineCode());
ipcMain.handle("license:get", () => readLicense());
ipcMain.handle("license:activate", (_event, key) => {
  const value = String(key || "").replace(/\s+/g, "");
  if (!value) return { ok: false, error: "Licence key is required." };
  const validation = validateLicense(value);
  if (validation.error) return { ok: false, error: validation.error };
  fs.writeFileSync(licensePath(), value, "utf8");
  return { ok: true, ...readLicense() };
});
ipcMain.handle("print:get-settings", async () => ({ settings: readPrintSettings(), printers: await mainWindow.webContents.getPrintersAsync() }));
ipcMain.handle("print:set-settings", (_event, settings) => {
  const safe = { ...defaultPrintSettings, ...settings, copies: Math.max(1, Math.min(99, Number(settings?.copies) || 1)), pagesPerSheet: [1,2,4,6,9,16].includes(Number(settings?.pagesPerSheet)) ? Number(settings.pagesPerSheet) : 1, scaleFactor: Math.max(10, Math.min(200, Number(settings?.scaleFactor) || 100)) };
  fs.writeFileSync(printSettingsPath(), JSON.stringify(safe, null, 2), "utf8");
  return { ok: true, settings: safe };
});
ipcMain.handle("print:pdf", async (_event, base64) => {
  const printDir = path.join(app.getPath("temp"), "PrintDesk");
  fs.mkdirSync(printDir, { recursive: true });
  const printPath = path.join(printDir, `print-${Date.now()}-${crypto.randomUUID()}.pdf`);
  fs.writeFileSync(printPath, Buffer.from(String(base64), "base64"));
  const settings = readPrintSettings();
  const summary = `Printer: ${settings.printerName || "Windows default"}\nPaper: A4\nPages per sheet: ${settings.pagesPerSheet}\nCopies: ${settings.copies}\nOrientation: ${settings.landscape ? "Landscape" : "Portrait"}\nDuplex: ${settings.duplexMode}\nScale: ${settings.scaleFactor}%`;
  const choice = await dialog.showMessageBox(mainWindow, { type: "question", title: "Print", message: "Choose print mode", detail: `Foxit Preview opens the PDF without printing. Direct Print uses these app settings:\n\n${summary}`, buttons: ["Foxit Preview & Print", "Direct Print", "Cancel"], defaultId: 0, cancelId: 2, noLink: true });
  if (choice.response === 2) { fs.rmSync(printPath, { force: true }); return { ok: false, cancelled: true }; }
  if (choice.response === 0) {
    const error = await shell.openPath(printPath);
    if (error) { fs.rmSync(printPath, { force: true }); return { ok: false, error }; }
    setTimeout(() => { try { fs.rmSync(printPath, { force: true }); } catch {} }, 60 * 60 * 1000);
    return { ok: true, preview: true };
  }
  const printWindow = new BrowserWindow({ show: false, webPreferences: { plugins: true } });
  await printWindow.loadFile(printPath);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return await new Promise((resolve) => {
    printWindow.webContents.print({ silent: true, printBackground: true, deviceName: settings.printerName || undefined, pageSize: "A4", copies: settings.copies, landscape: settings.landscape, color: settings.color, duplexMode: settings.duplexMode, pagesPerSheet: settings.pagesPerSheet, scaleFactor: settings.scaleFactor, margins: { marginType: "default" } }, (success, failureReason) => {
      printWindow.close();
      fs.rmSync(printPath, { force: true });
      resolve(success ? { ok: true } : { ok: false, error: failureReason || "Printing was cancelled." });
    });
  });
});

app.whenReady().then(() => { migrateLegacyData(); startGateway(); createWindow(); });
app.on("before-quit", () => { app.isQuitting = true; gatewayProcess?.kill(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
