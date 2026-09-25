package com.gbti.paymentgateway.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.gbti.paymentgateway.data.CatalogItem
import com.gbti.paymentgateway.data.Order
import com.gbti.paymentgateway.data.formatGyd
import com.gbti.paymentgateway.ui.theme.GbtiCream
import com.gbti.paymentgateway.ui.theme.GbtiError
import com.gbti.paymentgateway.ui.theme.GbtiGold
import com.gbti.paymentgateway.ui.theme.GbtiMuted
import com.gbti.paymentgateway.ui.theme.GbtiNavy
import com.gbti.paymentgateway.ui.theme.GbtiNavyDeep
import com.gbti.paymentgateway.ui.theme.GbtiSuccess
import com.gbti.paymentgateway.ui.theme.GbtiTeal

@Composable
fun GbtiPaymentApp(vm: CheckoutViewModel = viewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()

    when {
        state.checkoutUrl != null -> {
            HostedCheckoutScreen(
                url = state.checkoutUrl!!,
                onClose = { vm.clearCheckoutSession() },
            )
        }
        state.order != null -> {
            ReceiptScreen(
                order = state.order!!,
                pollMessage = state.pollMessage,
                onShopAgain = { vm.resetToShop() },
                onRefresh = { vm.refreshOrder() },
            )
        }
        else -> {
            ShopScreen(
                state = state,
                onSelect = vm::selectItem,
                onQty = vm::setQuantity,
                onPay = vm::startCardPayment,
                onDismissError = vm::clearError,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ShopScreen(
    state: CheckoutUiState,
    onSelect: (CatalogItem) -> Unit,
    onQty: (Int) -> Unit,
    onPay: () -> Unit,
    onDismissError: () -> Unit,
) {
    val selected = state.selected
    val totalCents = (selected?.amountCents ?: 0L) * state.quantity

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "GBTI Bank",
                            style = MaterialTheme.typography.titleLarge,
                            color = Color.White,
                        )
                        Text(
                            "Merchant checkout · Guyana dollars",
                            style = MaterialTheme.typography.bodyMedium,
                            color = GbtiGold,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = GbtiNavyDeep,
                ),
            )
        },
        containerColor = GbtiCream,
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            HeroBanner()
            LazyColumn(
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Text(
                        "Select an item",
                        style = MaterialTheme.typography.titleMedium,
                        color = GbtiNavy,
                    )
                    Text(
                        "Card details are entered only on GBTI hosted checkout — never in this app.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = GbtiMuted,
                        modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
                    )
                }
                items(state.catalog, key = { it.id }) { item ->
                    CatalogRow(
                        item = item,
                        selected = selected?.id == item.id,
                        onClick = { onSelect(item) },
                    )
                }
                item {
                    Spacer(Modifier.height(8.dp))
                    QuantityRow(qty = state.quantity, onQty = onQty)
                }
            }

            CheckoutBar(
                totalLabel = formatGyd(totalCents),
                loading = state.isLoading,
                enabled = selected != null && !state.isLoading,
                error = state.error,
                onPay = onPay,
                onDismissError = onDismissError,
            )
        }
    }
}

@Composable
private fun HeroBanner() {
    Box(
        Modifier
            .fillMaxWidth()
            .background(
                Brush.horizontalGradient(listOf(GbtiNavyDeep, GbtiTeal)),
            )
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Default.Security,
                contentDescription = null,
                tint = GbtiGold,
                modifier = Modifier.size(28.dp),
            )
            Spacer(Modifier.width(12.dp))
            Column {
                Text(
                    "SANDBOX DEMO",
                    style = MaterialTheme.typography.labelLarge,
                    color = GbtiGold,
                )
                Text(
                    "Visa / Mastercard · GYD · Hosted card fields",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.9f),
                )
            }
        }
    }
}

@Composable
private fun CatalogRow(
    item: CatalogItem,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(4.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) Color.White else Color.White.copy(alpha = 0.7f))
            .border(
                width = if (selected) 2.dp else 1.dp,
                color = if (selected) GbtiGold else Color(0xFFD9D2C3),
                shape = shape,
            )
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(item.name, style = MaterialTheme.typography.titleMedium, color = GbtiNavy)
            Text(item.description, style = MaterialTheme.typography.bodyMedium, color = GbtiMuted)
        }
        Text(
            formatGyd(item.amountCents),
            style = MaterialTheme.typography.titleMedium,
            color = GbtiNavyDeep,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun QuantityRow(qty: Int, onQty: (Int) -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text("Quantity", style = MaterialTheme.typography.titleMedium, color = GbtiNavy)
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { onQty(qty - 1) }) {
                Icon(Icons.Default.Remove, contentDescription = "Decrease")
            }
            Text(
                qty.toString(),
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.width(36.dp),
                textAlign = TextAlign.Center,
            )
            IconButton(onClick = { onQty(qty + 1) }) {
                Icon(Icons.Default.Add, contentDescription = "Increase")
            }
        }
    }
}

