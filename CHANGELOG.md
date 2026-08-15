# Changelog

## 0.1.0 (2026-08-15)


### ⚠ BREAKING CHANGES

* license the project under Apache-2.0

### ✨ Features

* adopt the Screencappy name ([f90de0e](https://github.com/aaronepinto/smollet-screencappy/commit/f90de0eda3617889de7854cde68e3782794c83a3))
* **build:** Firefox build target plus cross-browser debugger guards ([ae32191](https://github.com/aaronepinto/smollet-screencappy/commit/ae32191079f254369b40ebdbe185d175ad7b1466))
* **capture:** auto-load infinite-scroll pages before capturing ([1c4e074](https://github.com/aaronepinto/smollet-screencappy/commit/1c4e0745dff297cfb422238caf7978a4207a39c7))
* **capture:** capture iframes in depth from the element picker ([5de0cfc](https://github.com/aaronepinto/smollet-screencappy/commit/5de0cfc9f84b2707e15a738a291de3e38ad71099))
* **capture:** capture the visible area when a page blocks scrolling ([ea94e89](https://github.com/aaronepinto/smollet-screencappy/commit/ea94e89a68dde440e91a5a6532ba2a6dd55a874c))
* **capture:** delayed capture with a badge countdown ([65c2211](https://github.com/aaronepinto/smollet-screencappy/commit/65c2211efb56f553aeae73a09d018a319f3c441c))
* **capture:** mobile-width capture via Turbo device emulation ([6bee917](https://github.com/aaronepinto/smollet-screencappy/commit/6bee917da79e28bad5671a819407b2f7612e43da))
* **capture:** pick and capture a single element, DevTools style ([8be3894](https://github.com/aaronepinto/smollet-screencappy/commit/8be38941cadd654d9d0f1fb2fd7b27e2a9df3150))
* **capture:** stitch pages that scroll inside an inner container ([56ed289](https://github.com/aaronepinto/smollet-screencappy/commit/56ed289b871af427fbd443f26efded53b8462428))
* **capture:** wait out async renderers and probe blocked scrolling ([d96f2a1](https://github.com/aaronepinto/smollet-screencappy/commit/d96f2a1baec6e6263cdd6ee9247a059fea2c1828))
* **editor:** add right-click menu for full-image copy and download ([ec4254e](https://github.com/aaronepinto/smollet-screencappy/commit/ec4254ef65e401e7b22132371229abe765c87e0d))
* **export:** save pages as searchable PDFs with selectable text ([5670f88](https://github.com/aaronepinto/smollet-screencappy/commit/5670f88f78e57466271ae3bb8189a53e4d9a9a0d))
* initial release of Screencappy ([f0545ac](https://github.com/aaronepinto/smollet-screencappy/commit/f0545ace62e4bfb712672ba73a44cd1cfe2b05d7))
* license the project under Apache-2.0 ([2d43196](https://github.com/aaronepinto/smollet-screencappy/commit/2d4319674f24b94ce1947c15658be07a77387307))
* **site:** add competitor comparison pages and the alternatives hub ([33e9559](https://github.com/aaronepinto/smollet-screencappy/commit/33e9559d103a4e6f7f12177663a39efcc4f763a7))
* **site:** add screencappy.smollet.app landing page and privacy policy ([614a051](https://github.com/aaronepinto/smollet-screencappy/commit/614a0512575d21123a2a7642e4ed6ade012ca7a8))
* **site:** add the Smollet umbrella site ([9b6040f](https://github.com/aaronepinto/smollet-screencappy/commit/9b6040f08a40e4e329f21c5098d8659b0d0c0a6b))
* **site:** full marketing site with SEO and answer-engine assets ([5a18735](https://github.com/aaronepinto/smollet-screencappy/commit/5a18735bb1bab77222c5f31752fbe72e6e7298f5))
* **site:** reconcile the GoFullPage page with refreshed research ([1999e4b](https://github.com/aaronepinto/smollet-screencappy/commit/1999e4b0fbf71d5b4c0485427b1296c08efb5d98))
* **site:** restyle Screencappy on the Smollet editorial design system ([ed0cc38](https://github.com/aaronepinto/smollet-screencappy/commit/ed0cc381fb523ef22f2574f96f3c65dabff1ec04))
* **site:** show live project health badges on the homepage ([f23b6df](https://github.com/aaronepinto/smollet-screencappy/commit/f23b6dfd4d429d883074b62bc977841d955858e8))
* **site:** wire the comparison pages into site discovery ([82df641](https://github.com/aaronepinto/smollet-screencappy/commit/82df6411fe8fed224864be993e2154d308f9c478))


### 🐛 Bug fixes

* **build:** give tests their own TypeScript project ([59ccc20](https://github.com/aaronepinto/smollet-screencappy/commit/59ccc20d89601481842f630c708a16bafa5418f6))
* **capture:** hold the shot while rows are still streaming in ([118f2fa](https://github.com/aaronepinto/smollet-screencappy/commit/118f2fa48d2bbead0ab429f52e21ec1d0d09d13e))
* **capture:** pin sticky elements inside open shadow DOM ([3bee54e](https://github.com/aaronepinto/smollet-screencappy/commit/3bee54ee405e1707e3900b2ea1d9f96fbd6e674c))
* **capture:** stop parallax backgrounds repeating in every tile ([b035d0a](https://github.com/aaronepinto/smollet-screencappy/commit/b035d0af1531340d9365e258481c086a6f6686e1))
* **editor:** keep hidden panels hidden despite author display rules ([fa0b90d](https://github.com/aaronepinto/smollet-screencappy/commit/fa0b90d47009f1423ecfccbf69bc53c72b07a7bd))
* **tests:** type the e2e harnesses so editors report nothing ([c6b20f2](https://github.com/aaronepinto/smollet-screencappy/commit/c6b20f227c4d9d95201b005cee82bd20dcf034a8))


### ⚡ Performance

* **capture:** size the settle from the latency the page has shown ([1a0075e](https://github.com/aaronepinto/smollet-screencappy/commit/1a0075ee2abcf40fe8aec5dae331daa07fcbe903))


### 📝 Documentation

* rewrite the README as a product page ([9a0080e](https://github.com/aaronepinto/smollet-screencappy/commit/9a0080eef309aeaa20d233e110be56d952be4f69))
* state which browsers CI actually tests ([da2fbd4](https://github.com/aaronepinto/smollet-screencappy/commit/da2fbd43e2105f46f2417663720a2906b26fbc8a))


### ✅ Tests

* add real-Chrome e2e capture test ([ecd41f0](https://github.com/aaronepinto/smollet-screencappy/commit/ecd41f01d863134a4e3ef1153c75b68dd31dce70))
* add unit tests and run the full suite in CI ([f5b69d0](https://github.com/aaronepinto/smollet-screencappy/commit/f5b69d089a8a1f1542594651ff7fbe35b5369298))
* **capture:** fixtures and scenarios for the known ways capture breaks ([6332b86](https://github.com/aaronepinto/smollet-screencappy/commit/6332b8699f5957244913c5a769c4ec6f85e941ff))
* **firefox:** real capture end to end under geckodriver ([5cc5f03](https://github.com/aaronepinto/smollet-screencappy/commit/5cc5f03df2450915fd403cb7f74c4dc726a7dea3))
* share e2e fixtures and label capture runs by browser ([bbc7430](https://github.com/aaronepinto/smollet-screencappy/commit/bbc7430d1fa2940edd9e93254a2610d3e4792c04))


### 🧹 Chores

* set initial release version ([bdad01c](https://github.com/aaronepinto/smollet-screencappy/commit/bdad01cd43931df7acf4a7c43baa10b56fe44e28))
