<script setup lang="ts">
import { computed, ref } from "vue";
import type { RoomSnapshot } from "~shared/room-protocol";

const memoryStore = window.ytmd.memoryStore;
const store = window.ytmd.store;

// Room state lives in the rooms addon's own memory namespace, read the same
// way any addon window reads its addon's state.
const roomsMemory = (all: { rooms?: Record<string, unknown> } | undefined) => all?.rooms ?? {};
const initialMemory = roomsMemory(await memoryStore.get("addonMemory"));

const snapshot = ref<RoomSnapshot | null>((initialMemory.room as RoomSnapshot | null | undefined) ?? null);
const joinPrompt = ref<string | null>((initialMemory.joinPrompt as string | null | undefined) ?? null);

const savedName = ((await store.get("addons"))?.settings?.rooms?.displayName as string | null | undefined) ?? null;
const displayName = ref<string>(savedName ?? "");
const joinInput = ref<string>(joinPrompt.value ?? "");
const trackInput = ref<string>("");
const seekInput = ref<string>("");
const copied = ref(false);

memoryStore.onStateChanged(newState => {
  const memory = roomsMemory(newState.addonMemory);
  snapshot.value = (memory.room as RoomSnapshot | null | undefined) ?? snapshot.value;
  const prompt = memory.joinPrompt as string | null | undefined;
  if (prompt && prompt !== joinPrompt.value) {
    joinPrompt.value = prompt;
    joinInput.value = prompt;
  }
});

const phase = computed(() => snapshot.value?.phase ?? "idle");
const canSubmitName = computed(() => displayName.value.trim().length > 0);
const isController = computed(() => snapshot.value?.isHost || snapshot.value?.role === 1);

const joinCode = computed(() => {
  const match = /([abcdefghjkmnpqrstuvwxyz23456789]{8})\s*$/.exec(joinInput.value.trim());
  return match ? match[1] : null;
});

function startRoom() {
  if (!canSubmitName.value) return;
  window.ytmd.roomHost(displayName.value.trim());
}

function joinRoom() {
  if (!canSubmitName.value || !joinCode.value) return;
  window.ytmd.roomJoin(joinCode.value, displayName.value.trim());
}

function leaveRoom() {
  window.ytmd.roomLeave();
}

