package com.pytbyte.geoshua;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {

        registerPlugin(SmsReaderPlugin.class);

        super.onCreate(savedInstanceState);
    }
}