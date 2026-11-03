<script setup lang="ts">
import type { AppWindow } from "../../app-window";
declare const window: AppWindow;
defineOptions({ name: "MainWindow" });
import { onMounted, ref } from "vue";
import TitleBar from "../../components/TitleBar.vue";
import YTMViewLoading from "../../components/YTMViewLoading.vue";
import logo from "~assets/icons/ytmd_white.png";

const keyboardFocus = ref<HTMLElement | null>(null);
const keyboardFocusZero = ref<HTMLElement | null>(null);

onMounted(() => {
  window.onfocus = () => {
    if (document.activeElement !== keyboardFocusZero.value) {
      keyboardFocusZero.value?.focus();
      keyboardFocusZero.value?.blur();
    }
  };

  if (keyboardFocus.value !== null) {
    keyboardFocus.value.onfocus = () => {
      window.ytmd.switchFocus("ytm");
    };
  }

  window.ytmd.requestWindowState();
});
</script>

<template>
  <div ref="keyboardFocusZero" tabindex="0"></div>
  <Suspense>
    <TitleBar is-main-window has-home-button has-settings-button has-minimize-button has-maximize-button title="YTMDesktop+" :icon-file="logo" />
  </Suspense>
  <Suspense>
    <YTMViewLoading />
  </Suspense>
  <div ref="keyboardFocus" tabindex="32767"></div>
</template>
