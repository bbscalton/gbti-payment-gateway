package com.gbti.paymentgateway.data

import com.gbti.paymentgateway.BuildConfig
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOf

/**
 * Optional Firestore mirror of order status (id, amountCents, currency, status, paymentRef, createdAt).
 * NEVER stores PAN / CVV / expiry. Enabled for cloud flavor only.
 */
object OrderStatusRepository {

    fun watchOrder(orderId: String): Flow<Order?> {
        if (!BuildConfig.USE_FIRESTORE_STATUS) {
            return flowOf(null)
        }
        return callbackFlow {
            var registration: ListenerRegistration? = null
            try {
                val db = FirebaseFirestore.getInstance()
                registration = db.collection("orders").document(orderId)
                    .addSnapshotListener { snap, err ->
                        if (err != null) {
                            trySend(null)
                            return@addSnapshotListener
                        }
                        if (snap == null || !snap.exists()) {
                            trySend(null)
                            return@addSnapshotListener
                        }
                        val data = snap.data ?: emptyMap()
                        val order = Order(
                            id = data["id"] as? String ?: orderId,
                            amountCents = (data["amountCents"] as? Number)?.toLong()
                                ?: (data["amountCents"] as? String)?.toLongOrNull()
                                ?: 0L,
                            currency = data["currency"] as? String ?: "GYD",
                            description = data["description"] as? String ?: "",
                            status = data["status"] as? String ?: "pending",
                            paymentRef = data["paymentRef"] as? String,
                            createdAt = data["createdAt"] as? String,
                            updatedAt = data["updatedAt"] as? String,
                        )
                        trySend(order)
                    }
            } catch (_: Exception) {
                trySend(null)
            }
            awaitClose { registration?.remove() }
        }
    }
}
