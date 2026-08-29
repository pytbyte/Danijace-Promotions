package com.pytbyte.geoshua;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);

        super.onCreate(savedInstanceState);

        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);

        setIntent(intent);

        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        String action = intent.getAction();

        if (Intent.ACTION_VIEW.equals(action)) {
            String url = intent.getDataString();

            if (url != null) {
                getBridge().getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('capacitorDeepLink', { detail: " +
                    JSONObjectEscape(url) +
                    " }));",
                    null
                );
            }
        }
    }

    private String JSONObjectEscape(String value) {
        return "\"" +
            value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r") +
            "\"";
    }
}