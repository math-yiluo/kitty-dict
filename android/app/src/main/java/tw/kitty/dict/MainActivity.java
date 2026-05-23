package tw.kitty.dict;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins must be registered BEFORE super.onCreate(...) — the
        // Capacitor bridge that connects JS↔native is built inside
        // BridgeActivity.onCreate, and only plugins already registered at
        // that point are visible to JS.
        registerPlugin(WebViewPdfPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
