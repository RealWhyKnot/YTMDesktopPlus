<script setup lang="ts">
import TitleBar from "./TitleBar.vue";

defineProps<{ title?: string; icon?: string }>();
</script>

<template>
  <div class="container">
    <TitleBar :title="title" :icon="icon" />
    <Suspense>
      <slot />
    </Suspense>
  </div>
</template>

<style scoped>
.container {
  width: 100%;
  height: 100%;
  background-color: var(--bg);
}
</style>
