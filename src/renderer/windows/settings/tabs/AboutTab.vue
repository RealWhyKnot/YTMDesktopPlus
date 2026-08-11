<script setup lang="ts">
import { inject } from "vue";
import { settingsShellKey } from "../context";
import logo from "~assets/icons/ytmd.png";

const shell = inject(settingsShellKey);
const {
  ytmdVersion,
  ytmdBranch,
  ytmdCommitHash,
  autoUpdaterDisabled,
  checkingForUpdate,
  updateAvailable,
  updateNotAvailable,
  updateDownloaded,
  checkForUpdates,
  restartApplicationForUpdate
} = shell;
</script>

<template>
  <div class="about-tab">
    <img class="icon" :src="logo" />
    <h2 class="app-name">YTMDesktop+</h2>
    <p class="made-by">Made by YTMDesktop Team</p>
    <template v-if="!autoUpdaterDisabled">
      <button
        v-if="!updateDownloaded"
        :disabled="!(!checkingForUpdate && !updateAvailable && !updateDownloaded)"
        class="update-check-button"
        @click="checkForUpdates"
      >
        <span class="material-symbols-outlined">update</span>Check for updates
      </button>
      <button v-if="updateDownloaded" class="update-button" @click="restartApplicationForUpdate">
        <span class="material-symbols-outlined">upgrade</span>Restart to update
      </button>
      <p v-if="checkingForUpdate && !updateAvailable && !updateDownloaded" class="updating">
        <span class="material-symbols-outlined">progress_activity</span>Checking for updates...
      </p>
      <p v-if="updateAvailable && !updateDownloaded" class="updating"><span class="material-symbols-outlined">progress_activity</span>Downloading update...</p>
      <p v-if="updateNotAvailable" class="no-update">Update not available</p>
    </template>
    <template v-if="autoUpdaterDisabled">
      <button disabled class="update-check-button"><span class="material-symbols-outlined">update</span>Check for updates</button>
      <p class="no-auto-updater">Auto updater disabled</p>
    </template>
    <span class="version-info">
      <p class="version">Version: {{ ytmdVersion }}</p>
      <p class="branch">Branch: {{ ytmdBranch }}</p>
      <p class="commit">Commit: {{ ytmdCommitHash }}</p>
    </span>
    <div class="links">
      <a href="https://github.com/RealWhyKnot/YTMDesktopPlus" target="_blank">GitHub</a>
    </div>
  </div>
</template>

<style scoped>
.about-tab {
  display: flex;
  /* safe keeps the top reachable when the window is shorter than the content */
  justify-content: safe center;
  align-items: center;
  flex-direction: column;
  min-height: 100%;
  box-sizing: border-box;
  padding: 24px 0;
}

.icon {
  width: 128px;
  height: 128px;
  margin-bottom: 16px;
}

.app-name {
  margin: 0;
}

.version-info {
  user-select: text;
}

.version-info .version,
.version-info .branch,
.version-info .commit {
  margin: 4px 0;
  color: var(--text-muted);
}

.made-by {
  margin: 16px 0;
}

.links {
  margin-top: 32px;
  width: 100%;
  display: flex;
  justify-content: space-evenly;
}

.links a {
  color: var(--text-muted);
}

.update-check-button {
  display: flex;
  align-items: center;
  background-color: transparent;
  border: 1px solid #ffffff;
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.update-check-button:disabled {
  border: 1px solid var(--border-strong);
  cursor: not-allowed;
}

.updating,
.no-update {
  display: flex;
  align-items: center;
  color: #888888;
  margin: 0 0 8px 0;
}

.no-auto-updater {
  display: flex;
  align-items: center;
  color: #888888;
  margin: 0 0 8px 0;
}

.updating .material-symbols-outlined {
  animation: rotation 1s infinite linear;
}

@keyframes rotation {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(359deg);
  }
}

.update-button {
  display: flex;
  align-items: center;
  background-color: var(--accent);
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.update-check-button .material-symbols-outlined,
.updating .material-symbols-outlined,
.update-button .material-symbols-outlined {
  margin-right: 4px;
}
</style>
