import { registerPlugin } from "@capacitor/core";

export interface SmsPermissionResult {
granted: boolean;
}

export interface SmsSubscription {
subscriptionId: number;
simSlotIndex: number;
carrierName?: string;
}

export interface SmsSubscriptionsResult {
subscriptions: SmsSubscription[];
}

export interface SendSmsOptions {
phone: string;
message: string;
subscriptionId?: number;
}

export interface SendSmsResult {
success: boolean;
accepted?: boolean;
multipart?: boolean;
parts?: number;
completedParts?: number;
errorCode?: number;
error?: string;
}

interface NativeSmsSenderPlugin {
requestPermission(): Promise<SmsPermissionResult>;

checkPermission(): Promise<SmsPermissionResult>;

requestPermissions(): Promise<SmsPermissionResult>;

checkPermissions(): Promise<SmsPermissionResult>;

requestPhonePermission(): Promise<SmsPermissionResult>;

checkPhonePermission(): Promise<SmsPermissionResult>;

getSubscriptions(): Promise<SmsSubscriptionsResult>;

send(
options: SendSmsOptions
): Promise<SendSmsResult>;
}

const NativeSmsSender =
registerPlugin<NativeSmsSenderPlugin>(
"SmsSender"
);

const SmsSender = {
async requestPermission(): Promise<SmsPermissionResult> {
return NativeSmsSender.requestPermission();
},

async checkPermission(): Promise<SmsPermissionResult> {
return NativeSmsSender.checkPermission();
},

async requestPermissions(): Promise<SmsPermissionResult> {
return NativeSmsSender.requestPermissions();
},

async checkPermissions(): Promise<SmsPermissionResult> {
return NativeSmsSender.checkPermissions();
},

async requestPhonePermission(): Promise<SmsPermissionResult> {
return NativeSmsSender.requestPhonePermission();
},

async checkPhonePermission(): Promise<SmsPermissionResult> {
return NativeSmsSender.checkPhonePermission();
},

async getSubscriptions(): Promise<SmsSubscriptionsResult> {
return NativeSmsSender.getSubscriptions();
},

async send(
options: SendSmsOptions
): Promise<SendSmsResult> {
return NativeSmsSender.send(options);
},
};

export default SmsSender;