@Composable
private fun CheckoutBar(
    totalLabel: String,
    loading: Boolean,
    enabled: Boolean,
    error: String?,
    onPay: () -> Unit,
    onDismissError: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color.White)
            .border(width = 1.dp, color = Color(0xFFD9D2C3))
            .padding(16.dp),
    ) {
        if (error != null) {
            Text(
                error,
                color = GbtiError,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onDismissError)
                    .padding(bottom = 8.dp),
            )
        }
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("Total", style = MaterialTheme.typography.bodyMedium, color = GbtiMuted)
                Text(totalLabel, style = MaterialTheme.typography.headlineMedium, color = GbtiNavy)
            }
            Button(
                onClick = onPay,
                enabled = enabled,
                colors = ButtonDefaults.buttonColors(containerColor = GbtiNavy),
                shape = RoundedCornerShape(3.dp),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            ) {
                if (loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = Color.White,
                        strokeWidth = 2.dp,
                    )
                } else {
                    Icon(Icons.Default.CreditCard, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Pay with card")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun HostedCheckoutScreen(url: String, onClose: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Secure checkout", color = Color.White)
                        Text(
                            "Hosted by GBTI sandbox",
                            style = MaterialTheme.typography.bodyMedium,
                            color = GbtiGold,
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onClose) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Close",
                            tint = Color.White,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = GbtiNavyDeep),
            )
        },
    ) { padding ->
        AndroidView(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            factory = { context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView?,
                            request: WebResourceRequest?,
                        ): Boolean = false

                        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                            super.onPageStarted(view, url, favicon)
                        }
                    }
                    loadUrl(url)
                }
            },
            update = { webView ->
                if (webView.url != url) {
                    webView.loadUrl(url)
                }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReceiptScreen(
    order: Order,
    pollMessage: String? = null,
    onShopAgain: () -> Unit,
    onRefresh: () -> Unit,
) {
    val (icon, tint, title) = when (order.status) {
        "paid" -> Triple(Icons.Default.CheckCircle, GbtiSuccess, "Payment confirmed")
        "failed" -> Triple(Icons.Default.Error, GbtiError, "Payment failed")
        "refunded" -> Triple(Icons.Default.CheckCircle, GbtiTeal, "Refunded")
        else -> Triple(Icons.Default.HourglassEmpty, GbtiGold, "Pending confirmation")
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Receipt", color = Color.White) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = GbtiNavyDeep),
            )
        },
        containerColor = GbtiCream,
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(24.dp))
            Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(64.dp))
            Spacer(Modifier.height(12.dp))
            Text(title, style = MaterialTheme.typography.headlineMedium, color = GbtiNavy)
            if (!pollMessage.isNullOrBlank() && order.status == "pending") {
                Text(
                    pollMessage,
                    style = MaterialTheme.typography.bodyMedium,
                    color = GbtiGold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            Text(
                "Status from verified webhook — not client-side trust",
                style = MaterialTheme.typography.bodyMedium,
                color = GbtiMuted,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp),
            )
            Spacer(Modifier.height(28.dp))
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(Color.White)
                    .border(1.dp, Color(0xFFD9D2C3), RoundedCornerShape(4.dp))
                    .padding(18.dp),
            ) {
                ReceiptLine("Merchant", "GBTI Demo Merchant")
                HorizontalDivider(Modifier.padding(vertical = 10.dp), color = Color(0xFFE8E1D4))
                ReceiptLine("Amount", formatGyd(order.amountCents))
                ReceiptLine("Currency", order.currency)
                ReceiptLine("Status", order.status.uppercase())
                ReceiptLine("Order ID", order.id)
                if (!order.paymentRef.isNullOrBlank()) {
                    ReceiptLine("Payment ref", order.paymentRef!!)
                }
                ReceiptLine("Description", order.description)
            }
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = onShopAgain,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = GbtiNavy),
                shape = RoundedCornerShape(3.dp),
            ) {
                Text("Shop again")
            }
            TextButton(onClick = onRefresh) {
                Text("Refresh status")
            }
        }
    }
}

@Composable
private fun ReceiptLine(label: String, value: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = GbtiMuted)
        Text(
            value,
            style = MaterialTheme.typography.bodyLarge,
            color = GbtiNavyDeep,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.End,
            modifier = Modifier
                .weight(1f)
                .padding(start = 16.dp),
        )
    }
}
