import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { acceptLaunchedFile, fileLaunchQueue } from "../lib/launchQueue";
import { log } from "../lib/log";
import { storePendingBook } from "../lib/sharePayload";

/**
 * Receives an EPUB from browsers that implement the File Handling API.
 *
 * Chrome for Android does not implement it, so the Android wrapper forwards
 * "Open with" EPUBs through the share target instead. This remains a
 * progressive enhancement for browsers that do support `launchQueue`.
 */
export function LaunchQueueHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    const queue = fileLaunchQueue();
    if (!queue) return;

    queue.setConsumer((launch) => {
      void acceptLaunchedFile(launch, storePendingBook)
        .then((accepted) => {
          if (!accepted) return;
          navigate("/add", { replace: true, state: { fromBookShare: true } });
        })
        .catch((error: unknown) => {
          log.warn("launch", "Could not open the launched book", {
            error: String(error),
          });
        });
    });
  }, [navigate]);

  return null;
}
