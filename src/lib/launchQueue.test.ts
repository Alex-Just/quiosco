import { describe, expect, it, vi } from "vitest";
import {
  acceptLaunchedFile,
  type FileLaunch,
  fileLaunchQueue,
  firstLaunchedFile,
} from "./launchQueue";

const epub = () =>
  new File(["PK"], "book.epub", { type: "application/epub+zip" });

const handleFor = (file: File) => ({ getFile: async () => file });

describe("firstLaunchedFile", () => {
  it("returns the first file when Android hands over several", async () => {
    const book = epub();
    const other = new File(["x"], "notes.txt");

    const file = await firstLaunchedFile({
      files: [handleFor(book), handleFor(other)],
    });

    expect(file).toBe(book);
  });

  it("returns null for a launcher-icon launch with no files", async () => {
    expect(await firstLaunchedFile({})).toBeNull();
    expect(await firstLaunchedFile({ files: [] })).toBeNull();
  });

  it("returns null when the read grant was revoked", async () => {
    // A stale content:// URI must not crash the app or open an empty book.
    const launch: FileLaunch = {
      files: [
        {
          getFile: async () => {
            throw new DOMException("Permission denied", "NotAllowedError");
          },
        },
      ],
    };

    expect(await firstLaunchedFile(launch)).toBeNull();
  });
});

describe("acceptLaunchedFile", () => {
  it("stores a launched book once and reports that one arrived", async () => {
    const book = epub();
    const save = vi.fn(async () => {});

    const accepted = await acceptLaunchedFile(
      { files: [handleFor(book)] },
      save,
    );

    expect(accepted).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(book);
  });

  it("does not touch the pending book for a launch without a file", async () => {
    const save = vi.fn(async () => {});

    expect(await acceptLaunchedFile({}, save)).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("surfaces a storage failure instead of silently dropping the book", async () => {
    const save = vi.fn(async () => {
      throw new Error("quota exceeded");
    });

    await expect(
      acceptLaunchedFile({ files: [handleFor(epub())] }, save),
    ).rejects.toThrow("quota exceeded");
  });
});

describe("fileLaunchQueue", () => {
  it("is absent in browsers without file handling", () => {
    expect(fileLaunchQueue({} as Window & { launchQueue?: never })).toBeNull();
  });

  it("returns the queue when Chrome provides one", () => {
    const setConsumer = vi.fn();
    const queue = { setConsumer };
    const scope = { launchQueue: queue } as unknown as Window & {
      launchQueue: typeof queue;
    };

    expect(fileLaunchQueue(scope)).toBe(queue);
  });
});
