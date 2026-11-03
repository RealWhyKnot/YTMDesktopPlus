export function runScript() {
  const pageWindow: Window & RoomCaptureWindow = window;
  pageWindow.__ytmdAudioStream?.setListening(true);
  return "";
}
