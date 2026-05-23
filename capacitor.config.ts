import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tw.kitty.dict',
  // appName is the bootstrap default; the runtime display name comes from
  // Android's res/values/strings.xml (default 貓咪辭典) and the localized
  // res/values-en/strings.xml (Kitty Dict for English-locale devices).
  appName: '貓咪辭典',
  webDir: 'build',
  ios: {
    contentInset: 'always'
  },
  // -------------------------------------------------------------------------
  // 切換 dev 模式:
  //
  // A) Live debug via USB + ADB reverse (目前設定,推薦):
  //    1. 接 USB,啟用 USB debugging
  //    2. 電腦跑: adb reverse tcp:5180 tcp:5180
  //       (這讓手機的 localhost:5180 透過 USB 轉到電腦的 localhost:5180)
  //    3. 電腦另開一個 terminal 跑: npm run dev
  //    4. 電腦再跑: npx cap run android  (或手機直接開 app)
  //    5. App 內 WebView 會 fetch http://localhost:5180/... 直達電腦 dev server
  //       — 完全不靠 WiFi,改 svelte 源碼 HMR 即時生效
  //    6. Chrome 開 chrome://inspect/#devices 即可看 console / 設 breakpoint
  //
  //    切換到 Emulator: 把 url 改成 http://10.0.2.2:5180 (emulator magic IP)
  //    切換到 WiFi 真機: 把 url 改成 http://<電腦 LAN IP>:5180
  //                      (要保證手機和電腦同 WiFi,LAN 環境會比 ADB reverse 不穩)
  //
  // B) 本地 bundled (離線可跑,正式打包):
  //    把整個 server block 註解掉。每次改 svelte 源碼後跑:
  //      npm run build && npx cap sync android && npx cap run android
  //    這會把 build/ 拷進 APK 的 assets/public/,離線都能用。
  // -------------------------------------------------------------------------
  // Bundled mode 啟用中(server block 註解掉)。改 svelte 源碼後跑:
  //   npm run build && npx cap sync android && npx cap run android
  // chrome://inspect/#devices 一樣能看 console — USB debugging 跟 dev
  // server 是兩件事,bundled 模式照樣能 inspect。
  // server: {
  //   url: 'http://localhost:5180', // USB + `adb reverse tcp:5180 tcp:5180`
  //   cleartext: true,
  //   androidScheme: 'https'
  // }
};

export default config;