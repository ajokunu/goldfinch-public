"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_config_plugins = require("@expo/config-plugins");
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
const ANDROID_PACKAGE = "com.goldfinch.app";
const WIDGET_PACKAGE = `${ANDROID_PACKAGE}.widget`;
const RECEIVER_CLASS = `${WIDGET_PACKAGE}.GoldFinchWidgetReceiver`;
const PROVIDER_INFO_RES = "@xml/goldfinch_widget_info";
const DESCRIPTION_STRING_NAME = "goldfinch_widget_description";
const DESCRIPTION_STRING_VALUE = "GoldFinch weekly spending";
const GLANCE_VERSION = "1.1.1";
const COMPOSE_RUNTIME_VERSION = "1.5.0";
const KOTLIN_SOURCES = [
  "GoldFinchWidget.kt",
  "GoldFinchWidgetReceiver.kt",
  "WidgetDataClasses.kt"
];
const PROVIDER_INFO_FILE = "goldfinch_widget_info.xml";
const templatesDir = path.join(__dirname, "templates");
const withWidgetReceiver = (config) => (0, import_config_plugins.withAndroidManifest)(config, (cfg) => {
  const app = import_config_plugins.AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
  app.receiver = app.receiver ?? [];
  const already = app.receiver.some(
    (r) => r.$?.["android:name"] === RECEIVER_CLASS
  );
  if (!already) {
    app.receiver.push({
      $: {
        "android:name": RECEIVER_CLASS,
        "android:exported": "true",
        "android:label": DESCRIPTION_STRING_VALUE
      },
      "intent-filter": [
        {
          action: [
            { $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }
          ]
        }
      ],
      "meta-data": [
        {
          $: {
            "android:name": "android.appwidget.provider",
            "android:resource": PROVIDER_INFO_RES
          }
        }
      ]
    });
  }
  return cfg;
});
const withWidgetStrings = (config) => (0, import_config_plugins.withStringsXml)(config, (cfg) => {
  cfg.modResults = import_config_plugins.AndroidConfig.Strings.setStringItem(
    [
      {
        $: { name: DESCRIPTION_STRING_NAME, translatable: "false" },
        _: DESCRIPTION_STRING_VALUE
      }
    ],
    cfg.modResults
  );
  return cfg;
});
const GRADLE_MARKER = "// goldfinch-weekly-spend-widget (Glance) \u2014 managed block";
const withWidgetGradle = (config) => (0, import_config_plugins.withAppBuildGradle)(config, (cfg) => {
  if (cfg.modResults.language !== "groovy") {
    throw new Error(
      "withWeeklySpendWidget: expected a Groovy app/build.gradle; got " + cfg.modResults.language
    );
  }
  if (cfg.modResults.contents.includes(GRADLE_MARKER)) {
    return cfg;
  }
  const block = [
    "",
    GRADLE_MARKER,
    // Kotlin 2.0+ (RN 0.81 / Expo SDK 54) drives Compose via the compiler
    // Gradle plugin; kotlinCompilerExtensionVersion is obsolete and errors there.
    "apply plugin: 'org.jetbrains.kotlin.plugin.compose'",
    "android {",
    "    buildFeatures {",
    "        compose true",
    "    }",
    "}",
    "dependencies {",
    `    implementation 'androidx.glance:glance-appwidget:${GLANCE_VERSION}'`,
    `    implementation 'androidx.glance:glance-material3:${GLANCE_VERSION}'`,
    `    implementation 'androidx.compose.runtime:runtime:${COMPOSE_RUNTIME_VERSION}'`,
    "}",
    "// end goldfinch-weekly-spend-widget",
    ""
  ].join("\n");
  cfg.modResults.contents = `${cfg.modResults.contents}
${block}`;
  return cfg;
});
const withWidgetNativeSources = (config) => (0, import_config_plugins.withDangerousMod)(config, [
  "android",
  (cfg) => {
    const projectRoot = cfg.modRequest.platformProjectRoot;
    const javaDir = path.join(
      projectRoot,
      "app",
      "src",
      "main",
      "java",
      ...WIDGET_PACKAGE.split(".")
    );
    const resXmlDir = path.join(projectRoot, "app", "src", "main", "res", "xml");
    fs.mkdirSync(javaDir, { recursive: true });
    fs.mkdirSync(resXmlDir, { recursive: true });
    for (const source of KOTLIN_SOURCES) {
      fs.copyFileSync(
        path.join(templatesDir, source),
        path.join(javaDir, source)
      );
    }
    fs.copyFileSync(
      path.join(templatesDir, PROVIDER_INFO_FILE),
      path.join(resXmlDir, PROVIDER_INFO_FILE)
    );
    return cfg;
  }
]);
// `apply plugin: 'org.jetbrains.kotlin.plugin.compose'` (in app/build.gradle, above)
// only works if the compose compiler plugin is on the ROOT buildscript classpath.
// Its version MUST match the project's Kotlin version (Expo SDK 54 / RN 0.81 -> 2.1.20;
// bump this if a future SDK changes the bundled Kotlin).
const COMPOSE_COMPILER_VERSION = "2.1.20";
const withWidgetComposeClasspath = (config) => (0, import_config_plugins.withProjectBuildGradle)(config, (cfg) => {
  if (cfg.modResults.language !== "groovy") return cfg;
  if (cfg.modResults.contents.includes("compose-compiler-gradle-plugin")) return cfg;
  const dep = `        classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:${COMPOSE_COMPILER_VERSION}")`;
  cfg.modResults.contents = cfg.modResults.contents.replace(
    /(buildscript\s*\{[\s\S]*?dependencies\s*\{)/,
    `$1
${dep}`
  );
  return cfg;
});
const withWeeklySpendWidget = (config) => {
  config = withWidgetReceiver(config);
  config = withWidgetStrings(config);
  config = withWidgetGradle(config);
  config = withWidgetComposeClasspath(config);
  config = withWidgetNativeSources(config);
  return config;
};
var index_default = withWeeklySpendWidget;
