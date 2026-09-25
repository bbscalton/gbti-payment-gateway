package com.gbti.paymentgateway

import android.app.Application
import com.google.firebase.FirebaseApp

class PaymentGatewayApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Safe even without google-services in local builds that skip the plugin —
        // google-services.json is present for cloud + Firestore status.
        try {
            if (FirebaseApp.getApps(this).isEmpty()) {
                FirebaseApp.initializeApp(this)
            }
        } catch (_: Exception) {
            // Local flavor can run without Firebase; API polling still works.
        }
    }
}
