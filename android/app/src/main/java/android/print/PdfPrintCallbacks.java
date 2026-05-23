package android.print;

/**
 * Helpers exposing PrintDocumentAdapter's package-private callback constructors.
 *
 * Background:
 *   PrintDocumentAdapter.LayoutResultCallback() and WriteResultCallback() are
 *   declared with no modifier — package-private. Only classes inside the
 *   `android.print` package can instantiate them. This is a deliberate
 *   restriction by the framework so app code is steered toward
 *   PrintManager.print(...) (which shows the system print UI).
 *
 *   We don't want the system print UI — we want headless print-to-file. So
 *   we ship a small file whose `package` declaration is `android.print`
 *   (Java's access rules are name-based, not location-based: the JVM only
 *   checks the package name on the class). Inside this file, classes
 *   inherit the package-private super() and re-expose it via a PUBLIC
 *   constructor — which our plugin (in tw.kitty.dict) can then subclass
 *   from any other package.
 *
 *   This is a well-known pattern; it's not relying on any private API or
 *   reflection. The classes we subclass (LayoutResultCallback /
 *   WriteResultCallback) are themselves PUBLIC; only their constructors
 *   are package-private. We're working within the public API surface.
 */
public final class PdfPrintCallbacks {

    /** Public-constructor subclass of PrintDocumentAdapter.LayoutResultCallback. */
    public static abstract class LayoutCallback
            extends PrintDocumentAdapter.LayoutResultCallback {
        public LayoutCallback() {
            super();
        }
    }

    /** Public-constructor subclass of PrintDocumentAdapter.WriteResultCallback. */
    public static abstract class WriteCallback
            extends PrintDocumentAdapter.WriteResultCallback {
        public WriteCallback() {
            super();
        }
    }

    private PdfPrintCallbacks() {} // not instantiable; this is just a holder
}
