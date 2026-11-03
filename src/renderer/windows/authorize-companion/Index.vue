<script setup lang="ts">
defineOptions({ name: "AuthorizationWindow" });
import WindowShell from "../../components/WindowShell.vue";
import Auth from "./Auth.vue";
</script>

<template>
  <WindowShell>
    <Auth class="window-content" />
  </WindowShell>
</template>
