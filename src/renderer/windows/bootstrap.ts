import "material-symbols/outlined.css";
import "~assets/app.css";

import { createApp, type Component } from "vue";

export function mountWindow(root: Component): void {
  createApp(root).mount("#app");
}
