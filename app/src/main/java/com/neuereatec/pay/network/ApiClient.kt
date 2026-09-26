package com.neuereatec.pay.network

import com.neuereatec.pay.BuildConfig
import com.neuereatec.pay.data.CreateOrderRequest
import com.neuereatec.pay.data.Order
import com.neuereatec.pay.data.PayResponse
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

interface NeuereatecApi {
    @POST("orders")
    suspend fun createOrder(@Body body: CreateOrderRequest): Order

    @GET("orders/{id}")
    suspend fun getOrder(@Path("id") id: String): Order

    @POST("orders/{id}/pay")
    suspend fun startPayment(@Path("id") id: String): PayResponse
}

object ApiClient {
    val baseUrl: String = BuildConfig.API_BASE_URL

    private val moshi: Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private val okHttp: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(
            HttpLoggingInterceptor().apply {
                level = if (BuildConfig.DEBUG) {
                    HttpLoggingInterceptor.Level.BASIC
                } else {
                    HttpLoggingInterceptor.Level.NONE
                }
            }
        )
        .build()

    val api: NeuereatecApi = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(okHttp)
        .addConverterFactory(MoshiConverterFactory.create(moshi))
        .build()
        .create(NeuereatecApi::class.java)
}
