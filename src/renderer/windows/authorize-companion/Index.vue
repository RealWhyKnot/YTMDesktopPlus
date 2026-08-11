<script setup lang="ts">
import TitleBar from "../../components/TitleBar.vue";
import Auth from "./Auth.vue";
</script>

<template>
  <div class="container">
    <TitleBar class="titlebar" />
    <Auth class="auth"></Auth>
  </div>
</template>

<style scoped>
.auth {
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
