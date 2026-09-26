package com.neuereatec.pay

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.neuereatec.pay.ui.NeuereatecPayApp
import com.neuereatec.pay.ui.theme.NeuereatecCream
import com.neuereatec.pay.ui.theme.NeuereatecPayTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            NeuereatecPayTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = NeuereatecCream,
                ) {
                    NeuereatecPayApp()
                }
            }
        }
    }
}
