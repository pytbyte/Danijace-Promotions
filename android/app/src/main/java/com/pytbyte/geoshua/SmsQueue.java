package com.pytbyte.geoshua;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * =========================================================
 * GEO-SHUA
 * LOCAL SMS QUEUE
 * =========================================================
 *
 * Purpose:
 *
 * SMS
 *   ↓
 * Internet unavailable
 *   ↓
 * SmsQueue
 *   ↓
 * Recovery sweep
 *   ↓
 * /api/sms/process
 *
 * =========================================================
 *
 * POC IMPLEMENTATION
 * ---------------------------------------------------------
 *
 * Uses SharedPreferences + JSON.
 *
 * This is intentionally simple for the proof of concept.
 *
 * It is NOT intended to be the final million-device
 * production queue architecture.
 */
public final class SmsQueue {

    private static final String TAG =
        "GeoShuaSmsQueue";

    private static final String PREFS_NAME =
        "geoshua_sms_queue";

    private static final String KEY_PENDING =
        "pending_sms";

    /**
     * Protect the local queue from becoming unbounded.
     */
    private static final int MAX_QUEUE_SIZE =
        500;

    private SmsQueue() {
        // Utility class.
    }

    /* =====================================================
       DATA MODEL
    ===================================================== */

    public static class PendingSms {

        public final String smsId;
        public final String address;
        public final String body;
        public final long date;

        public PendingSms(
            String smsId,
            String address,
            String body,
            long date
        ) {
            this.smsId = smsId;
            this.address = address;
            this.body = body;
            this.date = date;
        }
    }

    /* =====================================================
       ENQUEUE
    ===================================================== */

    public static synchronized void enqueue(
        Context context,
        String smsId,
        String address,
        String body,
        long date
    ) {
        if (context == null) {
            return;
        }

        if (
            smsId == null ||
            smsId.trim().isEmpty()
        ) {
            Log.w(
                TAG,
                "Cannot queue SMS without smsId."
            );

            return;
        }

        if (
            body == null ||
            body.trim().isEmpty()
        ) {
            return;
        }

        if (date <= 0L) {
            return;
        }

        Context applicationContext =
            context.getApplicationContext();

        SharedPreferences preferences =
            applicationContext.getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE
            );

        JSONArray current =
            readArray(preferences);

        /*
         * Idempotent local enqueue.
         *
         * The same SMS must never appear twice in the
         * local pending queue.
         */
        for (int i = 0; i < current.length(); i++) {

            try {
                JSONObject item =
                    current.getJSONObject(i);

                String existingId =
                    item.optString(
                        "smsId",
                        ""
                    );

                if (
                    smsId.equals(existingId)
                ) {
                    return;
                }

            } catch (Exception e) {
                Log.w(
                    TAG,
                    "Unable to inspect queued SMS.",
                    e
                );
            }
        }

        /*
         * Keep the queue bounded.
         *
         * Remove the oldest item if the queue is full.
         */
        while (
            current.length()
                >= MAX_QUEUE_SIZE
        ) {
            JSONArray trimmed =
                new JSONArray();

            for (
                int i = 1;
                i < current.length();
                i++
            ) {
                try {
                    trimmed.put(
                        current.getJSONObject(i)
                    );
                } catch (Exception e) {
                    Log.w(
                        TAG,
                        "Unable to trim SMS queue.",
                        e
                    );
                }
            }

            current = trimmed;
        }

