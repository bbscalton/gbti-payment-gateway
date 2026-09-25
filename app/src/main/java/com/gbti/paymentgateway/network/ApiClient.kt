package com.gbti.paymentgateway.network

import com.gbti.paymentgateway.BuildConfig
import com.gbti.paymentgateway.data.CreateOrderRequest
import com.gbti.paymentgateway.data.Order
import com.gbti.paymentgateway.data.PayResponse
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import java.util.concurrent.TimeUnit

interface GbtiApi {
    @POST("orders")
    suspend fun createOrder(@Body body: CreateOrderRequest): Order

    @GET("orders/{id}")
    suspend fun getOrder(@Path("id") id: String): Order

    @POST("orders/{id}/pay")
    suspend fun startPayment(@Path("id") id: String): PayResponse
}

object ApiClient {
    /**
     * Emulator → host machine: http://10.0.2.2:3000/
     * Physical device on same LAN: use your PC's LAN IP instead (see README).
     */
    val baseUrl: String = BuildConfig.API_BASE_URL

    private val moshi: Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private val okHttp: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(
            HttpLoggingInterceptor().apply {
                // BASIC only — never BODY-log potential secrets in production
                level = HttpLoggingInterceptor.Level.BASIC
            }
        )
        .build()

    val api: GbtiApi = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(okHttp)
        .addConverterFactory(MoshiConverterFactory.create(moshi))
        .build()
        .create(GbtiApi::class.java)
}
