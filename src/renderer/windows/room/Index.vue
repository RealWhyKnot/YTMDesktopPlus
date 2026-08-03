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
  border-top: 1px solid #212121;
  background-color: #000000;
  height: calc(100% - 36px);
}

.container {
  width: 100%;
  height: 100%;
  background-color: #000000;
}
</style>
