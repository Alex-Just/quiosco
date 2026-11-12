// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Digital Asset Links are what let Chrome hand a launched EPUB to the site.
 * A mismatch between the APK's package/signing key and this public file fails
 * silently at runtime (the TWA opens, the file never arrives), so the two
 * are checked together here instead of at first install.
 *
 * cwd-relative on purpose: Vite rewrites import.meta.url under test.
 */
const assetLinks = JSON.parse(
  readFileSync("public/.well-known/assetlinks.json", "utf8"),
) as Array<{
  relation: string[];
  target: {
    namespace: string;
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
}>;

const twaManifest = JSON.parse(
  readFileSync("android/twa-manifest.json", "utf8"),
) as {
  packageId: string;
  host: string;
  fingerprints: Array<{ name: string; value: string }>;
  fileHandlers: Array<{ actionUrl: string; mimeTypes: string[] }>;
};

const statement = assetLinks[0];

describe("assetlinks.json", () => {
  it("grants handle_all_urls to one Android app", () => {
    expect(assetLinks).toHaveLength(1);
    expect(statement?.relation).toContain(
      "delegate_permission/common.handle_all_urls",
    );
    expect(statement?.target.namespace).toBe("android_app");
  });

  it("names the package the APK is built with", () => {
    expect(statement?.target.package_name).toBe(twaManifest.packageId);
  });

  it("publishes the release certificate the APK is signed with", () => {
    const published = statement?.target.sha256_cert_fingerprints ?? [];
    const release = twaManifest.fingerprints.find(
      (fingerprint) => fingerprint.name === "release",
    );

    expect(release).toBeDefined();
    expect(published).toEqual([release?.value]);
  });
});

describe("twa-manifest.json", () => {
  it("opens EPUBs on the Add page of the production host", () => {
    expect(twaManifest.fileHandlers).toEqual([
      {
        actionUrl: `https://${twaManifest.host}/add`,
        mimeTypes: ["application/epub+zip"],
      },
    ]);
  });
});
