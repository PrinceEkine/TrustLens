package com.trustlens.android

import android.app.Application
import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.google.firebase.initialize

/**
 * Debug builds use the App Check debug provider (register the token printed
 * to Logcat under App Check > Apps > Manage debug tokens). Release builds
 * use Play Integrity. Firebase AI Logic requires App Check enforcement.
 */
class TrustLensApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Firebase.initialize(context = this)
        Firebase.appCheck.installAppCheckProviderFactory(
            if (BuildConfig.DEBUG) DebugAppCheckProviderFactory.getInstance()
            else PlayIntegrityAppCheckProviderFactory.getInstance()
        )
    }
}
