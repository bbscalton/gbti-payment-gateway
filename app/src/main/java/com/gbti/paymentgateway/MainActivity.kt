package com.gbti.paymentgateway

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.gbti.paymentgateway.ui.GbtiPaymentApp
import com.gbti.paymentgateway.ui.theme.GbtiCream
import com.gbti.paymentgateway.ui.theme.GbtiTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            GbtiTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = GbtiCream,
                ) {
                    GbtiPaymentApp()
                }
            }
        }
    }
}
