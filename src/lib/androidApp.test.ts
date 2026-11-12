// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Digital Asset Links make the APK a verified Trusted Web Activity. A mismatch
 * between the APK's package/signing key and this public file fails silently at
 * runtime (the app opens as a browser tab), so the two are checked together
 * here instead of at first install.
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

describe("AndroidManifest.xml", () => {
  const androidManifest = readFileSync(
    "android/app/src/main/AndroidManifest.xml",
    "utf8",
  );

  it("declares the component android-browser-helper enables at launch", () => {
    // The helper calls setComponentEnabledSetting() on this component on every
    // launch. If Bubblewrap omits it, the app crashes before Chrome opens.
    expect(androidManifest).toContain(
      'android:name="com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity"',
    );
  });

  it("carries the share target on the EPUB intent alias", () => {
    // Chrome for Android has no launchQueue, so the launcher re-dispatches the
    // opened file as ACTION_SEND and needs the share target metadata here.
    const alias = androidManifest.slice(
      androidManifest.indexOf('android:name="FileHandlingActivity0"'),
      androidManifest.indexOf("</activity-alias>"),
    );

    expect(alias).toContain("FILE_HANDLING_ACTION_URL");
    expect(alias).toContain(
      "android.support.customtabs.trusted.METADATA_SHARE_TARGET",
    );
  });
});
