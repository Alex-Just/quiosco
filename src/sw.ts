/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, Route, registerRoute } from "workbox-routing";
import { storePendingShare } from "./lib/sharePayload";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);

const shareRoute = new Route(
  ({ request, url }) => request.method === "POST" && url.pathname === "/share",
  async ({ request }) => {
    const formData = await request.formData();
    await storePendingShare({
      title: String(formData.get("title") ?? ""),
      text: String(formData.get("text") ?? ""),
      url: String(formData.get("url") ?? ""),
      receivedAt: Date.now(),
    });
    return Response.redirect(
      new URL("/share", self.location.origin).toString(),
      303,
    );
  },
);

registerRoute(shareRoute);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//],
  }),
);
