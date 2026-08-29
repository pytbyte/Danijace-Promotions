package com.pytbyte.geoshua;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);

        super.onCreate(savedInstanceState);

        handleDeepLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);

        setIntent(intent);

        handleDeepLink(intent);
    }

    private void handleDeepLink(Intent intent) {
        if (intent == null) {
            return;
        }

        if (!Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }

        if (intent.getData() == null) {
            return;
        }

        String url = intent.getData().toString();

        String escapedUrl = JSONObjectEscape(url);

        String javascript =
            "window.dispatchEvent(new CustomEvent(" +
            "'capacitorDeepLink'," +
            "{ detail: " + escapedUrl + " }" +
            "));";

        getBridge()
            .getWebView()
            .evaluateJavascript(javascript, null);
    }

    private String JSONObjectEscape(String value) {
        return "\"" +
            value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t") +
            "\"";
    }
}