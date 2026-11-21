package com.sequence.tv;

import android.app.Activity;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkRequest;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.URL;
import java.net.URLEncoder;

/** Full-screen TV board. The game server runs on the TV itself; phones join over Wi-Fi. */
public class MainActivity extends Activity {
    private static final int PORT = 3000;
    // "localhost", not 127.0.0.1: YouTube refuses to play embedded videos on pages from a bare IP.
    private static final String LOCAL = "http://localhost:" + PORT;

    private WebView web;
    private TextView status;
    private final Handler main = new Handler(Looper.getMainLooper());
    private String currentIp;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(15, 58, 40));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(15, 58, 40));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient());
        // The YouTube player in the side panel needs its own cookies to load reliably.
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setVisibility(View.INVISIBLE);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        status = new TextView(this);
        status.setTextColor(Color.rgb(232, 239, 233));
        status.setTextSize(28);
        status.setGravity(Gravity.CENTER);
        status.setText("Starting Sequence…");
        root.addView(status, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        hideSystemUi();

        startWhenOnline(0);
    }

    // The QR code needs the TV's network address, which can take a moment after boot.
    private void startWhenOnline(int attempt) {
        String ip = lanIp();
        if (ip != null) {
            currentIp = ip;
            NodeRunner.start(getApplicationContext(), "http://" + ip + ":" + PORT);
            waitForServer(0);
            watchNetwork();
        } else if (attempt < 60) {
            status.setText("Waiting for the network…");
            main.postDelayed(() -> startWhenOnline(attempt + 1), 1000);
        } else {
            status.setText("Connect the TV to Wi-Fi or Ethernet, then reopen Sequence.");
        }
    }

    // Polls until the game server answers, then shows the board.
    private void waitForServer(int attempt) {
        new Thread(() -> {
            boolean up = false;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(LOCAL + "/api/info").openConnection();
                c.setConnectTimeout(500);
                c.setReadTimeout(500);
                up = c.getResponseCode() == 200;
                c.disconnect();
            } catch (Exception ignored) {
            }
            boolean ready = up;
            main.post(() -> {
                if (ready) {
                    web.loadUrl(LOCAL + "/tv");
                    web.setVisibility(View.VISIBLE);
                    status.setVisibility(View.GONE);
                } else if (attempt > 120) {
                    status.setText("The game server didn't start. Restart the app.");
                } else {
                    main.postDelayed(() -> waitForServer(attempt + 1), 500);
                }
            });
        }).start();
    }

    // When the TV joins another Wi-Fi (or gets a new address), tell the game so the QR code follows.
    private void watchNetwork() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        cm.registerNetworkCallback(new NetworkRequest.Builder().build(), new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network n) {
                main.postDelayed(MainActivity.this::checkAddress, 1500);
            }

            @Override
            public void onLinkPropertiesChanged(Network n, LinkProperties p) {
                main.post(MainActivity.this::checkAddress);
            }
        });
    }

    private void checkAddress() {
        String ip = lanIp();
        if (ip == null || ip.equals(currentIp)) return;
        currentIp = ip;
        String url = "http://" + ip + ":" + PORT;
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(LOCAL + "/api/public-url?url=" + URLEncoder.encode(url, "UTF-8")).openConnection();
                c.setConnectTimeout(2000);
                c.setReadTimeout(2000);
                c.getResponseCode();
                c.disconnect();
            } catch (Exception ignored) {
            }
        }).start();
    }

    // The TV's address on the local network, which goes into the QR code.
    // Prefers the active network, then any other connected one.
    private String lanIp() {
        ConnectivityManager cm = getSystemService(ConnectivityManager.class);
        Network active = cm.getActiveNetwork();
        String ip = ipv4Of(cm, active);
        if (ip != null) return ip;
        for (Network n : cm.getAllNetworks()) {
            ip = ipv4Of(cm, n);
            if (ip != null) return ip;
        }
        return null;
    }

    private static String ipv4Of(ConnectivityManager cm, Network net) {
        LinkProperties props = net == null ? null : cm.getLinkProperties(net);
        if (props == null) return null;
        for (LinkAddress a : props.getLinkAddresses()) {
            if (a.getAddress() instanceof Inet4Address && !a.getAddress().isLoopbackAddress()) {
                return a.getAddress().getHostAddress();
            }
        }
        return null;
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }
}
