const { contextBridge, ipcRenderer } = require("electron");
const gatewayPortArg = process.argv.find((arg) => arg.startsWith("--smart-print-gateway-port="));
const gatewayPort = gatewayPortArg?.split("=")[1];

contextBridge.exposeInMainWorld("printDeskDesktop", {
  isDesktop: true,
  gatewayUrl: gatewayPort ? `http://127.0.0.1:${gatewayPort}` : "",
  getBackendStatus: () => ipcRenderer.invoke("backend:get-status"),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  getSetup: () => ipcRenderer.invoke("setup:get"),
  completeSetup: (folder) => ipcRenderer.invoke("setup:complete", folder),
  selectSaveFolder: () => ipcRenderer.invoke("storage:select-folder"),
  getLicense: () => ipcRenderer.invoke("license:get"),
  activateLicense: (key) => ipcRenderer.invoke("license:activate", key),
  printPdf: (base64) => ipcRenderer.invoke("print:pdf", base64),
  getPrintSettings: () => ipcRenderer.invoke("print:get-settings"),
  setPrintSettings: (settings) => ipcRenderer.invoke("print:set-settings", settings),
});
