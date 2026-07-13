-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault
-keep @net.starlark.java.annot.StarlarkBuiltin class * { *; }
-keepclassmembers class * {
    @net.starlark.java.annot.StarlarkMethod <methods>;
}
-dontwarn javax.annotation.**
-dontwarn javax.annotation.processing.**
-dontwarn javax.lang.model.**
-dontwarn javax.tools.**
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
