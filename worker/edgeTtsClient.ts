/**
 * Worker-native Microsoft Edge neural TTS client (unofficial read-aloud API).
 * Uses the Cognitive Services websocket host (same token as Edge Read Aloud).
 * The older speech.platform.bing.com host now requires a Sec-MS-GEC v2 digest;
 * this host still accepts the v1 SHA-256 token used below.
 */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WIN_EPOCH_SECONDS = 11_644_473_600;
const CLOCK_ROUND_SECONDS = 300;
const WINDOWS_TICKS_PER_SECOND = 10_000_000;
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".", 1)[0] ?? "143";
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
/**
 * Prefer the msedgeservices host; Bing readaloud now rejects the v1 GEC token.
 * Workers outbound websockets use https:// (not wss://) with Upgrade: websocket.
 */
const WSS_BASE =
  "https://api.msedgeservices.com/tts/cognitiveservices/websocket/v1";
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
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="es-ES">` +
    `<voice name="${voice}">` +
    `<prosody rate="default" pitch="default" volume="default">${cleaned}</prosody>` +
    `</voice></speak>`
  );
}

function ssmlMessage(requestId: string, ssml: string): string {
  return (
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `Path:ssml\r\n\r\n` +
    ssml
  );
}

function configMessage(): string {
  return (
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

const AUDIO_PATH_MARKER = "Path:audio\r\n";

/** Pull MP3 bytes from an Edge TTS binary websocket frame. */
function extractAudioChunk(message: Uint8Array): Uint8Array | null {
  const first = message.at(0);
  const second = message.at(1);
  if (first !== undefined && second !== undefined) {
    const headerLength = (first << 8) | second;
    if (headerLength > 0 && headerLength + 2 <= message.length) {
      const headerText = new TextDecoder().decode(
        message.slice(2, 2 + headerLength),
      );
      if (
        headerText.includes("Path:audio") &&
        headerText.includes("audio/mpeg")
      ) {
        const body = message.slice(2 + headerLength);
        return body.length > 0 ? body : null;
      }
    }
  }
  // Fallback used by node-edge-tts: scan for the path marker.
  const markerBytes = new TextEncoder().encode(AUDIO_PATH_MARKER);
  const index = indexOfBytes(message, markerBytes);
  if (index === -1) return null;
  const body = message.slice(index + markerBytes.length);
  return body.length > 0 ? body : null;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

async function messageToBytes(
  data: unknown,
): Promise<Uint8Array | "text" | null> {
  if (typeof data === "string") return "text";
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  return null;
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
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
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
    `${WSS_BASE}?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  const socket = await openEdgeSocket(url, fetchFn);
  const chunks: Uint8Array[] = [];

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
      void (async () => {
        const messageEvent = event as MessageEvent;
        const converted = await messageToBytes(messageEvent.data);
        if (converted === "text") {
          if (String(messageEvent.data).includes("Path:turn.end")) {
            socket.close();
            finish();
          }
          return;
        }
        if (!converted) return;
        const body = extractAudioChunk(converted);
        if (body) chunks.push(body);
      })();
    });

    socket.addEventListener("error", () => {
      finish(new Error("Edge TTS websocket error"));
    });
  });

  socket.send(configMessage());
  socket.send(ssmlMessage(requestId, buildSsml(text, voice)));
  return done;
}
