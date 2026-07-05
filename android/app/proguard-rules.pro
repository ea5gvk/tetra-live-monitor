# kotlinx.serialization keeps generated serializers via @Serializable; keep them.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.ea5gvk.tetralivemonitor.net.** {
    *** Companion;
}
-keepclasseswithmembers class com.ea5gvk.tetralivemonitor.net.** {
    kotlinx.serialization.KSerializer serializer(...);
}
