package com.neuereatec.pay

import android.app.Application
import com.google.firebase.FirebaseApp

class PaymentGatewayApp : Application() {
    override fun onCreate() {
        super.onCreate()
        try {
            if (FirebaseApp.getApps(this).isEmpty()) {
                FirebaseApp.initializeApp(this)
            }
        } catch (_: Exception) {
            // Local flavor can run without Firebase; API polling still works.
        }
    }
}
