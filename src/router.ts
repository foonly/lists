import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "home",
    component: () => import("@/views/HomeView.vue"),
  },
  {
    path: "/list/:syncId",
    name: "list",
    component: () => import("@/views/ListView.vue"),
  },
  {
    path: "/settings",
    name: "settings",
    component: () => import("@/views/SettingsView.vue"),
  },
  {
    path: "/setup",
    name: "setup",
    component: () => import("@/views/SetupView.vue"),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const { useAppStore } = await import("@/stores/app");
  const appStore = useAppStore();

  if (!appStore.initialized) {
    await appStore.init();
  }

  if (!appStore.isSetUp && to.name !== "setup") {
    return { name: "setup" };
  }

  if (appStore.isSetUp && to.name === "setup") {
    return { name: "home" };
  }
});

export default router;
