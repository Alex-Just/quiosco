/*
 * Copyright 2020 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package xyz.alexjust.quiosco;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

public class LauncherActivity
        extends com.google.androidbrowserhelper.trusted.LauncherActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Intent intent = getIntent();
        String epubType = epubType(intent);
        if (epubType != null) {
            setIntent(asShare(intent, epubType));
        }

        super.onCreate(savedInstanceState);
        // Setting an orientation crashes the app due to the transparent background on Android 8.0
        // Oreo and below. We only set the orientation on Oreo and above. This only affects the
        // splash screen and Chrome will still respect the orientation.
        // See https://github.com/GoogleChromeLabs/bubblewrap/issues/496 for details.
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.O) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
    }

    /**
     * Chrome for Android does not implement the File Handling API, so a VIEW
     * intent's file would never reach the page through the file handler action
     * URL. The TWA share target is supported on Android, so route the opened
     * EPUB through it instead; the web app already handles that path.
     *
     * @return the EPUB MIME type for a VIEW of a {@code content://} EPUB, or
     *     null when this is not such an intent. Some senders omit the type;
     *     the content provider can still supply it.
     */
    private String epubType(Intent intent) {
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return null;
        Uri data = intent.getData();
        if (data == null || !"content".equals(data.getScheme())) return null;

        String type = intent.getType();
        if (type == null) {
            type = intent.resolveType(getContentResolver());
        }
        return "application/epub+zip".equalsIgnoreCase(type) ? type : null;
    }

    private static Intent asShare(Intent viewIntent, String type) {
        // Copy the original intent so its launch flags, component and data URI
        // survive. setDataAndType keeps the URI and makes a provider-resolved
        // type explicit for the share target.
        Intent share = new Intent(viewIntent);
        share.setAction(Intent.ACTION_SEND);
        share.setDataAndType(viewIntent.getData(), type);
        share.putExtra(Intent.EXTRA_STREAM, viewIntent.getData());
        share.addCategory(Intent.CATEGORY_DEFAULT);
        share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return share;
    }

    @Override
    protected Uri getLaunchingUrl() {
        // Get the original launch Url.
        Uri uri = super.getLaunchingUrl();

        return uri;
    }
}