async function copyShareLink() {
  if (!snapshot.value?.shareUrl) return;
  await navigator.clipboard.writeText(snapshot.value.shareUrl);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

function grant(memberId: string, role: number) {
  window.ytmd.roomGrant(memberId, role);
}

function control(action: string) {
  window.ytmd.roomControl(action);
}

function sendSeek() {
  const parts = seekInput.value.trim().split(":");
  if (parts.length === 0 || parts.length > 2) return;
  const numbers = parts.map(part => Number(part));
  if (numbers.some(value => !Number.isFinite(value) || value < 0)) return;
  const seconds = parts.length === 2 ? numbers[0] * 60 + numbers[1] : numbers[0];
  window.ytmd.roomControl("seek", seconds);
  seekInput.value = "";
}

function sendTrack() {
  const raw = trackInput.value.trim();
  const fromUrl = /[?&]v=([A-Za-z0-9_-]{1,64})/.exec(raw);
  const videoId = fromUrl ? fromUrl[1] : /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
  if (!videoId) return;
  window.ytmd.roomControl("track", videoId);
  trackInput.value = "";
}

function resumeSync() {
  window.ytmd.roomResume();
}

function memberLabel(name: string | null, id: string) {
  return name ?? `Listener ${id}`;
}
</script>

<template>
  <div class="room-container">
    <!-- Idle: start or join -->
    <div v-if="phase === 'idle'" class="setup">
      <div class="field">
        <p class="label">Display name</p>
        <input v-model="displayName" class="text-input" type="text" maxlength="24" placeholder="Shown to people in the room" />
        <p class="hint">Pick any name. It is never taken from your account and disappears when you leave.</p>
      </div>

      <div class="card">
        <p class="card-title"><span class="material-symbols-outlined">podcasts</span>Start a room</p>
        <p class="card-body">Friends follow your playback in sync. Share the link from here or straight from Discord.</p>
        <button class="primary" :disabled="!canSubmitName" @click="startRoom">Start a room</button>
      </div>

      <div class="card">
        <p class="card-title"><span class="material-symbols-outlined">group_add</span>Join a room</p>
        <input v-model="joinInput" class="text-input" type="text" placeholder="Room link or 8 letter code" />
        <button class="primary" :disabled="!canSubmitName || !joinCode" @click="joinRoom">Join</button>
      </div>
    </div>

    <!-- Connecting -->
    <div v-else-if="phase === 'connecting'" class="status-screen">
      <span class="material-symbols-outlined spinning">progress_activity</span>
      <p>Connecting to the room service...</p>
      <button class="subtle" @click="leaveRoom">Cancel</button>
    </div>

    <!-- Failed -->
    <div v-else-if="phase === 'failed'" class="status-screen">
      <span class="material-symbols-outlined error-icon">error</span>
      <p>{{ snapshot?.error ?? "Something went wrong" }}</p>
      <button class="subtle" @click="leaveRoom">Back</button>
    </div>

    <!-- In a room -->
    <div v-else class="in-room">
      <div class="room-header">
        <div class="room-code-line">
          <span class="room-code">{{ snapshot?.roomId }}</span>
          <button class="icon-button" :title="copied ? 'Copied' : 'Copy share link'" @click="copyShareLink">
            <span class="material-symbols-outlined">{{ copied ? "check" : "content_copy" }}</span>
          </button>
        </div>
        <p class="room-subtitle">
          {{ snapshot?.isHost ? "You are hosting" : `Following ${snapshot?.hostName ?? "the host"}` }}
          <span class="listener-count"><span class="material-symbols-outlined">headphones</span>{{ (snapshot?.listenerCount ?? 0) + 1 }}</span>
        </p>
      </div>

      <div v-if="snapshot?.isHost && snapshot?.audioStreaming" class="notice streaming">
        <span class="live-dot"></span>
        <span>Streaming audio to the web{{ snapshot?.webListenerCount ? ` for ${snapshot.webListenerCount} listening in a browser` : "" }}</span>
      </div>

      <div v-if="snapshot?.error" class="notice">{{ snapshot.error }}</div>

      <div v-if="!snapshot?.isHost && snapshot?.syncStatus === 'suspended'" class="notice suspended">
        <span>{{ snapshot?.syncDetail ?? "Paused following" }}</span>
        <button class="subtle" @click="resumeSync">Resume</button>
      </div>

      <div class="members">
        <p class="section-title">In this room</p>
        <div class="member">
          <span class="member-name">{{ snapshot?.isHost ? displayName || "You" : (snapshot?.hostName ?? "Host") }}</span>
          <span class="badge host-badge">Host</span>
        </div>
        <div v-for="member in snapshot?.members ?? []" :key="member.id" class="member">
          <span class="member-name">
            {{ memberLabel(member.name, member.id) }}
            <span v-if="member.id === snapshot?.memberId" class="you-tag">you</span>
          </span>
          <span v-if="member.role === 1" class="badge controller-badge">Controller</span>
          <template v-if="snapshot?.isHost">
            <button v-if="member.role !== 1" class="subtle small" @click="grant(member.id, 1)">Promote</button>
            <button v-else class="subtle small" @click="grant(member.id, 0)">Demote</button>
          </template>
        </div>
        <p v-if="(snapshot?.members ?? []).length === 0" class="empty">Nobody else yet. Share the link to invite people.</p>
      </div>

      <div v-if="!snapshot?.isHost && isController" class="controls">
        <p class="section-title">Controls</p>
        <div class="transport">
          <button class="icon-button" title="Previous" @click="control('prev')"><span class="material-symbols-outlined">skip_previous</span></button>
          <button class="icon-button" title="Play" @click="control('play')"><span class="material-symbols-outlined">play_arrow</span></button>
          <button class="icon-button" title="Pause" @click="control('pause')"><span class="material-symbols-outlined">pause</span></button>
          <button class="icon-button" title="Next" @click="control('next')"><span class="material-symbols-outlined">skip_next</span></button>
        </div>
        <div class="inline-field">
          <input v-model="seekInput" class="text-input" type="text" placeholder="Seek to mm:ss" @keyup.enter="sendSeek" />
          <button class="subtle small" @click="sendSeek">Seek</button>
        </div>
        <div class="inline-field">
          <input v-model="trackInput" class="text-input" type="text" placeholder="Play a track (YTM link or id)" @keyup.enter="sendTrack" />
          <button class="subtle small" @click="sendTrack">Play</button>
        </div>
      </div>

      <div class="footer">
        <button class="leave" @click="leaveRoom"><span class="material-symbols-outlined">logout</span>Leave room</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.room-container {
  user-select: none;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field .label,
.section-title {
  margin: 0 0 6px 0;
  color: var(--text-muted);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.hint {
  margin: 6px 0 0 0;
  color: var(--text-faint);
  font-size: 12px;
}

.text-input {
  width: 100%;
  box-sizing: border-box;
  background-color: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--bg-control-hover);
  border-radius: 4px;
  padding: 8px 10px;
  outline: none;
}

.text-input:focus {
  border-color: var(--border-strong);
}

.card {
  background-color: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.card-body {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}

button {
  border: none;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 14px;
  background-color: var(--bg-control);
  color: var(--text);
}

button:disabled {
  color: #888888;
  cursor: not-allowed;
}

.primary {
  background-color: var(--accent);
}

.primary:disabled {
  background-color: var(--bg-control);
}

.subtle {
  background-color: transparent;
  border: 1px solid var(--border-strong);
}

.subtle.small {
  padding: 4px 10px;
  font-size: 12px;
}

.setup {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-screen {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
}

.spinning {
  animation: rotation 1s infinite linear;
  font-size: 32px;
}

@keyframes rotation {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(359deg);
  }
}

.error-icon {
  color: var(--accent);
  font-size: 32px;
}

.in-room {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.room-header .room-code-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.room-code {
  font-family: Consolas, monospace;
  font-size: 22px;
  letter-spacing: 0.18em;
  background-color: var(--bg-raised);
  border: 1px solid var(--bg-control-hover);
  border-radius: 6px;
  padding: 4px 10px;
  user-select: all;
}

.room-subtitle {
  margin: 8px 0 0 0;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.listener-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-faint);
}

.listener-count .material-symbols-outlined {
  font-size: 18px;
}

.notice {
  background-color: var(--bg-raised);
  border: 1px solid var(--bg-control-hover);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  padding: 8px 10px;
  color: var(--text-muted);
  font-size: 13px;
}

.notice.suspended {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.notice.streaming {
  display: flex;
  align-items: center;
  gap: 8px;
  border-left-color: var(--success);
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--success);
  flex-shrink: 0;
}

.members .member {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #1a1a1a;
}

.member-name {
  flex-grow: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.you-tag {
  color: var(--text-faint);
  font-size: 12px;
  margin-left: 4px;
}

.badge {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-radius: 3px;
  padding: 2px 6px;
}

.host-badge {
  background-color: var(--accent);
}

.controller-badge {
  background-color: var(--bg-control-hover);
}

.empty {
  color: var(--text-faint);
  font-size: 13px;
  margin: 8px 0 0 0;
}

.icon-button {
  padding: 6px;
  background-color: var(--bg-control);
}

.transport {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.inline-field {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.footer {
  margin-top: auto;
  display: flex;
  justify-content: flex-end;
}

.leave {
  background-color: transparent;
  border: 1px solid var(--accent);
  color: var(--accent);
}
</style>
