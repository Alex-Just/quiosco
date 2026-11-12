import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { acceptLaunchedFile, fileLaunchQueue } from "../lib/launchQueue";
import { log } from "../lib/log";
import { storePendingBook } from "../lib/sharePayload";

/**
 * Receives an EPUB opened from Android's "Open with" chooser.
 *
 * The Trusted Web Activity hands the file to this page and the Add page takes
 * over. A cold launch starts on /add; a warm one is moved there.
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
