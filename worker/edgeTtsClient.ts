/**
 * Worker-native Microsoft Edge neural TTS client (unofficial read-aloud API).
 * Protocol mirrors the isomorphic edge-tts clients used on Cloudflare Workers.
 */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WIN_EPOCH_SECONDS = 11_644_473_600;
const CLOCK_ROUND_SECONDS = 300;
const WINDOWS_TICKS_PER_SECOND = 10_000_000;
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".", 1)[0] ?? "143";
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const WSS_BASE =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const TTS_TIMEOUT_MS = 30_000;

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function removeIncompatibleCharacters(text: string): string {
  return Array.from(text, (char) => {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0 && code <= 8) ||
      (code >= 11 && code <= 12) ||
      (code >= 14 && code <= 31)
    ) {
      return " ";
    }
    return char;
  }).join("");
}

function connectId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function dateToString(): string {
  return new Date().toString();
}

async function generateSecMsGec(): Promise<string> {
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH_SECONDS;
  ticks -= ticks % CLOCK_ROUND_SECONDS;
  const windowsTicks = BigInt(ticks) * BigInt(WINDOWS_TICKS_PER_SECOND);
  const input = `${windowsTicks.toString()}${TRUSTED_CLIENT_TOKEN}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function buildSsml(text: string, voice: string): string {
  const cleaned = escapeXml(removeIncompatibleCharacters(text));
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='es-ES'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='+0Hz' rate='+0%' volume='+0%'>${cleaned}</prosody>` +
    `</voice></speak>`
  );
}

function ssmlMessage(
  requestId: string,
  timestamp: string,
  ssml: string,
): string {
  return (
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${timestamp}Z\r\n` +
    `Path:ssml\r\n\r\n` +
    ssml
  );
}

function configMessage(timestamp: string): string {
  return (
    `X-Timestamp:${timestamp}\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: "false",
              wordBoundaryEnabled: "false",
            },
            outputFormat: OUTPUT_FORMAT,
          },
        },
      },
    })
  );
}

function parseBinaryHeaders(message: Uint8Array): {
  path: string | null;
  contentType: string | null;
  body: Uint8Array;
} {
  const first = message.at(0);
  const second = message.at(1);
  if (first === undefined || second === undefined) {
    return { path: null, contentType: null, body: message };
  }
  const headerLength = (first << 8) | second;
  const headerBytes = message.slice(2, 2 + headerLength);
  const headerText = new TextDecoder().decode(headerBytes);
  const headers: Record<string, string> = {};
  for (const line of headerText.split("\r\n")) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    headers[line.slice(0, index)] = line.slice(index + 1).trim();
  }
  return {
    path: headers.Path ?? null,
    contentType: headers["Content-Type"] ?? null,
    body: message.slice(2 + headerLength),
  };
}

type WorkerWebSocket = {
  accept: () => void;
  send: (data: string | ArrayBuffer) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (
    type: string,
    listener: (event: MessageEvent | Event) => void,
  ) => void;
};

/**
 * Open an outbound WebSocket the Cloudflare Workers way (fetch Upgrade).
 * Injectable in tests via opts.fetchFn.
 */
async function openEdgeSocket(
  url: string,
  fetchFn: typeof fetch,
): Promise<WorkerWebSocket> {
  const response = await fetchFn(url, {
    headers: {
      Upgrade: "websocket",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "User-Agent":
        `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
        `(KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 ` +
        `Edg/${CHROMIUM_MAJOR}.0.0.0`,
      Cookie: `muid=${connectId().toUpperCase().slice(0, 32)};`,
    },
  });
  const socket = (response as Response & { webSocket?: WorkerWebSocket })
    .webSocket;
  if (!socket) {
    throw new Error(`Edge TTS websocket upgrade failed: ${response.status}`);
  }
  socket.accept();
  return socket;
}

/** Synthesize MP3 bytes for one utterance via Edge neural TTS. */
export async function synthesizeEdgeMp3(
  text: string,
  voice: string,
  fetchFn: typeof fetch = fetch,
): Promise<Uint8Array> {
  const secMsGec = await generateSecMsGec();
  const requestId = connectId();
  const url =
    `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
    `&ConnectionId=${requestId}`;

  const socket = await openEdgeSocket(url, fetchFn);
  const chunks: Uint8Array[] = [];
  const timestamp = dateToString();

  const done = new Promise<Uint8Array>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Edge TTS timed out"));
    }, TTS_TIMEOUT_MS);

    const finish = (error?: Error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else {
        const total = chunks.reduce((sum, part) => sum + part.length, 0);
        if (total === 0) {
          reject(new Error("Edge TTS returned no audio"));
          return;
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (const part of chunks) {
          out.set(part, offset);
          offset += part.length;
        }
        resolve(out);
      }
    };

    socket.addEventListener("message", (event) => {
      const messageEvent = event as MessageEvent;
      const data = messageEvent.data;
      if (typeof data === "string") {
        if (data.includes("Path:turn.end")) {
          socket.close();
          finish();
        }
        return;
      }
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data instanceof Uint8Array
            ? data
            : null;
      if (!bytes) return;
      const { path, contentType, body } = parseBinaryHeaders(bytes);
      if (path === "audio" && contentType === "audio/mpeg" && body.length > 0) {
        chunks.push(body);
      }
    });

    socket.addEventListener("error", () => {
      finish(new Error("Edge TTS websocket error"));
    });
  });

  socket.send(configMessage(timestamp));
  socket.send(ssmlMessage(requestId, timestamp, buildSsml(text, voice)));
  return done;
}
