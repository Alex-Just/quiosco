/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, Route, registerRoute } from "workbox-routing";
import { storePendingBook, storePendingShare } from "./lib/sharePayload";

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);

const shareRoute = new Route(
  ({ request, url }) => request.method === "POST" && url.pathname === "/share",
  async ({ request }) => {
    try {
      const formData = await request.formData();
      // Android file shares deliver the EPUB in its own field and carry no
      // title/text/url; text shares carry no file. Keep both paths, and never
      // overwrite a pending payload with an empty one.
      const shared = formData.get("epub");
      if (shared instanceof File && shared.size > 0) {
        await storePendingBook(shared);
      }
      const title = String(formData.get("title") ?? "");
      const text = String(formData.get("text") ?? "");
      const url = String(formData.get("url") ?? "");
      if (title || text || url) {
        await storePendingShare({ title, text, url, receivedAt: Date.now() });
      }
    } catch {
      // A failed store must still land the user on the share page
      // ("Nothing received") instead of failing the navigation.
    }
    return Response.redirect(
      new URL("/share", self.location.origin).toString(),
      303,
    );
  },
  "POST",
);

registerRoute(shareRoute);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//],
  }),
);
