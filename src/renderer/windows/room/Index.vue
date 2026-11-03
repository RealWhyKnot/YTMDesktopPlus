<script setup lang="ts">
defineOptions({ name: "RoomWindow" });
import WindowShell from "../../components/WindowShell.vue";
import Room from "./Room.vue";
</script>

<template>
  <WindowShell title="Listen Along" icon="graphic_eq">
    <Room class="window-content" />
  </WindowShell>
</template>
