<script setup lang="ts">
import TitleBar from "../../components/TitleBar.vue";
import Room from "./Room.vue";
</script>

<template>
  <div class="container">
    <TitleBar class="titlebar" title="Listen Along" icon="graphic_eq" />
    <Suspense>
      <Room class="room" />
    </Suspense>
  </div>
</template>

<style scoped>
.room {
  border-top: 1px solid var(--border);
  background-color: var(--bg);
  height: calc(100% - var(--titlebar-height));
}

.container {
  width: 100%;
  height: 100%;
  background-color: var(--bg);
}
</style>
