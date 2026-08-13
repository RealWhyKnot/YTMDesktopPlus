import { contextBridge, ipcRenderer } from "electron";

export type AnalysisJob = {
  videoId: string;
  buffer: ArrayBuffer;
};

contextBridge.exposeInMainWorld("ytmdDjAnalysis", {
  onJob: (callback: (job: AnalysisJob) => void) => {
    ipcRenderer.on("addon:dj:analyze", (_event, job: AnalysisJob) => callback(job));
  },
  sendResult: (result: unknown) => ipcRenderer.send("addon:dj:analysisResult", result),
  ready: () => ipcRenderer.send("addon:dj:analysisReady")
});
