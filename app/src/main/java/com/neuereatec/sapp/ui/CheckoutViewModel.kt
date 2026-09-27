package com.neuereatec.sapp.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.neuereatec.sapp.BuildConfig
import com.neuereatec.sapp.data.CatalogItem
import com.neuereatec.sapp.data.CreateOrderRequest
import com.neuereatec.sapp.data.DemoCatalog
import com.neuereatec.sapp.data.Order
import com.neuereatec.sapp.data.OrderStatusRepository
import com.neuereatec.sapp.network.ApiClient
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class CheckoutUiState(
    val catalog: List<CatalogItem> = DemoCatalog.items,
    val selected: CatalogItem? = DemoCatalog.items.firstOrNull(),
    val quantity: Int = 1,
    val isLoading: Boolean = false,
    val error: String? = null,
    val order: Order? = null,
    val checkoutUrl: String? = null,
    val pollMessage: String? = null,
)

class CheckoutViewModel : ViewModel() {

    private val _state = MutableStateFlow(CheckoutUiState())
    val state: StateFlow<CheckoutUiState> = _state.asStateFlow()

    private var pollJob: Job? = null
    private var firestoreJob: Job? = null

    fun selectItem(item: CatalogItem) {
        _state.update { it.copy(selected = item, error = null) }
    }

    fun setQuantity(qty: Int) {
        _state.update { it.copy(quantity = qty.coerceIn(1, 20)) }
    }

    fun clearError() {
        _state.update { it.copy(error = null) }
    }

    fun clearCheckoutSession() {
        _state.update {
            it.copy(
                checkoutUrl = null,
                isLoading = false,
                error = null,
            )
        }
    }

    fun resetToShop() {
        pollJob?.cancel()
        firestoreJob?.cancel()
        _state.update {
            CheckoutUiState(
                catalog = DemoCatalog.items,
                selected = DemoCatalog.items.firstOrNull(),
            )
        }
    }

    fun startCardPayment() {
        val item = _state.value.selected ?: return
        val qty = _state.value.quantity
        val amountCents = item.amountCents * qty
        val description = "${item.name} × $qty"

        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null, checkoutUrl = null) }
            try {
                val order = ApiClient.api.createOrder(
                    CreateOrderRequest(
                        amountCents = amountCents,
                        currency = "GYD",
                        description = description,
                    )
                )
                val pay = ApiClient.api.startPayment(order.id)
                _state.update {
                    it.copy(
                        isLoading = false,
                        order = order,
                        checkoutUrl = pay.checkoutUrl,
                        pollMessage = "Opening secure checkout…",
                    )
                }
                startStatusWatch(order.id)
            } catch (e: Exception) {
                _state.update {
                    it.copy(
                        isLoading = false,
                        error = e.message ?: "Could not reach gateway. Check network connection.",
                    )
                }
            }
        }
    }

    private fun startStatusWatch(orderId: String) {
        startPolling(orderId)
        if (BuildConfig.USE_FIRESTORE_STATUS) {
            firestoreJob?.cancel()
            firestoreJob = viewModelScope.launch {
                OrderStatusRepository.watchOrder(orderId).collect { mirrored ->
                    if (mirrored == null) return@collect
                    applyOrderUpdate(mirrored, fromFirestore = true)
                }
            }
        }
    }

    private fun applyOrderUpdate(order: Order, fromFirestore: Boolean) {
        _state.update {
            it.copy(
                order = order,
                pollMessage = when (order.status) {
                    "pending" -> if (fromFirestore) {
                        "Waiting for confirmation (Firestore)…"
                    } else {
                        "Waiting for confirmation…"
                    }
                    "paid", "captured" -> "Payment confirmed"
                    "failed" -> "Payment declined"
                    else -> order.status
                },
            )
        }
        if (order.status == "paid" || order.status == "captured" || 
            order.status == "failed" || order.status == "refunded") {
            _state.update { it.copy(checkoutUrl = null) }
            pollJob?.cancel()
        }
    }

    private fun startPolling(orderId: String) {
        pollJob?.cancel()
        pollJob = viewModelScope.launch {
            var attempts = 0
            while (isActive && attempts < 120) {
                delay(1500)
                attempts++
                try {
                    val order = ApiClient.api.getOrder(orderId)
                    applyOrderUpdate(order, fromFirestore = false)
                    if (order.status == "paid" || order.status == "captured" || 
                        order.status == "failed" || order.status == "refunded") {
                        break
                    }
                } catch (_: Exception) {
                    // Keep polling; transient network issues during checkout
                }
            }
        }
    }

    fun refreshOrder() {
        val id = _state.value.order?.id ?: return
        viewModelScope.launch {
            try {
                val order = ApiClient.api.getOrder(id)
                _state.update { it.copy(order = order, error = null) }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }
}
