const { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const http = require("node:http");
const { execFile, execFileSync } = require("node:child_process");

const PRODUCT_NAME = "SMART PRINT";
const DATA_FOLDERS = ["Customers", "Jobs", "Files", "Images", "PDF", "Exports", "WhatsApp", "Logs", "Temp", "License"];
app.setName(PRODUCT_NAME);

let mainWindow;
let gatewayProcess;
let gatewayPort;
let gatewayRestartTimer;
let gatewayStartupError = "";
let gatewayReady = false;

function appRoot() { return app.getAppPath(); }
function userDataDir() { return path.join(app.getPath("userData"), "data"); }
function setupPath() { return path.join(app.getPath("userData"), "setup.json"); }
function trialPath() { return path.join(app.getPath("userData"), "trial.json"); }
function licensePath() { return path.join(app.getPath("userData"), "license.key"); }
function printSettingsPath() { return path.join(app.getPath("userData"), "print-settings.json"); }
function logPath() { return path.join(app.getPath("userData"), "Logs", "app.log"); }
function gatewayProcessPath() { return path.join(app.getPath("userData"), "gateway-process.json"); }
function iconPath() { return app.isPackaged ? path.join(process.resourcesPath, "app.ico") : path.join(appRoot(), "assets", "app.ico"); }
function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }
function log(message) { fs.mkdirSync(path.dirname(logPath()), { recursive: true }); fs.appendFileSync(logPath(), `${new Date().toISOString()} ${message}\n`, "utf8"); }
function execFileAsync(file, args, options) { return new Promise((resolve, reject) => execFile(file, args, options, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr }))); }

async function handleGatewayRequest(message) {
  const requestId = message?.requestId;
  if (!requestId || !message?.action) return;
  try {
    let result;
    if (message.action === "open-path") {
      const error = await shell.openPath(path.resolve(String(message.payload?.filePath || "")));
      if (error) throw new Error(error);
      result = { opened: true };
    } else if (message.action === "convert-office") {
      const inputPath = path.resolve(String(message.payload?.inputPath || ""));
      const outputPath = path.resolve(String(message.payload?.outputPath || ""));
      const scriptPath = app.isPackaged ? path.join(process.resourcesPath, "convert-office.ps1") : path.join(__dirname, "convert-office.ps1");
      await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-InputPath", inputPath, "-OutputPath", outputPath], { timeout: 120000, windowsHide: true });
      result = { converted: true };
    } else throw new Error(`Unsupported desktop operation: ${message.action}`);
    gatewayProcess?.postMessage({ requestId, ok: true, result });
  } catch (error) { gatewayProcess?.postMessage({ requestId, ok: false, error: error.message || "Desktop operation failed." }); }
}

