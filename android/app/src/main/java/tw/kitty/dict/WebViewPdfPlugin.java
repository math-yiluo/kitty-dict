package tw.kitty.dict;

import android.net.Uri;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PdfPrintCallbacks;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;

/**
 * Capacitor plugin exposing Android's WebView native print-to-PDF pipeline.
 *
 * Method `printToPdf({ filename })`:
 *   - Calls `webView.createPrintDocumentAdapter(filename)` on the UI thread,
 *     which invokes Chromium's print engine — the SAME pipeline desktop Chrome
 *     uses for "Save as PDF". Output is a TRUE VECTOR PDF (text remains as
 *     PDF text objects, lines remain as vector paths). Replaces the previous
 *     html2pdf.js (html2canvas + jsPDF) raster pipeline.
 *   - Drives the PrintDocumentAdapter manually through onLayout → onWrite
 *     so we never have to surface Android's print preview UI to the user.
 *   - Writes the rendered PDF to the app's cache dir as `<filename>` and
 *     resolves with `{ uri: "file:///..." }`.
 *
 * Print attributes (A4, NO_MARGINS, 600 DPI) delegate page sizing and
 * pagination to Chromium's print engine — which respects the existing
 * `@media print` CSS in src/routes/learn/[listId]/+page.svelte
 * (`.print-only` block + `@page A4` + `break-inside:avoid` on the three
 * atomic units). Same source HTML/CSS as the web's window.print() path,
 * same visual result.
 */
@CapacitorPlugin(name = "WebViewPdf")
public class WebViewPdfPlugin extends Plugin {

    @PluginMethod
    public void printToPdf(PluginCall call) {
        final String filename = call.getString("filename", "export.pdf");
        final File outFile = new File(getContext().getCacheDir(), filename);

        getActivity().runOnUiThread(() -> {
            try {
                final WebView webView = getBridge().getWebView();
                final PrintDocumentAdapter adapter =
                        webView.createPrintDocumentAdapter(filename);

                // A4 / 600 DPI / NO_MARGINS — @media print's `@page { margin: 14mm 12mm }`
                // controls the real margins. Setting margins here too would double them.
                PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setResolution(
                                new PrintAttributes.Resolution("pdf", "pdf", 600, 600))
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build();

                adapter.onLayout(
                        null,                                // oldAttributes
                        attrs,
                        null,                                // CancellationSignal
                        // Anonymous subclass of our PdfPrintCallbacks.LayoutCallback
                        // (which lives in android.print package and has a public
                        // constructor; that's how we get past
                        // LayoutResultCallback()'s package-private constructor).
                        new PdfPrintCallbacks.LayoutCallback() {
                            @Override
                            public void onLayoutFinished(
                                    PrintDocumentInfo info, boolean changed) {
                                writePdf(adapter, outFile, call);
                            }

                            @Override
                            public void onLayoutFailed(CharSequence error) {
                                call.reject(error != null
                                        ? error.toString()
                                        : "WebView print layout failed");
                            }
                        },
                        null                                 // extras Bundle
                );
            } catch (Exception e) {
                call.reject("printToPdf threw: " + e.getMessage(), e);
            }
        });
    }

    /**
     * Step 2 of the PrintDocumentAdapter lifecycle. Opens the destination file
     * as a ParcelFileDescriptor and asks the adapter to write all pages into
     * it. On success, resolves the JS call with the file:// URI.
     */
    private void writePdf(
            final PrintDocumentAdapter adapter,
            final File outFile,
            final PluginCall call) {
        ParcelFileDescriptor pfd = null;
        try {
            pfd = ParcelFileDescriptor.open(
                    outFile,
                    ParcelFileDescriptor.MODE_READ_WRITE
                            | ParcelFileDescriptor.MODE_CREATE
                            | ParcelFileDescriptor.MODE_TRUNCATE);

            final ParcelFileDescriptor finalPfd = pfd;
            adapter.onWrite(
                    new PageRange[]{PageRange.ALL_PAGES},
                    pfd,
                    new CancellationSignal(),
                    // Same trick as LayoutCallback: subclass our public-ctor
                    // wrapper instead of WriteResultCallback directly.
                    new PdfPrintCallbacks.WriteCallback() {
                        @Override
                        public void onWriteFinished(PageRange[] pages) {
                            closeSilently(finalPfd);
                            JSObject ret = new JSObject();
                            ret.put("uri", Uri.fromFile(outFile).toString());
                            call.resolve(ret);
                        }

                        @Override
                        public void onWriteFailed(CharSequence error) {
                            closeSilently(finalPfd);
                            call.reject(error != null
                                    ? error.toString()
                                    : "WebView print write failed");
                        }

                        @Override
                        public void onWriteCancelled() {
                            closeSilently(finalPfd);
                            call.reject("WebView print write cancelled");
                        }
                    });
        } catch (Exception e) {
            closeSilently(pfd);
            call.reject("printToPdf onLayoutFinished threw: " + e.getMessage(), e);
        }
    }

    private static void closeSilently(ParcelFileDescriptor pfd) {
        if (pfd == null) return;
        try {
            pfd.close();
        } catch (IOException ignored) {
        }
    }
}
