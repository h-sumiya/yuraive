-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault
-keepclassmembers class * {
    @net.engio.mbassy.listener.Handler <methods>;
}
# MBassador constructs handler-invocation implementations reflectively.
-keep,allowobfuscation class * implements net.engio.mbassy.dispatch.IHandlerInvocation {
    public <init>(net.engio.mbassy.subscription.SubscriptionContext);
}
-keep @net.starlark.java.annot.StarlarkBuiltin class * { *; }
-keepclassmembers class * {
    @net.starlark.java.annot.StarlarkMethod <methods>;
}
-dontwarn javax.annotation.**
-dontwarn javax.annotation.processing.**
-dontwarn javax.lang.model.**
-dontwarn javax.tools.**
# SMBJ optionally supports Kerberos/SPNEGO, and its event bus optionally supports
# expression-language filtering. Neither optional integration is used by the app.
-dontwarn javax.el.**
-dontwarn org.ietf.jgss.**
-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
