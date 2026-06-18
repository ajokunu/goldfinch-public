// Native-only local Expo module ("WidgetBridge"). The JS API surface lives in
// app/features/widget/WidgetBridge.ts, which resolves this module by its
// registered name via requireOptionalNativeModule('WidgetBridge'). There is
// nothing to export from JS here; this file exists so the module dir is a valid
// TS module and autolinking can pick it up.
export {};
