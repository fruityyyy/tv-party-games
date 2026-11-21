package com.sequence.tv;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** Runs the game server (server.js) on the TV with the embedded Node.js runtime. */
final class NodeRunner {
    private static final String TAG = "SequenceNode";
    private static final String PROJECT = "nodejs-project";
    private static boolean started = false;

    static {
        System.loadLibrary("node");
        System.loadLibrary("native-lib");
    }

    private static native int startNode(String[] args);

    /** Node can only start once per process, so later calls do nothing. */
    static synchronized void start(Context ctx, String publicUrl) {
        if (started) return;
        started = true;
        File dir = new File(ctx.getFilesDir(), PROJECT);
        String[] args = {"node", new File(dir, "server.js").getAbsolutePath(), "--public-url=" + publicUrl};
        // Copying ~1,300 files takes a few seconds, so it happens here rather than on the UI thread.
        // Node needs a large stack.
        new Thread(null, () -> {
            try {
                copyProjectIfUpdated(ctx, dir);
            } catch (IOException e) {
                Log.e(TAG, "Couldn't copy the game files", e);
            }
            Log.i(TAG, "Starting server with " + publicUrl);
            int code = startNode(args);
            Log.e(TAG, "Node exited with code " + code);
        }, "node", 16 * 1024 * 1024).start();
    }

    // Copies the bundled game files out of the APK on first launch and after each update.
    private static void copyProjectIfUpdated(Context ctx, File dir) throws IOException {
        SharedPreferences prefs = ctx.getSharedPreferences("node", Context.MODE_PRIVATE);
        long installed;
        try {
            PackageInfo info = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            installed = info.lastUpdateTime;
        } catch (Exception e) {
            installed = -1;
        }
        if (dir.exists() && prefs.getLong("copiedAt", 0) == installed) return;
        deleteRecursive(dir);
        copyAssetDir(ctx.getAssets(), PROJECT, dir);
        prefs.edit().putLong("copiedAt", installed).apply();
    }

    private static void copyAssetDir(AssetManager assets, String path, File target) throws IOException {
        String[] children = assets.list(path);
        if (children == null || children.length == 0) {
            target.getParentFile().mkdirs();
            try (InputStream in = assets.open(path); OutputStream out = new FileOutputStream(target)) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return;
        }
        target.mkdirs();
        for (String child : children) copyAssetDir(assets, path + "/" + child, new File(target, child));
    }

    private static void deleteRecursive(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        f.delete();
    }

    private NodeRunner() {}
}