        try {
            JSONObject item =
                new JSONObject();

            item.put(
                "smsId",
                smsId
            );

            item.put(
                "address",
                address
            );

            item.put(
                "body",
                body
            );

            item.put(
                "date",
                date
            );

            item.put(
                "queuedAt",
                System.currentTimeMillis()
            );

            current.put(item);

            preferences
                .edit()
                .putString(
                    KEY_PENDING,
                    current.toString()
                )
                .apply();

            Log.d(
                TAG,
                "SMS queued locally. smsId="
                    + smsId
                    + ", size="
                    + current.length()
            );

        } catch (Exception e) {

            Log.e(
                TAG,
                "Unable to persist SMS queue.",
                e
            );
        }
    }

    /* =====================================================
       GET PENDING
    ===================================================== */

    public static synchronized List<PendingSms> getPending(
        Context context
    ) {
        List<PendingSms> result =
            new ArrayList<>();

        if (context == null) {
            return result;
        }

        Context applicationContext =
            context.getApplicationContext();

        SharedPreferences preferences =
            applicationContext.getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE
            );

        JSONArray array =
            readArray(preferences);

        for (
            int i = 0;
            i < array.length();
            i++
        ) {
            try {

                JSONObject item =
                    array.getJSONObject(i);

                String smsId =
                    item.optString(
                        "smsId",
                        ""
                    );

                String address =
                    item.isNull("address")
                        ? null
                        : item.optString(
                            "address",
                            null
                        );

                String body =
                    item.optString(
                        "body",
                        ""
                    );

                long date =
                    item.optLong(
                        "date",
                        0L
                    );

                if (
                    smsId.isEmpty() ||
                    body.isEmpty() ||
                    date <= 0L
                ) {
                    continue;
                }

                result.add(
                    new PendingSms(
                        smsId,
                        address,
                        body,
                        date
                    )
                );

            } catch (Exception e) {

                Log.w(
                    TAG,
                    "Unable to read queued SMS.",
                    e
                );
            }
        }

        return result;
    }

    /* =====================================================
       REMOVE
    ===================================================== */

    public static synchronized void remove(
        Context context,
        String smsId
    ) {
        if (
            context == null ||
            smsId == null ||
            smsId.trim().isEmpty()
        ) {
            return;
        }

        Context applicationContext =
            context.getApplicationContext();

        SharedPreferences preferences =
            applicationContext.getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE
            );

        JSONArray current =
            readArray(preferences);

        JSONArray remaining =
            new JSONArray();

        boolean removed =
            false;

        for (
            int i = 0;
            i < current.length();
            i++
        ) {
            try {

                JSONObject item =
                    current.getJSONObject(i);

                String existingId =
                    item.optString(
                        "smsId",
                        ""
                    );

                if (
                    smsId.equals(existingId)
                ) {
                    removed = true;
                    continue;
                }

                remaining.put(item);

            } catch (Exception e) {

                Log.w(
                    TAG,
                    "Unable to process queued SMS.",
                    e
                );
            }
        }

        if (!removed) {
            return;
        }

        preferences
            .edit()
            .putString(
                KEY_PENDING,
                remaining.toString()
            )
            .apply();

        Log.d(
            TAG,
            "Queued SMS removed. smsId="
                + smsId
                + ", remaining="
                + remaining.length()
        );
    }

    /* =====================================================
       SIZE
    ===================================================== */

    public static synchronized int size(
        Context context
    ) {
        if (context == null) {
            return 0;
        }

        Context applicationContext =
            context.getApplicationContext();

        SharedPreferences preferences =
            applicationContext.getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE
            );

        return readArray(preferences).length();
    }

    /* =====================================================
       CLEAR
    ===================================================== */

    public static synchronized void clear(
        Context context
    ) {
        if (context == null) {
            return;
        }

        Context applicationContext =
            context.getApplicationContext();

        applicationContext
            .getSharedPreferences(
                PREFS_NAME,
                Context.MODE_PRIVATE
            )
            .edit()
            .remove(KEY_PENDING)
            .apply();

        Log.d(
            TAG,
            "Local SMS queue cleared."
        );
    }

    /* =====================================================
       READ JSON
    ===================================================== */

    private static JSONArray readArray(
        SharedPreferences preferences
    ) {
        String raw =
            preferences.getString(
                KEY_PENDING,
                "[]"
            );

        if (
            raw == null ||
            raw.trim().isEmpty()
        ) {
            return new JSONArray();
        }

        try {
            return new JSONArray(raw);

        } catch (Exception e) {

            Log.e(
                TAG,
                "Corrupt SMS queue detected. Resetting queue.",
                e
            );

            preferences
                .edit()
                .remove(KEY_PENDING)
                .apply();

            return new JSONArray();
        }
    }
}
