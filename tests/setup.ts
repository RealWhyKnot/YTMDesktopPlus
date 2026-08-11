import log from "electron-log";

// Keep test runs from writing into the installed app's log file
log.transports.file.level = false;
