<script setup lang="ts">
import type { AppWindow } from "../app-window";
declare const window: AppWindow;
import { onBeforeMount, ref } from "vue";
import logo from "~assets/icons/ytmd.png";

const loaderPieces = ["c-top-left", "c-top-right", "c-bottom-left", "c-bottom-right", "c-top-strip", "c-bottom-strip", "c-middle"] as const;

const memoryStore = window.ytmd.memoryStore;

const ytmViewLoading = ref<boolean | undefined>(await memoryStore.get("ytmViewLoading"));
const ytmViewLoadingError = ref<boolean | undefined>(await memoryStore.get("ytmViewLoadingError"));
const ytmViewLoadTimedout = ref<boolean | undefined>(await memoryStore.get("ytmViewLoadTimedout"));
const ytmViewLoadingStatus = ref<string | undefined>((await memoryStore.get("ytmViewLoadingStatus")) ?? "");

onBeforeMount(async () => {
  ytmViewLoading.value = await memoryStore.get("ytmViewLoading");
  ytmViewLoadTimedout.value = await memoryStore.get("ytmViewLoadTimedout");
  ytmViewLoadingError.value = await memoryStore.get("ytmViewLoadingError");
  ytmViewLoadingStatus.value = (await memoryStore.get("ytmViewLoadingStatus")) ?? "";
});

memoryStore.onStateChanged((newState) => {
  ytmViewLoading.value = newState.ytmViewLoading;
  ytmViewLoadingError.value = newState.ytmViewLoadingError;
  ytmViewLoadTimedout.value = newState.ytmViewLoadTimedout;
  ytmViewLoadingStatus.value = newState.ytmViewLoadingStatus;
});

function retry() {
  window.ytmd.ytmViewRecreate();
}
</script>

<template>
  <div class="ytmview-loading-container">
    <Transition name="fade">
      <div v-if="ytmViewLoading" class="ytmview-loading">
        <img class="logo" :src="logo" />
        <div class="music-loader">
          <div v-for="bar in 8" :key="bar" class="loader-line">
            <div v-for="piece in loaderPieces" :key="piece" class="loader-piece" :class="piece"></div>
          </div>
        </div>
        <p :class="{ 'ytmview-loading-status': true, error: ytmViewLoadingError }">{{ ytmViewLoadingStatus }}</p>
        <p v-if="ytmViewLoadTimedout" class="ytmview-loading-timeout">YouTube Music is taking longer than usual to load</p>
        <button v-if="ytmViewLoadingError" class="ytmview-loading-retry" @click="retry">Retry</button>
      </div>
      <div v-else class="ytmview-loading"></div>
    </Transition>
  </div>
</template>

<style scoped>
.ytmview-loading-container {
  height: calc(100% - var(--titlebar-height));
  background-color: var(--bg);
}

.ytmview-loading {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: calc(100% - var(--titlebar-height));
  user-select: none;
}

.ytmview-loading-status {
  color: var(--text-faint);
}

.ytmview-loading-status.error {
  color: var(--accent);
}

.ytmview-loading-timeout {
  color: var(--accent);
}

.ytmview-loading-retry {
  margin-top: 8px;
  padding: 6px 24px;
  border: 1px solid var(--text-faint);
  border-radius: 16px;
  background: none;
  color: var(--text);
  cursor: pointer;
}

