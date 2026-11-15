package com.trustlens.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.trustlens.android.ui.TrustLensScreen
import com.trustlens.android.ui.TrustLensTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TrustLensTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    TrustLensScreen()
                }
            }
        }
    }
}
