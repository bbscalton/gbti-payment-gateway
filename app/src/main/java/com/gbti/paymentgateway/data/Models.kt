package com.gbti.paymentgateway.data

data class Order(
    val id: String,
    val amountCents: Long,
    val currency: String,
    val description: String,
    val status: String,
    val paymentRef: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
)

data class CreateOrderRequest(
    val amountCents: Long,
    val currency: String = "GYD",
    val description: String,
)

data class PayResponse(
    val orderId: String,
    val checkoutUrl: String,
    val status: String,
)

data class CatalogItem(
    val id: String,
    val name: String,
    val description: String,
    val amountCents: Long,
)

object DemoCatalog {
    val items = listOf(
        CatalogItem(
            id = "sku_demerara",
            name = "Demerara Coffee Bundle",
            description = "Local gourmet coffee assortment",
            amountCents = 450_000L, // GYD 4,500.00
        ),
        CatalogItem(
            id = "sku_craft",
            name = "Georgetown Craft Market Voucher",
            description = "GYD gift voucher for partner merchants",
            amountCents = 1_000_000L, // GYD 10,000.00
        ),
        CatalogItem(
            id = "sku_utility",
            name = "Utility Top-up",
            description = "Prepaid utility credit (demo)",
            amountCents = 250_000L, // GYD 2,500.00
        ),
    )
}

fun formatGyd(amountCents: Long): String {
    val whole = amountCents / 100
    val frac = (amountCents % 100).toString().padStart(2, '0')
    val grouped = whole.toString()
        .reversed()
        .chunked(3)
        .joinToString(",")
        .reversed()
    return "GYD $grouped.$frac"
}