.ytmview-loading-retry:hover {
  border-color: var(--text);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.logo {
  width: 160px;
  height: 160px;
}

.music-loader {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  height: 160px;
}

.loader-line {
  width: 12px;
  height: 72px;
  position: relative;
}

.loader-line:nth-child(1) {
  animation-delay: 1s;
}

.loader-line:nth-child(2) {
  animation-delay: 0.8s;
}

.loader-line:nth-child(3) {
  animation-delay: 0.4s;
}

.loader-line:nth-child(4) {
  animation-delay: 0.2s;
}

.loader-line:nth-child(5) {
  animation-delay: 0.2s;
}

.loader-line:nth-child(6) {
  animation-delay: 0.4s;
}

.loader-line:nth-child(7) {
  animation-delay: 0.8s;
}

.loader-line:nth-child(8) {
  animation-delay: 1s;
}

.loader-piece {
  position: absolute;
  left: 0;
  top: 50%;
  background: var(--text);
  transform-origin: 0 0;
  animation-duration: 1.5s;
  animation-iteration-count: infinite;
  animation-delay: inherit;
  animation-timing-function: linear;
}

.c-middle {
  width: 12px;
  height: 60px;
  animation-name: loader-c-middle;
  transform: translate(0, -0.75px) scale(1, 0.025);
}

.c-top-left,
.c-top-right,
.c-bottom-left,
.c-bottom-right {
  width: 6px;
  height: 6px;
}

.c-top-left {
  border-top-left-radius: 6px;
  animation-name: loader-c-top-left;
  transform: translate(0, -2px) scale(0.3333, 0.3333);
}

.c-top-right {
  border-top-right-radius: 6px;
  animation-name: loader-c-top-right;
  transform: translate(10px, -2px) scale(0.3333, 0.3333);
}

.c-bottom-left {
  border-bottom-left-radius: 6px;
  animation-name: loader-c-bottom-left;
  transform: translate(0, 0) scale(0.3333, 0.3333);
}

.c-bottom-right {
  border-bottom-right-radius: 6px;
  animation-name: loader-c-bottom-right;
  transform: translate(10px, 0) scale(0.3333, 0.3333);
}

.c-top-strip,
.c-bottom-strip {
  width: 12px;
  height: 6px;
}

.c-top-strip {
  animation-name: loader-c-top-strip;
  transform: translate(2px, -2px) scale(0.6667, 0.3333);
}

.c-bottom-strip {
  animation-name: loader-c-bottom-strip;
  transform: translate(2px, 0) scale(0.6667, 0.3333);
}

@keyframes loader-c-top-left {
  0% {
    transform: translate(0, -2px) scale(0.3333, 0.3333);
    animation-timing-function: cubic-bezier(0.376, 0, 0.7023, 0.3888);
  }

  11.9438% {
    transform: translate(0, -6px) scale(1, 1);
    animation-timing-function: cubic-bezier(0.3435, 0.2996, 0.5662, 1);
  }

  50% {
    transform: translate(0, -36px) scale(1, 1);
    animation-timing-function: cubic-bezier(0.4338, 0, 0.6565, 0.7004);
  }

  88.0562% {
    transform: translate(0, -6px) scale(1, 1);
    animation-timing-function: cubic-bezier(0.2977, 0.6112, 0.624, 1);
  }

  100% {
    transform: translate(0, -2px) scale(0.3333, 0.3333);
  }
}

@keyframes loader-c-top-right {
  0% {
    transform: translate(10px, -2px) scale(0.3333, 0.3333);
    animation-timing-function: cubic-bezier(0.376, 0, 0.7023, 0.3888);
  }

  11.9438% {
    transform: translate(6px, -6px) scale(1, 1);
    animation-timing-function: cubic-bezier(0.3435, 0.2996, 0.5662, 1);
  }

  50% {
    transform: translate(6px, -36px) scale(1, 1);
    animation-timing-function: cubic-bezier(0.4338, 0, 0.6565, 0.7004);
  }

  88.0562% {
    transform: translate(6px, -6px) scale(1, 1);
    animation-timing-function: cubic-bezier(0.2977, 0.6112, 0.624, 1);
  }

  100% {
    transform: translate(10px, -2px) scale(0.3333, 0.3333);
  }
}

@keyframes loader-c-bottom-left {
  0% {
    transform: translate(0, 0) scale(0.3333, 0.3333);
    animation-timing-function: cubic-bezier(0.376, 0, 0.7023, 0.3888);
  }

  11.9438% {
    transform: translate(0, 0) scale(1, 1);
    animation-timing-function: cubic-bezier(0.3435, 0.2996, 0.5662, 1);
  }

  50% {
    transform: translate(0, 30px) scale(1, 1);
    animation-timing-function: cubic-bezier(0.4338, 0, 0.6565, 0.7004);
  }

  88.0562% {
    transform: translate(0, 0) scale(1, 1);
    animation-timing-function: cubic-bezier(0.2977, 0.6112, 0.624, 1);
  }

  100% {
    transform: translate(0, 0) scale(0.3333, 0.3333);
  }
}

@keyframes loader-c-bottom-right {
  0% {
    transform: translate(10px, 0) scale(0.3333, 0.3333);
    animation-timing-function: cubic-bezier(0.376, 0, 0.7023, 0.3888);
  }

  11.9438% {
    transform: translate(6px, 0) scale(1, 1);
    animation-timing-function: cubic-bezier(0.3435, 0.2996, 0.5662, 1);
  }

  50% {
    transform: translate(6px, 30px) scale(1, 1);
    animation-timing-function: cubic-bezier(0.4338, 0, 0.6565, 0.7004);
  }

  88.0562% {
    transform: translate(6px, 0) scale(1, 1);
    animation-timing-function: cubic-bezier(0.2977, 0.6112, 0.624, 1);
  }

  100% {
    transform: translate(10px, 0) scale(0.3333, 0.3333);
  }
}

@keyframes loader-c-top-strip {
  0% {
    transform: translate(2px, -2px) scale(0.6667, 0.3333);
    animation-timing-function: cubic-bezier(0.376, 0, 0.7023, 0.3888);
  }

  11.9438% {
    transform: translate(6px, -6px) scale(0, 1);
    animation-timing-function: cubic-bezier(0.3435, 0.2996, 0.5662, 1);
  }

  50% {
    transform: translate(6px, -36px) scale(0, 1);
    animation-timing-function: cubic-bezier(0.4338, 0, 0.6565, 0.7004);
  }

  88.0562% {
    transform: translate(6px, -6px) scale(0, 1);
    animation-timing-function: cubic-bezier(0.2977, 0.6112, 0.624, 1);
  }

  100% {
    transform: translate(2px, -2px) scale(0.6667, 0.3333);
  }
}

@keyframes loader-c-bottom-strip {
  0% {
    transform: translate(2px, 0) scale(0.6667, 0.3333);
    animation-timing-function: cubic-bezier(0.376, 0, 0.7023, 0.3888);
  }

  11.9438% {
    transform: translate(6px, 0) scale(0, 1);
    animation-timing-function: cubic-bezier(0.3435, 0.2996, 0.5662, 1);
  }

  50% {
    transform: translate(6px, 30px) scale(0, 1);
    animation-timing-function: cubic-bezier(0.4338, 0, 0.6565, 0.7004);
  }

  88.0562% {
    transform: translate(6px, 0) scale(0, 1);
    animation-timing-function: cubic-bezier(0.2977, 0.6112, 0.624, 1);
  }

  100% {
    transform: translate(2px, 0) scale(0.6667, 0.3333);
  }
}

@keyframes loader-c-middle {
  0% {
    transform: translate(0, -0.75px) scale(1, 0.025);
    animation-timing-function: cubic-bezier(0.376, 0, 0.7023, 0.3888);
  }

  11.9438% {
    transform: translate(0, -0.75px) scale(1, 0.025);
    animation-timing-function: cubic-bezier(0.3435, 0.2996, 0.5662, 1);
  }

  50% {
    transform: translate(0, -30.75px) scale(1, 1.025);
    animation-timing-function: cubic-bezier(0.4338, 0, 0.6565, 0.7004);
  }

  88.0562% {
    transform: translate(0, -0.75px) scale(1, 0.025);
    animation-timing-function: cubic-bezier(0.2977, 0.6112, 0.624, 1);
  }

  100% {
    transform: translate(0, -0.75px) scale(1, 0.025);
  }
}

@media (prefers-reduced-motion: reduce) {
  .loader-line {
    height: 4px;
    border-radius: 10px;
    background: var(--text);
  }

  .loader-piece {
    display: none;
  }
}
</style>
