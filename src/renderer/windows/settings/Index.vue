<script setup lang="ts">
import TitleBar from "../../components/TitleBar.vue";
import Settings from "./Settings.vue";
</script>

<template>
  <div class="container">
    <TitleBar class="titlebar" title="Settings" icon="settings" />
    <Suspense>
      <Settings class="settings" />
    </Suspense>
  </div>
</template>

<style scoped>
.settings {
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
