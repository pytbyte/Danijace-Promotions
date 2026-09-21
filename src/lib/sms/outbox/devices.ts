import type { ObjectId } from "mongodb";

import clientPromise from "@/lib/mongodb/index";

const DB_NAME = "geo-shua";
const COLLECTION_NAME = "smsOutboxDevices";

export type SmsDevicePlatform = "android";

export interface SmsDeviceDocument {
  _id?: ObjectId;
  deviceId: string;
  token: string;
  platform: SmsDevicePlatform;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

export interface RegisterSmsDeviceInput {
  deviceId: string;
  token: string;
  platform?: SmsDevicePlatform;
}

async function getCollection() {
  const client = await clientPromise;

  return client
    .db(DB_NAME)
    .collection<SmsDeviceDocument>(COLLECTION_NAME);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }

  return value.trim();
}

export async function registerSmsDevice(
  input: RegisterSmsDeviceInput,
): Promise<SmsDeviceDocument> {
  const deviceId = requireString(input.deviceId, "deviceId");
  const token = requireString(input.token, "token");
  const platform = input.platform ?? "android";

  if (platform !== "android") {
    throw new Error("Unsupported SMS device platform.");
  }

  const collection = await getCollection();
  const now = new Date();

  await collection.updateOne(
    { deviceId },
    {
      $set: {
        token,
        platform,
        enabled: true,
        updatedAt: now,
        lastSeenAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const device = await collection.findOne({ deviceId });

  if (!device) {
    throw new Error("SMS device registration failed.");
  }

  return device;
}

export async function getActiveSmsDevices(): Promise<
  SmsDeviceDocument[]
> {
  const collection = await getCollection();

  return collection
    .find({
      enabled: true,
      token: { $type: "string" },
    })
    .toArray();
}

export async function getActiveSmsDeviceTokens(): Promise<string[]> {
  const devices = await getActiveSmsDevices();

  return [
    ...new Set(
      devices
        .map((device) => device.token.trim())
        .filter(Boolean),
    ),
  ];
}

export async function disableSmsDevice(
  deviceId: string,
): Promise<boolean> {
  const normalizedDeviceId = requireString(deviceId, "deviceId");
  const collection = await getCollection();

  const result = await collection.updateOne(
    { deviceId: normalizedDeviceId },
    {
      $set: {
        enabled: false,
        updatedAt: new Date(),
      },
    },
  );

  return result.modifiedCount > 0;
}

export async function disableSmsDeviceToken(
  token: string,
): Promise<boolean> {
  const normalizedToken = requireString(token, "token");
  const collection = await getCollection();

  const result = await collection.updateOne(
    { token: normalizedToken },
    {
      $set: {
        enabled: false,
        updatedAt: new Date(),
      },
    },
  );

  return result.modifiedCount > 0;
}

export async function touchSmsDevice(
  deviceId: string,
): Promise<boolean> {
  const normalizedDeviceId = requireString(deviceId, "deviceId");
  const collection = await getCollection();
  const now = new Date();

  const result = await collection.updateOne(
    { deviceId: normalizedDeviceId },
    {
      $set: {
        updatedAt: now,
        lastSeenAt: now,
      },
    },
  );

  return result.matchedCount > 0;
}
