const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("printDeskDesktop", {
  isDesktop: true,
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  getMachineCode: () => ipcRenderer.invoke("license:machine-code"),
  getLicense: () => ipcRenderer.invoke("license:get"),
  activateLicense: (key) => ipcRenderer.invoke("license:activate", key),
  printPdf: (base64) => ipcRenderer.invoke("print:pdf", base64),
  getPrintSettings: () => ipcRenderer.invoke("print:get-settings"),
  setPrintSettings: (settings) => ipcRenderer.invoke("print:set-settings", settings),
});
