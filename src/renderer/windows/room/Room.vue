<script setup lang="ts">
import type { AppWindow } from "../../app-window";
declare const window: AppWindow;
defineOptions({ name: "ListenAlongRoom" });
import { computed, ref } from "vue";
import { otherListenerCount, type AudioIssue, type RoomSnapshot } from "~shared/room-protocol";
import { readRoomSnapshot, readRoomText } from "~shared/validate-room-snapshot";

const memoryStore = window.ytmd.memoryStore;
const store = window.ytmd.store;

const roomsMemory = (all: { rooms?: Record<string, unknown> } | undefined) => all?.rooms ?? {};
const initialMemory = roomsMemory(await memoryStore.get("addonMemory"));

const snapshot = ref<RoomSnapshot | null>(readRoomSnapshot(initialMemory.room));
const joinPrompt = ref<string | null>(readRoomText(initialMemory.joinPrompt));

const savedName = readRoomText((await store.get("addons")).settings.rooms?.displayName);
const displayName = ref<string>(savedName ?? "");
const joinInput = ref<string>(joinPrompt.value ?? "");
const trackInput = ref<string>("");
const seekInput = ref<string>("");
const copied = ref(false);
const showAllMembers = ref(false);

const MEMBER_PREVIEW = 8;
const AUDIO_ISSUE_TEXT = {
  retrying: "Audio to the web stopped. Trying again soon.",
  stopped: "Audio to the web stopped. Turn streaming off and back on in Settings to try again.",
  outdated: "Streaming audio to the web needs a newer version of the app",
} satisfies Record<AudioIssue, string>;

memoryStore.onStateChanged((newState) => {
  const memory = roomsMemory(newState.addonMemory);
  snapshot.value = readRoomSnapshot(memory.room) ?? snapshot.value;
  const prompt = readRoomText(memory.joinPrompt);
  if (prompt !== joinPrompt.value) {
    joinPrompt.value = prompt;
    if (prompt) joinInput.value = prompt;
  }
});

const phase = computed(() => snapshot.value?.phase ?? "idle");
const canSubmitName = computed(() => displayName.value.trim().length > 0);
const isController = computed(() => snapshot.value?.isHost === true || snapshot.value?.role === 1);
const pendingInvite = computed(() => (joinPrompt.value && joinPrompt.value !== snapshot.value?.roomId ? joinPrompt.value : null));
const listenerTotal = computed(() => otherListenerCount(snapshot.value) + 1);
const webListeners = computed(() => snapshot.value?.webListenerCount ?? 0);
const audioIssueText = computed(() => (snapshot.value?.isHost && snapshot.value.audioIssue ? AUDIO_ISSUE_TEXT[snapshot.value.audioIssue] : null));

const members = computed(() => snapshot.value?.members ?? []);
const visibleMembers = computed(() => {
  if (showAllMembers.value || members.value.length <= MEMBER_PREVIEW) return members.value;
  const preview = members.value.slice(0, MEMBER_PREVIEW);
  const you = members.value.find((member) => member.id === snapshot.value?.memberId);
  return you && !preview.includes(you) ? [...preview.slice(0, MEMBER_PREVIEW - 1), you] : preview;
});

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

function acceptInvite() {
  if (!pendingInvite.value || !canSubmitName.value) return;
  window.ytmd.roomJoin(pendingInvite.value, displayName.value.trim());
}

function leaveRoom() {
  window.ytmd.roomLeave();
}