function windowsProcessInfo(pid) {
  if (process.platform !== "win32" || !Number.isInteger(pid) || pid < 1) return null;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){$p | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress}`], { encoding: "utf8", windowsHide: true, timeout: 10000 }).trim();
    return output ? JSON.parse(output) : null;
  } catch { return null; }
}

function terminateOwnedGatewayTree(reason) {
  const record = readJson(gatewayProcessPath(), null);
  const pid = Number(record?.pid);
  const marker = String(record?.marker || "");
  if (!Number.isInteger(pid) || pid < 1 || !/^smart-print-[a-f0-9-]{36}$/.test(marker)) return false;
  const info = windowsProcessInfo(pid);
  const sameExecutable = info?.ExecutablePath && path.resolve(info.ExecutablePath).toLowerCase() === path.resolve(process.execPath).toLowerCase();
  const isNodeUtility = /--type=utility\b/i.test(info?.CommandLine || "") && /node\.mojom\.NodeService/i.test(info?.CommandLine || "");
  if (!sameExecutable || !isNodeUtility) {
    log(`Gateway cleanup skipped pid=${pid} reason=${reason}: process is not an owned SMART PRINT Node utility`);
    try { fs.rmSync(gatewayProcessPath(), { force: true }); } catch {}
    return false;
  }
  try {
    execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 15000, stdio: "ignore" });
    log(`Gateway process tree terminated pid=${pid} reason=${reason}`);
    return true;
  } catch (error) {
    log(`Gateway process tree termination failed pid=${pid} reason=${reason}: ${error.message}`);
    return false;
  } finally {
    try { fs.rmSync(gatewayProcessPath(), { force: true }); } catch {}
  }
}

function machineCode() {
  let seed = `${process.platform}|${process.arch}|${require("node:os").hostname()}`;
  if (process.platform === "win32") {
    try { seed = execFileSync("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", windowsHide: true }).match(/MachineGuid\s+REG_SZ\s+(.+)/i)?.[1]?.trim() || seed; } catch {}
  }
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 20).toUpperCase();
}

function normalizeLicenseKey(value) {
  const compact = String(value || "").replace(/\s+/g, "");
  return compact.match(/PD1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] || compact;
}

function validateLicense(key) {
  try {
    const [prefix, encoded, signature] = normalizeLicenseKey(key).split(".");
    if (prefix !== "PD1" || !encoded || !signature) throw new Error("Invalid licence format.");
    const publicKey = fs.readFileSync(path.join(__dirname, "license-public.pem"), "utf8");
    if (!crypto.verify(null, Buffer.from(encoded), publicKey, Buffer.from(signature, "base64url"))) throw new Error("Licence signature is invalid.");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!["PrintDesk", "ISHTA PRINT MASTER", PRODUCT_NAME].includes(payload.product) || payload.machine !== machineCode()) throw new Error("This licence belongs to another computer.");
    if (payload.expiresAt && Date.now() > new Date(payload.expiresAt).getTime()) throw new Error("This licence has expired.");
    return payload;
  } catch (error) { return { error: error.message || "Invalid licence." }; }
}

function readEntitlement() {
  try {
    const key = fs.readFileSync(licensePath(), "utf8").trim();
    const validation = validateLicense(key);
    if (!validation.error) return { active: true, licensed: true, trial: false, key, machineCode: machineCode(), licence: validation };
  } catch {}
  let trial = readJson(trialPath(), null);
  if (!trial?.startedAt) { trial = { startedAt: new Date().toISOString() }; writeJson(trialPath(), trial); }
  const expiresAt = new Date(new Date(trial.startedAt).getTime() + 7 * 24 * 60 * 60 * 1000);
  const active = Date.now() < expiresAt.getTime();
  return { active, licensed: false, trial: true, machineCode: machineCode(), startedAt: trial.startedAt, expiresAt: expiresAt.toISOString(), daysRemaining: Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86400000)) };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
  });
}

function waitForGateway(port, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get({ hostname: "127.0.0.1", port, path: "/api/health", timeout: 1000 }, (response) => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        retry();
      });
      request.on("error", retry);
      request.on("timeout", () => request.destroy());
    };
    const retry = () => Date.now() - started >= timeoutMs ? reject(new Error("Bundled backend did not become ready.")) : setTimeout(check, 250);
    check();
  });
}

async function startGateway() {
  if (gatewayProcess) return;
  if (!gatewayPort) gatewayPort = await findFreePort();
  const runtimeRoot = app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked") : appRoot();
  // Keep the module URL inside app.asar so ESM resolves packaged dependencies
  // from app.asar/node_modules. Electron transparently reads this entry from
  // app.asar.unpacked, including native dependencies unpacked by the builder.
  const gateway = path.join(appRoot(), "backend", "whatsapp-gateway.mjs");
  if (!fs.existsSync(gateway)) throw new Error(`Bundled backend is missing: ${gateway}`);
  log(`Gateway start path=${gateway} port=${gatewayPort}`);
  gatewayStartupError = "";
  gatewayReady = false;
  const gatewayEnvironment = {
    PATH: process.env.PATH || "",
    SystemRoot: process.env.SystemRoot || "",
    TEMP: process.env.TEMP || app.getPath("temp"),
    TMP: process.env.TMP || app.getPath("temp"),
    PRINTDESK_APP_ROOT: runtimeRoot,
    PRINTDESK_DATA_DIR: userDataDir(),
    WHATSAPP_GATEWAY_PORT: String(gatewayPort),
  };
  const gatewayMarker = `smart-print-${crypto.randomUUID()}`;
  gatewayProcess = utilityProcess.fork(gateway, [`--smart-print-bundled-gateway=${gatewayMarker}`], { serviceName: `${PRODUCT_NAME} Backend`, stdio: ["ignore", "pipe", "pipe"], env: gatewayEnvironment });
  gatewayProcess.on("message", (message) => { void handleGatewayRequest(message); });
  gatewayProcess.once("spawn", () => {
    if (!gatewayProcess?.pid) return;
    writeJson(gatewayProcessPath(), { pid: gatewayProcess.pid, parentPid: process.pid, executablePath: process.execPath, marker: gatewayMarker, port: gatewayPort, sessionPath: path.join(userDataDir(), "baileys-auth"), startedAt: new Date().toISOString() });
    log(`Gateway spawned pid=${gatewayProcess.pid} port=${gatewayPort} session=${path.join(userDataDir(), "baileys-auth")}`);
  });
  gatewayProcess.stdout?.on("data", (chunk) => log(`[backend stdout] ${String(chunk).trimEnd()}`));
  gatewayProcess.stderr?.on("data", (chunk) => {
    const message = String(chunk).trimEnd();
    if (!gatewayReady) gatewayStartupError = [gatewayStartupError, message].filter(Boolean).join("\n").slice(-12000);
    log(`[backend stderr] ${message}`);
  });
  gatewayProcess.on("exit", (code) => {
    const shouldRestart = gatewayReady;
    gatewayReady = false;
    gatewayProcess = undefined;
    log(`Gateway exit code=${code}`);
    try { fs.rmSync(gatewayProcessPath(), { force: true }); } catch {}
    if (shouldRestart && !app.isQuitting && readEntitlement().active) gatewayRestartTimer = setTimeout(() => { startGateway().catch((error) => { gatewayStartupError = error.message; log(`Gateway restart failed: ${error.message}`); }); }, 1500);
  });
  try { await waitForGateway(gatewayPort); }
  catch (error) {
    gatewayProcess?.kill();
    gatewayProcess = undefined;
    throw new Error(gatewayStartupError || `${error.message} See ${logPath()}`);
  }
  gatewayReady = true;
  gatewayStartupError = "";
  log("Gateway health check successful");
}

function createDataFolders(root) { fs.mkdirSync(root, { recursive: true }); for (const folder of DATA_FOLDERS) fs.mkdirSync(path.join(root, folder), { recursive: true }); }
const defaultPrintSettings = { printerName: "", paperSize: "A4", copies: 1, landscape: false, color: true, duplexMode: "simplex", pagesPerSheet: 1, scaleFactor: 100 };
function readPrintSettings() { return { ...defaultPrintSettings, ...readJson(printSettingsPath()) }; }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1200, minHeight: 720, show: false, icon: iconPath(),
    backgroundColor: "#0c1117", title: PRODUCT_NAME,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, additionalArguments: gatewayPort ? [`--smart-print-gateway-port=${gatewayPort}`] : [] },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("closed", () => { mainWindow = undefined; });
  mainWindow.loadFile(path.join(appRoot(), "desktop-dist", "desktop.html"));
  mainWindow.once("ready-to-show", () => { mainWindow.maximize(); mainWindow.show(); log("Renderer ready"); });
}

ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("backend:get-status", () => ({ ready: gatewayReady, port: gatewayPort || null, error: gatewayStartupError || null, logFile: logPath() }));
ipcMain.handle("setup:get", () => ({ complete: Boolean(readJson(setupPath()).masterFolder), masterFolder: readJson(setupPath()).masterFolder || "" }));
ipcMain.handle("storage:select-folder", async () => {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const result = await dialog.showOpenDialog(owner, { title: "Select Master Save Folder", buttonLabel: "Select Folder", properties: ["openDirectory"] });
  return result.canceled || !result.filePaths[0] ? { cancelled: true } : { ok: true, folder: path.resolve(result.filePaths[0]) };
});
ipcMain.handle("setup:complete", (_event, folder) => { const root = path.resolve(String(folder)); createDataFolders(root); writeJson(setupPath(), { masterFolder: root, completedAt: new Date().toISOString() }); return { ok: true, masterFolder: root }; });
ipcMain.handle("license:get", () => readEntitlement());
ipcMain.handle("license:select-file", async () => {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const result = await dialog.showOpenDialog(owner, { title: "Select SMART PRINT License", buttonLabel: "Load License", filters: [{ name: "SMART PRINT License", extensions: ["lic"] }, { name: "Text files", extensions: ["txt"] }], properties: ["openFile"] });
  if (result.canceled || !result.filePaths[0]) return { cancelled: true };
  try { return { ok: true, key: fs.readFileSync(result.filePaths[0], "utf8"), fileName: path.basename(result.filePaths[0]) }; }
  catch (error) { return { ok: false, error: error.message || "The license file could not be read." }; }
});
ipcMain.handle("license:activate", async (_event, key) => {
  const value = normalizeLicenseKey(key);
  const validation = validateLicense(value);
  if (validation.error) return { ok: false, error: validation.error };
  fs.mkdirSync(path.dirname(licensePath()), { recursive: true }); fs.writeFileSync(licensePath(), value, "utf8");
  if (!gatewayProcess) {
    try { await startGateway(); }
    catch (error) { log(`Gateway activation start failed: ${error.message}`); return { ok: false, error: `License activated, but the SMART PRINT backend could not start: ${error.message}` }; }
  }
  return { ok: true, ...readEntitlement() };
});
ipcMain.handle("print:get-settings", async () => ({ settings: readPrintSettings(), printers: await mainWindow.webContents.getPrintersAsync() }));
ipcMain.handle("print:set-settings", (_event, settings) => { const safe = { ...defaultPrintSettings, ...settings, copies: Math.max(1, Math.min(99, Number(settings?.copies) || 1)), pagesPerSheet: [1,2,4,6,9,16].includes(Number(settings?.pagesPerSheet)) ? Number(settings.pagesPerSheet) : 1, scaleFactor: Math.max(10, Math.min(200, Number(settings?.scaleFactor) || 100)) }; writeJson(printSettingsPath(), safe); return { ok: true, settings: safe }; });
ipcMain.handle("print:pdf", async (_event, base64) => {
  if (!readEntitlement().active) return { ok: false, error: "Your trial has expired. Activate SMART PRINT to print." };
  const printDir = path.join(app.getPath("temp"), PRODUCT_NAME); fs.mkdirSync(printDir, { recursive: true });
  const printFile = path.join(printDir, `print-${Date.now()}-${crypto.randomUUID()}.pdf`); fs.writeFileSync(printFile, Buffer.from(String(base64), "base64"));
  const settings = readPrintSettings();
  const choice = await dialog.showMessageBox(mainWindow, { type: "question", title: "Print", message: "Choose print mode", buttons: ["Preview & Print", "Direct Print", "Cancel"], defaultId: 0, cancelId: 2, noLink: true });
  if (choice.response === 2) { fs.rmSync(printFile, { force: true }); return { ok: false, cancelled: true }; }
  if (choice.response === 0) { const error = await shell.openPath(printFile); if (error) return { ok: false, error }; setTimeout(() => { try { fs.rmSync(printFile, { force: true }); } catch {} }, 3600000); return { ok: true, preview: true }; }
  const printWindow = new BrowserWindow({ show: false, webPreferences: { plugins: true } }); await printWindow.loadFile(printFile); await new Promise((resolve) => setTimeout(resolve, 1200));
  return new Promise((resolve) => printWindow.webContents.print({ silent: true, printBackground: true, deviceName: settings.printerName || undefined, pageSize: "A4", copies: settings.copies, landscape: settings.landscape, color: settings.color, duplexMode: settings.duplexMode, pagesPerSheet: settings.pagesPerSheet, scaleFactor: settings.scaleFactor }, (success, reason) => { printWindow.close(); fs.rmSync(printFile, { force: true }); resolve(success ? { ok: true } : { ok: false, error: reason || "Printing was cancelled." }); }));
});

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    log(`Application startup version=${app.getVersion()} resources=${process.resourcesPath} userData=${app.getPath("userData")}`);
    fs.mkdirSync(userDataDir(), { recursive: true });
    terminateOwnedGatewayTree("stale startup cleanup");
    gatewayPort = await findFreePort();
    if (readEntitlement().active) { try { await startGateway(); } catch (error) { gatewayStartupError = error.message; log(`Gateway startup failed: ${error.message}`); dialog.showErrorBox(`${PRODUCT_NAME} Startup Error`, error.message); } }
    createWindow();
  });
}
app.on("before-quit", () => { app.isQuitting = true; clearTimeout(gatewayRestartTimer); terminateOwnedGatewayTree("application shutdown"); gatewayProcess = undefined; log("Application shutdown complete"); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
