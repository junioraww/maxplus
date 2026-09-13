import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "org.meowkie.max"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "org.meowkie.max"
        minSdk = 28
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    
    buildFeatures {
      buildConfig = true
    }
    
    signingConfigs {
      create("release") {
        val isCI = System.getenv("CI") == "true"
        
        if (isCI) { // github actions
          val storeFilePath = System.getenv("ANDROID_KEYSTORE")
          
          keyAlias = System.getenv("ANDROID_KEY_ALIAS")
          keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
          storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
          storeFile = file(storeFilePath)
          
        } else { // using local keystore
          val keystorePropertiesFile = rootProject.file("keystore.properties")
          val keystoreProperties = Properties()
          
          if (keystorePropertiesFile.exists()) {
            keystorePropertiesFile.inputStream().use {
              keystoreProperties.load(it)
            }
          }
          
          keyAlias = keystoreProperties["keyAlias"] as String
          keyPassword = keystoreProperties["password"] as String
          storePassword = keystoreProperties["password"] as String
          storeFile = file(keystoreProperties["storeFile"] as String)
        }
      }
    }
	
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
			signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    
    kotlinOptions {
        jvmTarget = "1.8"
    }
    
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.6.1")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.8.0")
    implementation("com.google.firebase:firebase-messaging:23.4.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

/*configurations.all {
  resolutionStrategy {
    force("org.jetbrains.kotlin:kotlin-stdlib:1.9.0")
      force("org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.0")
  }
}*/

apply(from = "tauri.build.gradle.kts")
apply(plugin = "com.google.gms.google-services")