function dismissPrompt() {
  joinPrompt.value = null;
  window.ytmd.roomDismissJoinPrompt();
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
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) return;
  const [first, second] = numbers;
  if (first === undefined || (parts.length === 2 && second === undefined)) return;
  const seconds = second === undefined ? first : first * 60 + second;
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
    <div v-if="pendingInvite" class="card invite">
      <p class="card-title"><span class="material-symbols-outlined">group_add</span>Invitation to {{ pendingInvite }}</p>
      <p class="card-body">
        {{ phase === "idle" ? "Someone shared their room with you." : "Joining this room leaves the one you are in now." }}
      </p>
      <input v-if="!canSubmitName" v-model="displayName" class="text-input" type="text" maxlength="24" placeholder="Pick a name to join with" />
      <div class="invite-actions">
        <button class="primary" :disabled="!canSubmitName" @click="acceptInvite">Join</button>
        <button class="subtle" @click="dismissPrompt">Dismiss</button>
      </div>
    </div>

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
        <input v-model="joinInput" class="text-input" type="text" maxlength="200" placeholder="Room link or 8 letter code" />
        <button class="primary" :disabled="!canSubmitName || !joinCode" @click="joinRoom">Join</button>
      </div>
    </div>

    <div v-else-if="phase === 'connecting'" class="status-screen">
      <span class="material-symbols-outlined spinning">progress_activity</span>
      <p>Connecting to the room service...</p>
      <button class="subtle" @click="leaveRoom">Cancel</button>
    </div>

    <div v-else-if="phase === 'failed'" class="status-screen">
      <span class="material-symbols-outlined error-icon">error</span>
      <p>{{ snapshot?.error ?? "Something went wrong" }}</p>
      <button class="subtle" @click="leaveRoom">Back</button>
    </div>

    <div v-else class="in-room">
      <div class="room-header">
        <div class="room-code-line">
          <span class="room-code">{{ snapshot?.roomId }}</span>
        </div>
        <div class="link-buttons">
          <button class="subtle small" title="Opens the room in a browser" @click="copyShareLink">
            <span class="material-symbols-outlined">{{ copied ? "check" : "link" }}</span
            >{{ copied ? "Copied" : "Copy web link" }}
          </button>
        </div>
        <p class="room-subtitle">
          <span class="room-subtitle-text">{{ snapshot?.isHost ? "You are hosting" : `Following ${snapshot?.hostName ?? "the host"}` }}</span>
          <span class="listener-count"><span class="material-symbols-outlined">headphones</span>{{ listenerTotal }}</span>
        </p>
      </div>

      <div v-if="snapshot?.isHost && snapshot?.audioStreaming" class="notice streaming">
        <span class="live-dot"></span>
        <span>Streaming audio to the web{{ snapshot?.webListenerCount ? ` for ${snapshot.webListenerCount} listening in a browser` : "" }}</span>
      </div>

      <div v-if="audioIssueText" class="notice audio-issue">{{ audioIssueText }}</div>

      <div v-if="snapshot?.error" class="notice">{{ snapshot.error }}</div>

      <div v-if="!snapshot?.isHost && snapshot?.syncStatus === 'suspended'" class="notice suspended">
        <span>{{ snapshot?.syncDetail ?? "Paused following" }}</span>
        <button class="subtle" @click="resumeSync">Resume</button>
      </div>

      <div class="members">
        <p class="section-title">In this room</p>
        <div class="member">
          <span class="member-label"
            ><span class="member-name">{{ snapshot?.isHost ? displayName || "You" : (snapshot?.hostName ?? "Host") }}</span></span
          >
          <span class="badge host-badge">Host</span>
        </div>
        <div v-for="member in visibleMembers" :key="member.id" class="member">
          <span class="member-label">
            <span class="member-name">{{ memberLabel(member.name, member.id) }}</span>
            <span v-if="member.id === snapshot?.memberId" class="you-tag">you</span>
          </span>
          <span v-if="member.role === 1" class="badge controller-badge">Controller</span>
          <template v-if="snapshot?.isHost">
            <button v-if="member.role !== 1" class="subtle small" @click="grant(member.id, 1)">Promote</button>
            <button v-else class="subtle small" @click="grant(member.id, 0)">Demote</button>
          </template>
        </div>
        <div v-if="webListeners > 0" class="member">
          <span class="member-label"
            ><span class="member-name">{{ webListeners === 1 ? "1 listener in a browser" : `${webListeners} listeners in a browser` }}</span></span
          >
          <span class="badge web-badge">Web</span>
        </div>
        <button v-if="members.length > MEMBER_PREVIEW" class="subtle small show-all" @click="showAllMembers = !showAllMembers">
          {{ showAllMembers ? "Show fewer" : `Show all ${members.length}` }}
        </button>
        <p v-if="members.length === 0 && webListeners === 0" class="empty">Nobody else yet. Share the link to invite people.</p>
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
          <input v-model="seekInput" class="text-input" type="text" maxlength="9" placeholder="Seek to mm:ss" @keyup.enter="sendSeek" />
          <button class="subtle small" @click="sendSeek">Seek</button>
        </div>
        <div class="inline-field">
          <input v-model="trackInput" class="text-input" type="text" maxlength="300" placeholder="Play a track (YTM link or id)" @keyup.enter="sendTrack" />
          <button class="subtle small" @click="sendTrack">Play</button>
        </div>
      </div>

      <div class="footer">
        <button class="leave" @click="leaveRoom"><span class="material-symbols-outlined">logout</span>Leave room</button>
      </div>
    </div>
  </div>
</template>

<style scoped src="./room.css"></style>
